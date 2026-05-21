import { createModel, Model } from '../index';
import { ReactionSystem } from '../reaction-system';
import { ErrorHandler } from '../error-handler';
import { ModelManager } from '../model-manager';

describe('ReactionSystem - via createModel', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('triggers reactions when dependent fields change', async () => {
        interface ReactionSchema {
            firstName: string;
            lastName: string;
            fullName: string;
        }
        const schema: Model<ReactionSchema> = {
            firstName: { type: 'string', default: '' },
            lastName: { type: 'string', default: '' },
            fullName: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['firstName', 'lastName'],
                    computed: (values) =>
                        `${values.firstName} ${values.lastName}`,
                },
            },
        };
        const model = createModel<ReactionSchema>(schema);
        await model.setField('firstName', 'John');
        await model.setField('lastName', 'Doe');
        await model.settled();
        expect(model.getField('fullName')).toBe('John Doe');
        model.dispose();
    });

    test('emits reaction error and stores it under __reactions', async () => {
        interface S {
            input: string;
            output: string;
        }
        const schema: Model<S> = {
            input: { type: 'string', default: '' },
            output: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['input'],
                    computed: (values) => {
                        if (values.input === 'error') {
                            throw new Error('Computation error');
                        }
                        return values.input.toUpperCase();
                    },
                },
            },
        };
        const model = createModel<S>(schema);

        await model.setField('input', 'error');
        await model.settled();

        expect(model.validationErrors).toHaveProperty('__reactions');
        expect(
            model.validationErrors?.__reactions?.[0]?.message
        ).toContain('Computation error');
        model.dispose();
    });

    test('detects invalid (non-existent) dependent fields', async () => {
        const consoleSpy = jest.spyOn(console, 'error');

        interface S {
            validField: string;
            invalidField: string;
        }
        const schema: Model<S> = {
            validField: { type: 'string', default: 'valid' },
            invalidField: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['validField', 'nonexistentField'],
                    computed: (values) =>
                        values.validField + (values.nonexistentField || ''),
                },
            },
        };
        const model = createModel<S>(schema);

        await model.setField('validField', 'test');
        await model.settled();

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                '[dependency_error] field invalidField: Dependency field nonexistentField is not defined'
            )
        );
        model.dispose();
    });

    test('detects circular dependencies', async () => {
        const consoleSpy = jest.spyOn(console, 'error');

        interface S {
            fieldA: number;
            fieldB: number;
        }
        const schema: Model<S> = {
            fieldA: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['fieldB'],
                    computed: (v) => v.fieldB + 1,
                },
            },
            fieldB: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['fieldA'],
                    computed: (v) => v.fieldA + 1,
                },
            },
        };

        const model = createModel<S>(schema);

        await model.setField('fieldA', 1);
        await model.settled();

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[circular_dependency]')
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Circular dependency detected')
        );
        model.dispose();
    });

    test('legitimate undefined value in dep does NOT trigger DEPENDENCY_ERROR', async () => {
        const errorHandler = new ErrorHandler();
        const depErrors: string[] = [];
        errorHandler.onError('dependency_error' as any, (e) => {
            depErrors.push(e.message);
        });

        interface S {
            source: any;
            mirror: any;
        }
        const schema: Model<S> = {
            source: { type: 'string' },
            mirror: {
                type: 'string',
                reaction: {
                    fields: ['source'],
                    computed: (deps) => deps.source ?? 'fallback',
                },
            },
        };
        const model = createModel<S>(schema, { errorHandler });

        await model.setField('source', undefined);
        await model.settled();

        expect(depErrors).toHaveLength(0);
        model.dispose();
    });

    test('multiple reactions on the same field all execute', async () => {
        const spy1 = jest.fn();
        const spy2 = jest.fn();

        interface Schema {
            source: string;
            target: string;
        }
        const schema: Model<Schema> = {
            source: { type: 'string', default: 'start' },
            target: {
                type: 'string',
                default: 'initial',
                reaction: [
                    {
                        fields: ['source'],
                        computed: (values) => {
                            spy1();
                            return values.source + '_1';
                        },
                    },
                    {
                        fields: ['source'],
                        computed: (values) => {
                            spy2();
                            return values.source + '_2';
                        },
                    },
                ],
            },
        };

        const model = createModel<Schema>(schema);
        await model.setField('source', 'update');
        await model.settled();

        expect(spy1).toHaveBeenCalled();
        expect(spy2).toHaveBeenCalled();
        // Last scheduled reaction wins.
        expect(model.getField('target')).toBe('update_2');
        model.dispose();
    });

    test('reactions on different fields trigger only relevant ones', async () => {
        const spy1 = jest.fn();
        const spy2 = jest.fn();

        interface Schema {
            dep1: string;
            dep2: string;
            target: string;
        }
        const schema: Model<Schema> = {
            dep1: { type: 'string', default: 'a' },
            dep2: { type: 'string', default: 'b' },
            target: {
                type: 'string',
                default: '',
                reaction: [
                    {
                        fields: ['dep1'],
                        computed: (values) => {
                            spy1();
                            return values.dep1;
                        },
                    },
                    {
                        fields: ['dep2'],
                        computed: (values) => {
                            spy2();
                            return values.dep2;
                        },
                    },
                ],
            },
        };

        const model = createModel<Schema>(schema);

        await model.setField('dep1', 'changed');
        await model.settled();

        expect(spy1).toHaveBeenCalled();
        expect(spy2).not.toHaveBeenCalled();
        expect(model.getField('target')).toBe('changed');
        model.dispose();
    });

    test('setFields triggers depending reaction only once', async () => {
        const reactionFn = jest.fn(
            (deps: Record<string, any>) => deps.a + deps.b
        );
        interface Schema {
            a: number;
            b: number;
            c: number;
        }
        const schema: Model<Schema> = {
            a: { type: 'number', default: 0 },
            b: { type: 'number', default: 0 },
            c: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['a', 'b'],
                    computed: reactionFn,
                },
            },
        };
        const model = createModel<Schema>(schema);

        await model.setFields({ a: 1, b: 2 });
        await model.settled();

        expect(reactionFn).toHaveBeenCalledTimes(1);
        expect(model.getField('c')).toBe(3);
        model.dispose();
    });

    test('async race in setField: latest value wins, intermediate reactions converge', async () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: {
                type: 'string',
                validator: [
                    {
                        type: 'async',
                        validate: async (val: any) => {
                            if (val === 'slow') {
                                await new Promise((resolve) =>
                                    setTimeout(resolve, 50)
                                );
                                return true;
                            }
                            if (val === 'fast') {
                                await new Promise((resolve) =>
                                    setTimeout(resolve, 10)
                                );
                                return true;
                            }
                            return true;
                        },
                        message: 'error',
                    },
                ],
                default: '',
            },
        };
        const model = createModel<Schema>(schema);

        const p1 = model.setField('field', 'slow');
        const p2 = model.setField('field', 'fast');

        await Promise.all([p1, p2]);
        await model.settled();

        expect(model.getField('field')).toBe('fast');
        model.dispose();
    });
});

