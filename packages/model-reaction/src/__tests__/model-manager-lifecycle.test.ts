import { ModelManager } from '../core/model-manager';
import { createModel, Model } from '../index';
import { formatValidationErrors, ValidationRules } from '../validation';

describe('ModelManager - dispose / settled lifecycle', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('setField/setFields/validateAll throw after dispose', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 },
        });
        model.dispose();

        await expect(model.setField('a', 1)).rejects.toThrow(/disposed/);
        await expect(model.setFields({ a: 1 })).rejects.toThrow(/disposed/);
        await expect(model.validateAll()).rejects.toThrow(/disposed/);
    });

    test('dispose is idempotent', () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 },
        });
        expect(() => {
            model.dispose();
            model.dispose();
        }).not.toThrow();
    });

    test('clearing data, dirtyData, validationErrors after dispose', async () => {
        const model = createModel({
            field: { type: 'string', default: 'value' },
        });

        await model.setField('field', 'updated');
        model.dispose();

        expect(model.data).toEqual({});
        expect(model.validationErrors).toEqual({});
        expect(model.getDirtyData()).toEqual({});
        expect(model.getField('field')).toBeUndefined();
        expect(formatValidationErrors(model.validationErrors)).toBe('Validation passed');
    });

    test('clearDirtyData isolation: does not clear data or errors', async () => {
        const model = createModel({
            field: {
                type: 'string',
                validator: [ValidationRules.required],
                default: 'valid',
            },
        });

        await model.setField('field', '');
        expect(model.getDirtyData()).toHaveProperty('field', '');
        expect(model.getField('field')).toBe('valid');
        expect(model.validationErrors.field!.length).toBeGreaterThan(0);

        model.clearDirtyData();
        expect(model.getDirtyData()).toEqual({});
        expect(model.getField('field')).toBe('valid');
        expect(model.validationErrors.field!.length).toBeGreaterThan(0);
        model.dispose();
    });

    test('settled() returns immediately when nothing is pending', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 },
        });
        const start = Date.now();
        await model.settled();
        expect(Date.now() - start).toBeLessThan(50);
        model.dispose();
    });

    test('settled() resolves only after slow async validators complete', async () => {
        let resolveValidator: ((v: boolean) => void) | null = null;

        interface S {
            f: string;
        }
        const schema: Model<S> = {
            f: {
                type: 'string',
                default: '',
                validator: [
                    {
                        type: 'slow',
                        message: 'slow async',
                        validate: () =>
                            new Promise<boolean>((r) => {
                                resolveValidator = r;
                            }),
                    },
                ],
            },
        };
        const model = createModel<S>(schema);

        const setPromise = model.setField('f', 'hi');

        await Promise.resolve();
        await Promise.resolve();
        expect(resolveValidator).toBeTruthy();

        let settledDone = false;
        const settledPromise = model.settled().then(() => {
            settledDone = true;
        });

        await new Promise((r) => setTimeout(r, 10));
        expect(settledDone).toBe(false);

        resolveValidator!(true);

        await setPromise;
        await settledPromise;
        expect(settledDone).toBe(true);

        model.dispose();
    });

    test.each([
        ['setFields', 0],
        ['setFields', 5],
        ['validateAll', 0],
        ['validateAll', 5],
        ['setField', 0],
        ['setField', 5],
    ] as const)(
        'settled covers the whole %s batch and its actions (debounce %i)',
        async (operation, debounceReactions) => {
            let valid = true;
            let releaseAction!: () => void;
            let signalActionStarted!: () => void;
            const actionGate = new Promise<void>((resolve) => {
                releaseAction = resolve;
            });
            const actionStarted = new Promise<void>((resolve) => {
                signalActionStarted = resolve;
            });
            const model = createModel({
                source: {
                    type: 'number',
                    default: 0,
                    validator: [{
                        type: 'allowed',
                        message: 'not allowed yet',
                        validate: () => valid,
                    }],
                },
                derived: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => source * 2,
                    },
                },
                final: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['derived'],
                        computed: ({ derived }) => derived + 1,
                        action: [async () => {
                            if (model.data.final !== 3) return;
                            signalActionStarted();
                            await actionGate;
                        }],
                    },
                },
            }, { debounceReactions });
            await model.settled();

            if (operation === 'validateAll') {
                valid = false;
                await model.setField('source', 1);
                valid = true;
            }

            const batch = operation === 'validateAll'
                ? model.validateAll()
                : operation === 'setField'
                    ? model.setField('source', 1)
                    : model.setFields({ source: 1 });
            // Observe the rejection immediately, even while waiting for actions.
            const batchResult = batch.then(
                (value) => value,
                (error: unknown) => error
            );
            let idle = false;
            const settled = model.settled().then(() => {
                idle = true;
                return model.data;
            });

            try {
                await actionStarted;
                expect(idle).toBe(false);
                releaseAction();
                expect(await settled).toEqual({
                    source: 1, derived: 2, final: 3,
                });
                expect(await batchResult).toBe(true);
            } finally {
                releaseAction();
                await batchResult;
                await model.settled();
                model.dispose();
            }
        }
    );
});

