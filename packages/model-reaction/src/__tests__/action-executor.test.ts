import { createModel, Reaction, SKIP_REACTION } from '../index';
import { ActionExecutor } from '../reaction/action-executor';
import { PendingTasks } from '../core/pending-tasks';

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('action computation barriers', () => {
    const cleanups: Array<() => void> = [];
    function own<T extends { dispose: () => void }>(model: T): T {
        cleanups.push(model.dispose);
        return model;
    }
    afterEach(() => {
        cleanups.splice(0).forEach((dispose) => dispose());
    });

    test.each([false, true])(
        'merges a cascading chain into its final action (async validation: %s)',
        async (asyncValidation) => {
            const validate = () => (asyncValidation ? Promise.resolve(true) : true);
            const validator = [{ type: 'valid', message: '', validate }];
            const observed: number[][] = [];
            const action = jest.fn(() => {
                const { a, b, c, total } = model.data;
                observed.push([a!, b, c, total]);
            });
            const model = own(
                createModel({
                    a: { type: 'number' },
                    b: {
                        type: 'number',
                        default: 0,
                        validator,
                        reaction: { fields: ['a'], computed: ({ a }) => a * 2 },
                    },
                    c: {
                        type: 'number',
                        default: 0,
                        validator,
                        reaction: { fields: ['b'], computed: ({ b }) => b + 1 },
                    },
                    total: {
                        type: 'number',
                        default: 0,
                        validator,
                        reaction: {
                            fields: ['a', 'b', 'c'],
                            computed: ({ a, b, c }) => a + b + c,
                            action: [action],
                        },
                    },
                })
            );
            await model.setField('a', 1);
            await model.settled();
            expect(observed).toEqual([[1, 2, 3, 6]]);
            expect(action).toHaveBeenCalledTimes(1);
            expect(action).toHaveBeenCalledWith();
        }
    );

    test.each([0, 5])(
        'keeps in-flight value commits but cancels actions when a later computation skips (debounce: %s)',
        async (debounceReactions) => {
            const earlier = jest.fn();
            const gate = deferred<boolean>();
            const first = deferred();
            const last = deferred();
            const model = own(
                createModel(
                    {
                        source: { type: 'number' },
                        target: {
                            type: 'number',
                            default: 0,
                            validator: [{
                                type: 'gate',
                                message: '',
                                validate: () => { first.resolve(); return gate.promise; },
                            }],
                            reaction: {
                                fields: ['source'],
                                computed: ({ source }) => {
                                    if (source === 1) return 1;
                                    last.resolve();
                                    return SKIP_REACTION;
                                },
                                action: [earlier],
                            },
                        },
                    },
                    { debounceReactions }
                )
            );
            await model.setField('source', 1);
            await first.promise;
            await model.setField('source', 2);
            await last.promise;
            gate.resolve(true);
            await model.settled();
            expect(model.data.target).toBe(1);
            expect(earlier).not.toHaveBeenCalled();
        }
    );

    test.each(['skip', 'throw', 'promise', 'invalid'] as const)(
        'does not restore a replaced candidate when its successor is %s',
        async (outcome) => {
            const barrier = deferred<boolean>();
            const started = deferred();
            const action = jest.fn();
            const latest: Reaction<number> = {
                fields: ['first', 'second'],
                computed: ({ second }) => {
                    if (second === undefined) return 1;
                    if (outcome === 'skip') return SKIP_REACTION;
                    if (outcome === 'throw') throw new Error('failed compute');
                    if (outcome === 'promise') return Promise.resolve(2) as unknown as number;
                    return outcome === 'invalid' ? -1 : 2;
                },
                action: [action],
            };
            const model = own(
                createModel({
                    first: { type: 'number' },
                    second: { type: 'number' },
                    slow: {
                        type: 'number',
                        validator: [
                            {
                                type: 'gate',
                                message: '',
                                validate: () => {
                                    started.resolve();
                                    return barrier.promise;
                                },
                            },
                        ],
                    },
                    target: {
                        type: 'number',
                        default: 0,
                        validator: [
                            { type: 'positive', message: 'positive', validate: (v) => v > 0 },
                        ],
                        reaction: latest,
                    },
                })
            );
            const slow = model.setField('slow', 1);
            await started.promise;
            await model.setField('first', 1);
            await drain();
            expect(model.data.target).toBe(1);
            expect(action).not.toHaveBeenCalled();
            await model.setField('second', 1);
            barrier.resolve(true);
            await slow;
            await model.settled();
            expect(action).not.toHaveBeenCalled();
            expect(model.data.target).toBe(1);
        }
    );

    test.each([{}, { action: [] }])('invalidates older groups when the new job has no actions: %p', async (config) => {
        const tasks = new PendingTasks();
        const onError = jest.fn();
        const executor = new ActionExecutor(['target'], tasks, onError);
        const end = tasks.begin();
        const action = jest.fn();
        executor.register({
            field: 'target',
            reaction: { fields: [], computed: () => 1, action: [action] },
        }, executor.invalidate('target'));
        executor.register({
            field: 'target',
            reaction: { fields: [], computed: () => 2, ...config },
        }, executor.invalidate('target'));
        end();
        await tasks.settled();
        expect(action).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        executor.dispose();
        tasks.dispose();
    });

    test('waits for downstream computation before the next item after an unrelated write', async () => {
        const gate = deferred<boolean>();
        const computing = deferred();
        const firstDone = deferred();
        const observed: number[][] = [];
        const model = own(
            createModel({
                trigger: { type: 'number' },
                a: { type: 'number', default: 0 },
                b: {
                    type: 'number',
                    default: 0,
                    validator: [
                        {
                            type: 'gate',
                            message: '',
                            validate: (v) => {
                                if (v === 0) return true;
                                computing.resolve();
                                return gate.promise;
                            },
                        },
                    ],
                    reaction: { fields: ['a'], computed: ({ a }) => a * 2 },
                },
                target: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['trigger'],
                        computed: ({ trigger }) => trigger,
                        action: [
                            async () => {
                                await model.setField('a', 2);
                                observed.push([model.data.a, model.data.b]);
                                firstDone.resolve();
                            },
                            () => {
                                observed.push([model.data.a, model.data.b]);
                            },
                        ],
                    },
                },
            })
        );
        await model.settled();
        await model.setField('trigger', 1);
        await computing.promise;
        await firstDone.promise;
        await drain();
        expect(observed).toEqual([[2, 0]]);
        gate.resolve(true);
        await model.settled();
        expect(observed).toEqual([
            [2, 0],
            [2, 4],
        ]);
    });

    test('starts a new group while an invalidated old item is still running', async () => {
        const oldGate = deferred();
        const newStarted = deferred();
        const completed: number[] = [];
        const model = own(
            createModel({
                source: { type: 'number' },
                target: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => source,
                        action: [
                            async () => {
                                if (model.data.target === 1) {
                                    await model.setField('source', 2);
                                    await oldGate.promise;
                                } else {
                                    newStarted.resolve();
                                }
                            },
                            () => {
                                completed.push(model.data.target);
                            },
                        ],
                    },
                },
            })
        );
        await model.setField('source', 1);
        await newStarted.promise;
        await drain();
        expect(model.data.target).toBe(2);
        expect(completed).toEqual([2]);
        let idle = false;
        const settled = model.settled().then(() => {
            idle = true;
        });
        await drain();
        expect(idle).toBe(false);
        oldGate.resolve();
        await settled;
        expect(completed).toEqual([2]);
    });

    test.each(['setField', 'setFields', 'validateAll'] as const)(
        'cancels remaining items after a direct %s commit',
        async (operation) => {
            const gate = deferred();
            const started = deferred();
            const next = jest.fn();
            let valid = true;
            const model = own(
                createModel({
                    source: { type: 'number' },
                    target: {
                        type: 'number',
                        default: 0,
                        validator: [{ type: 'allowed', message: '', validate: () => valid }],
                        reaction: {
                            fields: ['source'],
                            computed: ({ source }) => source,
                            action: [
                                () => {
                                    started.resolve();
                                    return gate.promise;
                                },
                                next,
                            ],
                        },
                    },
                })
            );
            await model.setField('source', 1);
            await started.promise;
            let validation: Promise<boolean> | undefined;
            if (operation === 'validateAll') {
                valid = false;
                expect(await model.setField('target', 7)).toBe(false);
                valid = true;
                let completed = false;
                validation = model.validateAll().then((result) => {
                    completed = true;
                    return result;
                });
                await drain();
                expect(model.data.target).toBe(7);
                expect(completed).toBe(false);
            } else if (operation === 'setFields') {
                await model.setFields({ target: 7 });
            } else {
                await model.setField('target', 7);
            }
            gate.resolve();
            if (validation) expect(await validation).toBe(true);
            await model.settled();
            expect(model.data.target).toBe(7);
            expect(next).not.toHaveBeenCalled();
        }
    );

    test.each(['equal', 'invalid'] as const)(
        'retains remaining items after an %s direct write',
        async (operation) => {
            const gate = deferred();
            const started = deferred();
            const next = jest.fn();
            const model = own(
                createModel({
                    source: { type: 'number' },
                    target: {
                        type: 'number',
                        default: 0,
                        validator: [{ type: 'positive', message: '', validate: (v) => v >= 0 }],
                        reaction: {
                            fields: ['source'],
                            computed: () => 1,
                            action: [
                                () => {
                                    started.resolve();
                                    return gate.promise;
                                },
                                next,
                            ],
                        },
                    },
                })
            );
            await model.setField('source', 1);
            await started.promise;
            expect(await model.setField('target', operation === 'equal' ? 1 : -1)).toBe(
                operation === 'equal'
            );
            gate.resolve();
            await model.settled();
            expect(model.data.target).toBe(1);
            expect(next).toHaveBeenCalledTimes(1);
        }
    );

    test('starts ready groups in schema order and awaits each group independently', async () => {
        const gate = deferred();
        const order: string[] = [];
        const model = own(
            createModel({
                x: { type: 'number' },
                y: { type: 'number' },
                first: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['x'],
                        computed: () => 1,
                        action: [
                            () => {
                                order.push('first:0');
                                return gate.promise;
                            },
                            () => {
                                order.push('first:1');
                            },
                        ],
                    },
                },
                second: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['y'],
                        computed: () => 2,
                        action: [
                            () => {
                                order.push('second:0');
                            },
                            () => {
                                order.push('second:1');
                            },
                        ],
                    },
                },
            })
        );
        await model.setFields({ y: 1, x: 1 });
        await drain();
        expect(order).toEqual(['first:0', 'second:0', 'second:1']);
        gate.resolve();
        await model.settled();
        expect(order).toEqual(['first:0', 'second:0', 'second:1', 'first:1']);
    });

    test('pauses other sealed candidates when a preceding group starts computation', async () => {
        const gate = deferred<boolean>();
        const computing = deferred();
        const observations: number[] = [];
        const model = own(
            createModel({
                trigger: { type: 'number' },
                a: { type: 'number', default: 0 },
                b: {
                    type: 'number',
                    default: 0,
                    validator: [
                        {
                            type: 'gate',
                            message: '',
                            validate: (v) => {
                                if (v === 0) return true;
                                computing.resolve();
                                return gate.promise;
                            },
                        },
                    ],
                    reaction: { fields: ['a'], computed: ({ a }) => a * 2 },
                },
                first: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['trigger'],
                        computed: () => 1,
                        action: [
                            async () => {
                                await model.setField('a', 2);
                            },
                        ],
                    },
                },
                second: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['trigger'],
                        computed: () => 2,
                        action: [
                            () => {
                                observations.push(model.data.b);
                            },
                        ],
                    },
                },
            })
        );
        await model.settled();
        await model.setField('trigger', 1);
        await computing.promise;
        await drain();
        expect(observations).toEqual([]);
        gate.resolve(true);
        await model.settled();
        expect(observations).toEqual([4]);
    });

    test.each([false, true])(
        'isolates group errors and stops its remaining items (async: %s)',
        async (asyncError) => {
            const rest = jest.fn();
            const other = jest.fn();
            const model = own(
                createModel({
                    source: { type: 'number' },
                    first: {
                        type: 'number',
                        default: 0,
                        reaction: {
                            fields: ['source'],
                            computed: () => 1,
                            action: [
                                () => {
                                    if (asyncError) return Promise.reject(new Error('failed'));
                                    throw new Error('failed');
                                },
                                rest,
                            ],
                        },
                    },
                    second: {
                        type: 'number',
                        default: 0,
                        reaction: { fields: ['source'], computed: () => 2, action: [other] },
                    },
                })
            );
            const error = jest.fn();
            model.on('reaction:error', error);
            await model.setField('source', 1);
            await model.settled();
            expect(rest).not.toHaveBeenCalled();
            expect(other).toHaveBeenCalledTimes(1);
            expect(error).toHaveBeenCalledTimes(1);
            expect(model.validationErrors.first).toEqual([
                { field: 'first', rule: 'reaction_error', message: 'failed' },
            ]);
        }
    );

    test('records an old action rejection after a new version succeeds without cancelling it', async () => {
        const old = deferred();
        const started = deferred();
        const completed: number[] = [];
        const model = own(
            createModel({
                source: { type: 'number' },
                target: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => source * 2,
                        action: [
                            () => {
                                if (model.data.target === 2) {
                                    started.resolve();
                                    return old.promise;
                                }
                            },
                            () => {
                                completed.push(model.data.target);
                            },
                        ],
                    },
                },
            })
        );
        const errors = jest.fn();
        model.on('reaction:error', errors);
        await model.setField('source', 1);
        await started.promise;
        await model.setField('source', 2);
        await drain();
        expect(model.data.target).toBe(4);
        expect(model.validationErrors.target).toEqual([]);
        expect(completed).toEqual([4]);
        old.reject(new Error('old failure'));
        await model.settled();
        expect(model.data.target).toBe(4);
        expect(model.validationErrors.target).toEqual([
            { field: 'target', rule: 'reaction_error', message: 'old failure' },
        ]);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(completed).toEqual([4]);
    });

    test('observes rejection after dispose and releases settled without starting remaining items', async () => {
        const gate = deferred();
        const started = deferred();
        const rest = jest.fn();
        const model = own(
            createModel({
                source: { type: 'number' },
                target: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['source'],
                        computed: () => 1,
                        action: [
                            () => {
                                started.resolve();
                                return gate.promise;
                            },
                            rest,
                        ],
                    },
                },
            })
        );
        const errors = jest.fn();
        model.on('reaction:error', errors);
        await model.setField('source', 1);
        await started.promise;
        const settled = model.settled();
        model.dispose();
        await settled;
        gate.reject(new Error('disposed'));
        await drain();
        expect(rest).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
        expect(model.data).toEqual({});
        expect(model.validationErrors).toEqual({});
    });

    test('reads transformed committed values on initialization and equal computations', async () => {
        const values: number[][] = [];
        const action = jest.fn(() => {
            values.push([model.data.target, model.data.computed]);
        });
        const model = own(
            createModel({
                source: { type: 'number', default: 1 },
                computed: { type: 'number', default: 99 },
                target: {
                    type: 'number',
                    default: 20,
                    transform: (v) => v * 10,
                    reaction: {
                        fields: ['source'],
                        computed: () => 2,
                        action: [action, action],
                    },
                },
            })
        );
        expect(action).not.toHaveBeenCalled();
        await model.settled();
        await model.setField('source', 2);
        await model.settled();
        expect(values).toEqual([
            [20, 99],
            [20, 99],
            [20, 99],
            [20, 99],
        ]);
        expect(action.mock.calls).toEqual([[], [], [], []]);
    });

    test('keeps a late valid write without restoring its superseded action', async () => {
        const gate = deferred<boolean>();
        const validating = deferred();
        const action = jest.fn();
        const model = own(
            createModel({
                first: { type: 'number' },
                second: { type: 'number' },
                target: {
                    type: 'number',
                    default: 0,
                    validator: [
                        {
                            type: 'gate',
                            message: '',
                            validate: () => {
                                validating.resolve();
                                return gate.promise;
                            },
                        },
                    ],
                    reaction: {
                        fields: ['first', 'second'],
                        computed: ({ second }) => second === undefined ? 1 : SKIP_REACTION,
                        action: [action],
                    },
                },
            })
        );
        await model.setField('first', 1);
        await validating.promise;
        await model.setField('second', 1);
        gate.resolve(true);
        await model.settled();
        expect(model.data.target).toBe(1);
        expect(action).not.toHaveBeenCalled();
    });

    test.each([false, true])(
        'awaits custom PromiseLike items and handles rejection (reject: %s)',
        async (reject) => {
            const gate = deferred();
            const started = deferred();
            const rest = jest.fn();
            const thenable: PromiseLike<void> = { then: gate.promise.then.bind(gate.promise) };
            const model = own(
                createModel({
                    source: { type: 'number' },
                    target: {
                        type: 'number',
                        default: 0,
                        reaction: {
                            fields: ['source'],
                            computed: () => 1,
                            action: [
                                () => {
                                    started.resolve();
                                    return thenable;
                                },
                                rest,
                            ],
                        },
                    },
                })
            );
            const errors = jest.fn();
            model.on('reaction:error', errors);
            await model.setField('source', 1);
            await started.promise;
            let idle = false;
            const settled = model.settled().then(() => {
                idle = true;
            });
            await drain();
            expect(idle).toBe(false);
            expect(rest).not.toHaveBeenCalled();
            if (reject) gate.reject(new Error('thenable failure'));
            else gate.resolve();
            await settled;
            expect(rest).toHaveBeenCalledTimes(reject ? 0 : 1);
            expect(errors).toHaveBeenCalledTimes(reject ? 1 : 0);
        }
    );

    test('preserves separate hosts when they share the same reaction and action references', async () => {
        const values: number[][] = [];
        const action = jest.fn(() => {
            values.push([model.data.first, model.data.second]);
        });
        const shared: Reaction<number> = {
            fields: ['source'],
            computed: ({ source }) => source * 2,
            action: [action],
        };
        const model = own(
            createModel({
                source: { type: 'number' },
                first: { type: 'number', default: 0, reaction: shared },
                second: { type: 'number', default: 0, reaction: shared },
            })
        );
        await model.setField('source', 2);
        await model.settled();
        expect(values).toEqual([
            [4, 4],
            [4, 4],
        ]);
        expect(action).toHaveBeenCalledTimes(2);
    });

    test('keeps captured snapshot values stable while later items read a newer batch', async () => {
        const gate = deferred();
        const started = deferred();
        const observations: number[][] = [];
        const model = own(
            createModel({
                trigger: { type: 'number' },
                a: { type: 'number', default: 1 },
                b: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['a'],
                        computed: ({ a }) => a * 2,
                    },
                },
                target: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['trigger'],
                        computed: () => 1,
                        action: [
                            async () => {
                                const data = model.data;
                                started.resolve();
                                await gate.promise;
                                observations.push([data.a, data.b, model.data.a, model.data.b]);
                            },
                            () => {
                                observations.push([model.data.a, model.data.b]);
                            },
                        ],
                    },
                },
            })
        );
        await model.settled();
        await model.setField('trigger', 1);
        await started.promise;
        await model.setField('a', 2);
        await drain();
        gate.resolve();
        await model.settled();
        expect(observations).toEqual([
            [1, 2, 2, 4],
            [2, 4],
        ]);
    });

    test('does not track a business Promise that an action neither returns nor awaits', async () => {
        const gate = deferred();
        const completed = jest.fn();
        const model = own(
            createModel({
                source: { type: 'number' },
                target: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['source'],
                        computed: () => 1,
                        action: [
                            () => {
                                void gate.promise.then(completed);
                            },
                        ],
                    },
                },
            })
        );
        await model.setField('source', 1);
        await model.settled();
        expect(completed).not.toHaveBeenCalled();
        gate.resolve();
        await drain();
        expect(completed).toHaveBeenCalledTimes(1);
    });

    test.each([0, 5])(
        'finishes a partially invalid batch before running valid actions (debounce: %s)',
        async (debounceReactions) => {
            const observations: number[][] = [];
            const model = own(
                createModel(
                    {
                        source: { type: 'number', default: 0 },
                        rejected: {
                            type: 'number',
                            default: 0,
                            validator: [
                                {
                                    type: 'positive',
                                    message: 'positive',
                                    validate: async (v) => v >= 0,
                                },
                            ],
                        },
                        target: {
                            type: 'number',
                            default: 0,
                            reaction: {
                                fields: ['source'],
                                computed: ({ source }) => source * 2,
                                action: [
                                    () => {
                                        observations.push([
                                            model.data.source,
                                            model.data.target,
                                            model.data.rejected,
                                        ]);
                                    },
                                ],
                            },
                        },
                    },
                    { debounceReactions }
                )
            );
            await model.settled();
            observations.length = 0;
            expect(await model.setFields({ source: 2, rejected: -1 })).toBe(false);
            await model.settled();
            expect(observations).toEqual([[2, 4, 0]]);
            expect(model.getDirtyData()).toEqual({ rejected: -1 });
        }
    );
});