describe('ReactionSystem - settled() waits for chained async reactions', () => {
    test('settled() should not resolve until chained reactions finish (no debounce)', async () => {
        interface S {
            a: number;
            b: number;
            c: number;
        }
        const schema: Model<S> = {
            a: { type: 'number', default: 0 },
            b: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['a'],
                    computed: (deps) => deps.a + 1,
                },
            },
            c: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['b'],
                    computed: (deps) => deps.b + 1,
                },
            },
        };

        const model = createModel<S>(schema, { debounceReactions: 0 });

        await model.setField('a', 10);
        await model.settled();

        expect(model.getField('b')).toBe(11);
        expect(model.getField('c')).toBe(12);
        model.dispose();
    });

    test('settled() resolves only after async reaction.action microtasks finish', async () => {
        const trace: string[] = [];
        interface S {
            a: number;
            b: number;
        }
        const schema: Model<S> = {
            a: { type: 'number', default: 0 },
            b: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['a'],
                    computed: (deps) => deps.a * 2,
                    action: (vals) => {
                        trace.push(`b=${vals.computed}`);
                    },
                },
            },
        };
        const model = createModel<S>(schema);
        await model.setField('a', 5);
        await model.settled();
        expect(trace).toContain('b=10');
        model.dispose();
    });

    test('settled() waits for debounced reactions to flush', async () => {
        interface Schema {
            source: string;
            target: string;
        }
        const schema: Model<Schema> = {
            source: { type: 'string', default: '' },
            target: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['source'],
                    computed: (deps) => deps.source.toUpperCase(),
                },
            },
        };

        const model = createModel<Schema>(schema, {
            debounceReactions: 50,
        });

        await model.setField('source', 'hello');
        // Debounced — should not have fired yet.
        expect(model.getField('target')).toBe('');

        await model.settled();

        expect(model.getField('target')).toBe('HELLO');
        model.dispose();
    });
});