describe('ModelManager - Direct (internal collaborators)', () => {
    test('createModel returns the core manager with bound public methods', async () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: { type: 'string', default: 'val' },
        };
        const model = createModel<Schema>(schema);
        const { getField, setField } = model;

        expect(model).toBeInstanceOf(ModelManager);
        expect(getField('field')).toBe('val');
        await expect(setField('field', 'next')).resolves.toBe(true);
        expect(getField('field')).toBe('next');
        model.dispose();
    });

    test('reaction setError replaces its field array and preserves previous snapshots', () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: { type: 'string', default: 'val' },
        };
        const manager = new ModelManager<Schema>(schema);
        const internal = manager as any;

        internal.reactionSystem.callbacks.setError('field', {
            field: 'field',
            rule: 'reaction_error',
            message: 'first',
        });
        const previous = manager.validationErrors;
        internal.reactionSystem.callbacks.setError('field', {
            field: 'field',
            rule: 'reaction_error',
            message: 'second',
        });

        expect(manager.validationErrors.field?.length).toBe(2);
        expect(previous.field).toEqual([{
            field: 'field',
            rule: 'reaction_error',
            message: 'first',
        }]);
        expect(manager.validationErrors.field).not.toBe(previous.field);
        manager.dispose();
    });
});

describe('createModel - mutable default isolation', () => {
    test('array defaults are not shared across instances from the same schema', () => {
        const schema = {
            tags: { type: 'array' as const, default: [] as string[] },
        };
        const m1 = createModel(schema);
        const m2 = createModel(schema);

        m1.getField('tags').push('x');

        expect(m1.getField('tags')).toEqual(['x']);
        expect(m2.getField('tags')).toEqual([]);
        // Also decoupled from the schema literal itself.
        expect(schema.tags.default).toEqual([]);

        m1.dispose();
        m2.dispose();
    });

    test('nested object defaults are deep-cloned per instance', () => {
        const schema = {
            config: {
                type: 'object' as const,
                default: { nested: { list: [] as number[] } },
            },
        };
        const m1 = createModel(schema);
        const m2 = createModel(schema);

        m1.getField('config').nested.list.push(1);

        expect(m1.getField('config').nested.list).toEqual([1]);
        expect(m2.getField('config').nested.list).toEqual([]);
        expect(schema.config.default.nested.list).toEqual([]);

        m1.dispose();
        m2.dispose();
    });

    test('Date defaults are shared by reference (treated as immutable leaf)', () => {
        const shared = new Date(2020, 0, 1);
        const schema = {
            createdAt: { type: 'date' as const, default: shared },
        };
        const m = createModel(schema);
        expect(m.getField('createdAt')).toBe(shared);
        m.dispose();
    });
});