describe('ActionExecutor task lifecycle', () => {
    test('rechecks computation after an idle notification and cancels a waiting group immediately', async () => {
        const tasks = new PendingTasks();
        const action = jest.fn();
        const executor = new ActionExecutor(['target'], tasks, jest.fn());
        const end = tasks.begin();
        const version = executor.invalidate('target');
        executor.register(
            { field: 'target', reaction: { fields: [], computed: () => 1, action: [action] } },
            version
        );
        end();
        const newCompute = tasks.begin();
        await drain();
        expect(action).not.toHaveBeenCalled();
        executor.invalidate('target');
        newCompute();
        await tasks.settled();
        expect(action).not.toHaveBeenCalled();
        executor.dispose();
        tasks.dispose();
    });

    test('cancels a candidate at handoff before the next group starts', async () => {
        const tasks = new PendingTasks();
        const second = jest.fn();
        const executor = new ActionExecutor(['first', 'second'], tasks, jest.fn());
        const end = tasks.begin();
        executor.register(
            {
                field: 'first',
                reaction: {
                    fields: [],
                    computed: () => 1,
                    action: [
                        () => {
                            executor.invalidate('second');
                        },
                    ],
                },
            },
            executor.invalidate('first')
        );
        executor.register(
            { field: 'second', reaction: { fields: [], computed: () => 1, action: [second] } },
            executor.invalidate('second')
        );
        end();
        await tasks.settled();
        expect(second).not.toHaveBeenCalled();
        executor.dispose();
        tasks.dispose();
    });
});