describe('ReactionSystem - direct unit tests', () => {
    test('reaction error when dependency access throws', () => {
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        const handler = new ErrorHandler();

        const setError = jest.fn();
        const system = new ReactionSystem(
            {
                a: { type: 'string', default: '' },
                b: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['a'],
                        computed: (values) => values.a,
                    },
                },
            },
            { debounceReactions: 0 },
            {
                getValue: () => {
                    throw new Error('getValue failed');
                },
                setValue: async () => true,
                emit: () => {},
                setError,
            },
            handler
        );

        system.triggerReactions('a');

        expect(setError).toHaveBeenCalledWith(
            '__reactions',
            expect.objectContaining({ rule: 'reaction_error' })
        );
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('[reaction] field b: getValue failed')
        );

        errorSpy.mockRestore();
    });

    test('clears pending reaction timeouts on dispose', () => {
        jest.useFakeTimers();
        const clearSpy = jest.spyOn(global, 'clearTimeout');
        const handler = new ErrorHandler();

        const system = new ReactionSystem(
            {
                input: { type: 'string', default: '' },
                output: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['input'],
                        computed: (values) => values.input.toUpperCase(),
                    },
                },
            },
            { debounceReactions: 100 },
            {
                getValue: () => 'x',
                setValue: async () => true,
                emit: () => {},
                setError: () => {},
            },
            handler
        );

        system.triggerReactions('input');
        system.dispose();

        expect(clearSpy).toHaveBeenCalled();

        jest.useRealTimers();
    });

    test('clears previous timeout when re-scheduling debounced reactions', () => {
        jest.useFakeTimers();
        const clearSpy = jest.spyOn(global, 'clearTimeout');
        const handler = new ErrorHandler();

        const system = new ReactionSystem(
            {
                input: { type: 'string', default: '' },
                output: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['input'],
                        computed: (values) => values.input.toUpperCase(),
                    },
                },
            },
            { debounceReactions: 50 },
            {
                getValue: () => 'x',
                setValue: async () => true,
                emit: () => {},
                setError: () => {},
            },
            handler
        );

        system.triggerReactions('input');
        system.triggerReactions('input');

        expect(clearSpy).toHaveBeenCalled();

        jest.useRealTimers();
    });

    test('scheduleReaction / processReaction work with default reactionStack', () => {
        const handler = new ErrorHandler();
        const reaction = {
            fields: ['input'],
            computed: (values: Record<string, any>) => values.input,
        };

        const system = new ReactionSystem(
            {
                input: { type: 'string', default: '' },
                output: { type: 'string', default: '', reaction },
            },
            { debounceReactions: 0 },
            {
                getValue: () => 'x',
                setValue: async () => true,
                emit: () => {},
                setError: () => {},
            },
            handler
        );

        const anySystem = system as any;
        anySystem.scheduleReaction('output', reaction, 0);
        anySystem.processReaction('output', reaction);
    });

    test('dispose on ModelManager clears scheduled reactions', async () => {
        const spy = jest.fn();
        interface Schema {
            source: string;
            target: string;
        }
        const schema: Model<Schema> = {
            source: { type: 'string', default: 'a' },
            target: {
                type: 'string',
                default: 'b',
                reaction: {
                    fields: ['source'],
                    computed: (values) => {
                        spy();
                        return values.source;
                    },
                },
            },
        };

        const manager = new ModelManager<Schema>(schema, {
            debounceReactions: 100,
        });

        manager.setField('source', 'changed');
        manager.dispose();

        await new Promise((r) => setTimeout(r, 150));
        expect(spy).not.toHaveBeenCalled();
    });
});
