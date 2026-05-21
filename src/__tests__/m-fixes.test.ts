import { createModel, Model, ErrorHandler, ErrorType } from '../index';

// =============================================================================
// Tests for M-level fixes: dispose safety, error-handler sharing,
// EventEmitter robustness, strictMode, settled() with in-flight validation
// =============================================================================

describe('M-fixes: strictMode', () => {
    test('setField on unknown field throws under strictMode=true', async () => {
        const model = createModel<{ a: number }>(
            { a: { type: 'number', default: 0 } },
            { strictMode: true }
        );

        await expect(
            // @ts-expect-error intentional unknown field
            model.setField('unknown', 1)
        ).rejects.toThrow(/does not exist in the model schema/);

        model.dispose();
    });

    test('setField on unknown field returns false (no throw) without strictMode', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 }
        });

        const ok = await (model as any).setField('unknown', 1);
        expect(ok).toBe(false);
        model.dispose();
    });
});

describe('M-fixes: dispose-after-use guards', () => {
    test('setField/setFields/validateAll throw after dispose', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 }
        });
        model.dispose();

        await expect(model.setField('a', 1)).rejects.toThrow(/disposed/);
        await expect(model.setFields({ a: 1 })).rejects.toThrow(/disposed/);
        await expect(model.validateAll()).rejects.toThrow(/disposed/);
    });

    test('dispose is idempotent', () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 }
        });
        expect(() => {
            model.dispose();
            model.dispose();
        }).not.toThrow();
    });
});

describe('M-fixes: shared ErrorHandler is preserved across dispose', () => {
    test('disposing one model does NOT remove other listeners on a shared handler', async () => {
        const sharedHandler = new ErrorHandler();
        const externalCalls: string[] = [];
        sharedHandler.onError(ErrorType.VALIDATION, (e) => {
            externalCalls.push(e.message);
        });

        const modelA = createModel<{ x: string }>(
            {
                x: {
                    type: 'string',
                    default: '',
                    validator: [
                        {
                            type: 'always',
                            message: 'always-fail',
                            validate: () => false
                        }
                    ]
                }
            },
            { errorHandler: sharedHandler }
        );

        // Dispose A — must not wipe the externally-registered listener.
        modelA.dispose();

        const modelB = createModel<{ y: string }>(
            {
                y: {
                    type: 'string',
                    default: '',
                    validator: [
                        {
                            type: 'always',
                            message: 'always-fail-B',
                            validate: () => false
                        }
                    ]
                }
            },
            { errorHandler: sharedHandler }
        );

        await modelB.setField('y', 'something');
        expect(externalCalls).toContain('always-fail-B');

        modelB.dispose();

        // After disposing both, the external listener should still be functional.
        sharedHandler.triggerError(
            sharedHandler.createValidationError('manual', 'manual-error')
        );
        expect(externalCalls).toContain('manual-error');
    });

    test('internally-created errorHandler IS fully cleaned up on dispose', () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 }
        });
        // No external handler -> dispose should be safe and not throw
        expect(() => model.dispose()).not.toThrow();
    });
});

describe('M-fixes: EventEmitter robustness', () => {
    test('listener throwing does not prevent subsequent listeners', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 }
        });
        const calls: string[] = [];
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        model.on('field:change', () => {
            calls.push('first');
            throw new Error('boom');
        });
        model.on('field:change', () => {
            calls.push('second');
        });

        await model.setField('a', 5);

        expect(calls).toEqual(['first', 'second']);
        // Error should be logged, not silently swallowed
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
        model.dispose();
    });

    test('listener added during emit is NOT invoked in the same dispatch', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 }
        });
        const calls: string[] = [];
        let added = false;

        model.on('field:change', () => {
            calls.push('outer');
            if (!added) {
                added = true;
                model.on('field:change', () => calls.push('inner'));
            }
        });

        await model.setField('a', 1);
        // Snapshotted dispatch -> inner should not fire on this emit
        expect(calls).toEqual(['outer']);

        await model.setField('a', 2);
        // On next emit, inner should run
        expect(calls).toContain('inner');

        model.dispose();
    });
});

describe('M-fixes: settled() waits for in-flight async validation', () => {
    test('settled resolves only after slow async validators complete', async () => {
        let resolveValidator: ((v: boolean) => void) | null = null;

        interface S { f: string; }
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
                            })
                    }
                ]
            }
        };
        const model = createModel<S>(schema);

        // Don't await — kick off and observe pending state
        const setPromise = model.setField('f', 'hi');

        // Run microtasks so the validator registers itself
        await Promise.resolve();
        await Promise.resolve();
        expect(resolveValidator).toBeTruthy();

        let settledDone = false;
        const settledPromise = model.settled().then(() => {
            settledDone = true;
        });

        // Give settled() a chance — but it must NOT resolve while validator pending
        await new Promise((r) => setTimeout(r, 10));
        expect(settledDone).toBe(false);

        // Now resolve the validator
        resolveValidator!(true);

        await setPromise;
        await settledPromise;
        expect(settledDone).toBe(true);

        model.dispose();
    });

    test('settled() returns immediately when nothing is pending', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 }
        });
        const start = Date.now();
        await model.settled();
        expect(Date.now() - start).toBeLessThan(50);
        model.dispose();
    });
});
