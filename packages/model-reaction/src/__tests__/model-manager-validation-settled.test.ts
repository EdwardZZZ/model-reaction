import { createModel, Model, ModelEvents } from '../index';
import { ValidationRules } from '../validation';

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

describe('ModelManager - full validation settlement', () => {
    const cleanups: Array<() => void> = [];
    function own<T extends { dispose: () => void }>(model: T): T {
        cleanups.push(model.dispose);
        return model;
    }

    afterEach(() => {
        cleanups.splice(0).forEach((dispose) => dispose());
    });

    test.each([0, 16])(
        'waits for dirty promotion, derived cascades, and async actions (debounce %i)',
        async (debounceReactions) => {
            let allowed = false;
            const gate = deferred();
            const started = deferred();
            const complete = jest.fn();
            const calls: string[] = [];
            const model = own(createModel({
                source: {
                    type: 'number',
                    default: 0,
                    validator: [{ type: 'allowed', message: '', validate: () => allowed }],
                },
                doubled: {
                    type: 'number',
                    default: 0,
                    reaction: { fields: ['source'], computed: ({ source }) => source * 2 },
                },
                total: {
                    type: 'number',
                    default: 1,
                    reaction: {
                        fields: ['doubled'],
                        computed: ({ doubled }) => doubled + 1,
                        action: [
                            () => {
                                if (model.data.total !== 3) return;
                                calls.push('first');
                                started.resolve();
                                return gate.promise;
                            },
                            () => { calls.push('second'); },
                        ],
                    },
                },
            }, { debounceReactions }));
            await model.settled();
            calls.length = 0;
            expect(await model.setField('source', 1)).toBe(false);
            allowed = true;
            model.on(ModelEvents.VALIDATION_COMPLETE, complete);
            let finished = false;
            const validation = model.validateAll().then((valid) => {
                finished = true;
                return valid;
            });
            await started.promise;
            expect(model.data).toEqual({ source: 1, doubled: 2, total: 3 });
            expect(finished).toBe(false);
            expect(complete).not.toHaveBeenCalled();
            gate.resolve();
            expect(await validation).toBe(true);
            expect(calls).toEqual(['first', 'second']);
            expect(complete).toHaveBeenCalledTimes(1);
            expect(complete).toHaveBeenCalledWith({ isValid: true });
            expect(model.getDirtyData()).toEqual({});
        }
    );

    test('waits for every action group and for action writeback cascades', async () => {
        let allowed = false;
        const leftGate = deferred();
        const rightGate = deferred();
        const outputGate = deferred();
        const outputStarted = deferred();
        const calls: string[] = [];
        const model = own(createModel({
            source: {
                type: 'number', default: 0,
                validator: [{ type: 'allowed', message: '', validate: () => allowed }],
            },
            left: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['source'], computed: ({ source }) => source * 2,
                    action: [async () => {
                        if (model.data.left !== 2) return;
                        calls.push('left');
                        await leftGate.promise;
                        await model.setField('writeback', model.data.left);
                    }],
                },
            },
            right: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['source'], computed: ({ source }) => source * 3,
                    action: [() => {
                        if (model.data.right !== 3) return;
                        calls.push('right');
                        return rightGate.promise;
                    }],
                },
            },
            writeback: { type: 'number', default: 0 },
            output: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['writeback'], computed: ({ writeback }) => writeback * 10,
                    action: [() => {
                        if (model.data.output !== 20) return;
                        outputStarted.resolve();
                        return outputGate.promise;
                    }],
                },
            },
        }));
        await model.settled();
        expect(await model.setField('source', 1)).toBe(false);
        allowed = true;
        let finished = false;
        const validation = model.validateAll().then((valid) => {
            finished = true;
            return valid;
        });
        await drain();
        expect(calls).toEqual(['left', 'right']);
        leftGate.resolve();
        await outputStarted.promise;
        expect(model.data.output).toBe(20);
        rightGate.resolve();
        await drain();
        expect(finished).toBe(false);
        outputGate.resolve();
        expect(await validation).toBe(true);
    });

    test('waits for successful sibling work even when the full pass fails', async () => {
        let allowed = false;
        const gate = deferred();
        const started = deferred();
        const model = own(createModel({
            source: {
                type: 'number', default: 0,
                validator: [{ type: 'allowed', message: '', validate: () => allowed }],
            },
            required: { type: 'string', default: '', validator: [ValidationRules.required] },
            target: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['source'], computed: ({ source }) => source,
                    action: [() => {
                        if (model.data.target !== 1) return;
                        started.resolve();
                        return gate.promise;
                    }],
                },
            },
        }));
        await model.settled();
        await model.setField('source', 1);
        allowed = true;
        let finished = false;
        const validation = model.validateAll().then((valid) => {
            finished = true;
            return valid;
        });
        await started.promise;
        expect(finished).toBe(false);
        gate.resolve();
        expect(await validation).toBe(false);
        expect(model.data.target).toBe(1);
        expect(model.getDirtyData()).toHaveProperty('required', '');
    });

    test.each(['throw', 'invalid'] as const)(
        'includes a subsequent computed %s in the final result',
        async (failure) => {
            let allowed = false;
            const action = jest.fn();
            const model = own(createModel({
                source: {
                    type: 'number', default: 0,
                    validator: [{ type: 'allowed', message: '', validate: () => allowed }],
                },
                target: {
                    type: 'number', default: 0,
                    validator: [ValidationRules.min(0)],
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => {
                            if (source === 0) return 0;
                            if (failure === 'throw') throw new Error('computation failed');
                            return -1;
                        },
                        action: [action],
                    },
                },
            }));
            await model.settled();
            action.mockClear();
            await model.setField('source', 1);
            allowed = true;
            expect(await model.validateAll()).toBe(false);
            expect(model.data.target).toBe(0);
            expect(model.validationErrors.target!.length).toBeGreaterThan(0);
            expect(action).not.toHaveBeenCalled();
            if (failure === 'invalid') expect(model.getDirtyData()).toHaveProperty('target', -1);
        }
    );

    test.each(['throw', 'reject', 'write'] as const)(
        'includes action %s failure in the final result',
        async (failure) => {
            let allowed = false;
            const reactionError = jest.fn();
            const complete = jest.fn();
            const model = own(createModel({
                source: {
                    type: 'number', default: 0,
                    validator: [{ type: 'allowed', message: '', validate: () => allowed }],
                },
                destination: { type: 'number', default: 0, validator: [ValidationRules.min(0)] },
                target: {
                    type: 'number', default: 0,
                    reaction: {
                        fields: ['source'], computed: ({ source }) => source,
                        action: [async () => {
                            if (model.data.target !== 1) return;
                            if (failure === 'throw') throw new Error('action failed');
                            if (failure === 'reject') await Promise.reject(new Error('action failed'));
                            else await model.setField('destination', -1);
                        }],
                    },
                },
            }));
            await model.settled();
            await model.setField('source', 1);
            allowed = true;
            model.on(ModelEvents.REACTION_ERROR, reactionError);
            model.on(ModelEvents.VALIDATION_COMPLETE, complete);
            expect(await model.validateAll()).toBe(false);
            expect(complete).toHaveBeenCalledWith({ isValid: false });
            if (failure === 'write') {
                expect(model.getDirtyData()).toHaveProperty('destination', -1);
                expect(reactionError).not.toHaveBeenCalled();
            } else {
                expect(model.validationErrors.target).toEqual([
                    { field: 'target', rule: 'reaction_error', message: 'action failed' },
                ]);
                expect(reactionError).toHaveBeenCalledTimes(1);
            }
        }
    );

    test('waits for a stale running action and includes its late error', async () => {
        const gate = deferred();
        const started = deferred();
        const model = own(createModel({
            source: { type: 'number', default: 0 },
            target: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['source'], computed: ({ source }) => source,
                    action: [() => {
                        if (model.data.target !== 1) return;
                        started.resolve();
                        return gate.promise;
                    }],
                },
            },
        }));
        await model.settled();
        await model.setField('source', 1);
        await started.promise;
        await model.setField('target', 7);
        let finished = false;
        const validation = model.validateAll().then((valid) => {
            finished = true;
            return valid;
        });
        await drain();
        expect(finished).toBe(false);
        gate.reject(new Error('late failure'));
        expect(await validation).toBe(false);
        expect(model.data.target).toBe(7);
        expect(model.validationErrors.target![0]!.message).toBe('late failure');
    });

    test('keeps a failed full pass false even if an action repairs its field', async () => {
        let allowed = false;
        const model = own(createModel({
            source: {
                type: 'number', default: 0,
                validator: [{ type: 'allowed', message: '', validate: () => allowed }],
            },
            required: { type: 'string', default: '', validator: [ValidationRules.required] },
            target: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['source'], computed: ({ source }) => source,
                    action: [async () => {
                        if (model.data.target === 1) await model.setField('required', 'repaired');
                    }],
                },
            },
        }));
        await model.settled();
        await model.setField('source', 1);
        allowed = true;
        expect(await model.validateAll()).toBe(false);
        expect(model.data.required).toBe('repaired');
        expect(model.getDirtyData()).toEqual({});
        expect(Object.values(model.validationErrors).flat()).toEqual([]);
    });

    test.each(['validation', 'action'] as const)(
        'returns false without completion when disposed during %s',
        async (phase) => {
            const gate = deferred<boolean>();
            const started = deferred();
            let waiting = false;
            const complete = jest.fn();
            const reactionError = jest.fn();
            const model = own(createModel({
                source: {
                    type: 'number', default: 0,
                    validator: [{
                        type: 'gate', message: '',
                        validate: () => {
                            if (!waiting || phase === 'action') return true;
                            started.resolve();
                            return gate.promise;
                        },
                    }],
                },
                target: {
                    type: 'number', default: 0,
                    reaction: {
                        fields: ['source'], computed: ({ source }) => source,
                        action: [() => {
                            if (!waiting || phase === 'validation') return;
                            started.resolve();
                            return gate.promise.then(() => undefined);
                        }],
                    },
                },
            }));
            await model.settled();
            waiting = true;
            if (phase === 'action') await model.setField('source', 1);
            model.on(ModelEvents.VALIDATION_COMPLETE, complete);
            model.on(ModelEvents.REACTION_ERROR, reactionError);
            let finished = false;
            const validation = model.validateAll().then((valid) => {
                finished = true;
                return valid;
            });
            await started.promise;
            model.dispose();
            await model.settled();
            if (phase === 'validation') {
                expect(finished).toBe(false);
                gate.resolve(true);
            }
            expect(await validation).toBe(false);
            if (phase === 'action') gate.reject(new Error('after disposal'));
            await drain();
            expect(complete).not.toHaveBeenCalled();
            expect(reactionError).not.toHaveBeenCalled();
            expect(model.validationErrors).toEqual({});
        }
    );

    test('waits before propagating a batch exception without a completion event', async () => {
        const gate = deferred();
        const started = deferred();
        const failure = new Error('schema read failed');
        let failRead = false;
        const schema: Model<{ source: number; target: number; other: number }> = {
            source: { type: 'number', default: 0 },
            target: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['source'], computed: ({ source }) => source,
                    action: [() => {
                        if (model.data.target !== 1) return;
                        started.resolve();
                        return gate.promise;
                    }],
                },
            },
            other: { type: 'number', default: 0 },
        };
        const other = schema.other;
        Object.defineProperty(schema, 'other', {
            enumerable: true,
            get: () => {
                if (failRead) throw failure;
                return other;
            },
        });
        const model = own(createModel(schema));
        const complete = jest.fn();
        await model.settled();
        await model.setField('source', 1);
        await started.promise;
        model.on(ModelEvents.VALIDATION_COMPLETE, complete);
        failRead = true;
        let finished = false;
        const validation = model.validateAll().then(
            () => { throw new Error('expected rejection'); },
            (error: unknown) => { finished = true; return error; }
        );
        await drain();
        expect(finished).toBe(false);
        gate.resolve();
        expect(await validation).toBe(failure);
        expect(complete).not.toHaveBeenCalled();
    });

    test('allows concurrent external validation without a global task deadlock', async () => {
        const first = deferred<boolean>();
        const second = deferred<boolean>();
        let calls = 0;
        const model = own(createModel({
            source: {
                type: 'number', default: 0,
                validator: [{
                    type: 'gate', message: '',
                    validate: () => (++calls === 1 ? first.promise : second.promise),
                }],
            },
        }));
        const complete = jest.fn();
        model.on(ModelEvents.VALIDATION_COMPLETE, complete);
        const firstValidation = model.validateAll();
        const secondValidation = model.validateAll();
        expect(calls).toBe(2);
        first.resolve(true);
        await drain();
        expect(complete).not.toHaveBeenCalled();
        second.resolve(true);
        expect(await Promise.all([firstValidation, secondValidation])).toEqual([false, true]);
        expect(complete.mock.calls).toEqual([[{ isValid: false }], [{ isValid: true }]]);
    });

    test('treats completion-listener writes as subsequent work', async () => {
        const gate = deferred<boolean>();
        let waiting = false;
        let write: Promise<boolean> | undefined;
        const model = own(createModel({
            source: {
                type: 'number', default: 0,
                validator: [{
                    type: 'gate', message: '',
                    validate: () => waiting ? gate.promise : true,
                }],
            },
        }));
        const complete = jest.fn(() => {
            waiting = true;
            write = model.setField('source', 1);
        });
        model.on(ModelEvents.VALIDATION_COMPLETE, complete);
        expect(await model.validateAll()).toBe(true);
        expect(model.data.source).toBe(0);
        expect(complete).toHaveBeenCalledTimes(1);
        gate.resolve(true);
        expect(await write).toBe(true);
        expect(model.data.source).toBe(1);
    });

    test('does not revalidate untouched cross-field rules after action writeback', async () => {
        let allowed = false;
        const dailyValidation = jest.fn((value: number, data?: Record<string, unknown>) =>
            value <= (data!.budget as number)
        );
        const model = own(createModel({
            source: {
                type: 'number', default: 0,
                validator: [{ type: 'allowed', message: '', validate: () => allowed }],
            },
            budget: { type: 'number', default: 1000 },
            dailyBudget: {
                type: 'number', default: 900,
                validator: [{ type: 'budget', message: '', validate: dailyValidation }],
            },
            target: {
                type: 'number', default: 0,
                reaction: {
                    fields: ['source'], computed: ({ source }) => source,
                    action: [async () => {
                        if (model.data.target === 1) await model.setField('budget', 100);
                    }],
                },
            },
        }));
        await model.settled();
        await model.setField('source', 1);
        allowed = true;
        expect(await model.validateAll()).toBe(true);
        expect(model.data.budget).toBe(100);
        expect(model.data.dailyBudget).toBe(900);
        expect(dailyValidation).toHaveBeenCalledTimes(1);
    });
});
