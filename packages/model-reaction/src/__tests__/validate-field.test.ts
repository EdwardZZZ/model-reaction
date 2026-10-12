import { validateField } from '../validation/validate-field';
import { FieldSchema, ValidationError } from '../types';
import { Rule, ValidationRules } from '../validation/rules';
import { createModel, Model } from '../index';
import { runInNewContext } from 'vm';

describe('validateField (unit)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('returns true when schema has no validators', async () => {
        const schema: FieldSchema = { type: 'string' };
        const onError = jest.fn();

        const result = await validateField({
            schema,
            value: 'value',
            onError,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    test.each([false, true])(
        'boolean validators report asynchronously without timeout tasks (valid: %s)',
        async (valid) => {
            const timeout = jest.spyOn(globalThis, 'setTimeout');
            const onError = jest.fn();
            const result = validateField({
                schema: {
                    type: 'string',
                    validator: [{ type: 'sync', message: 'sync failure', validate: () => valid }],
                },
                field: 'field',
                value: 'value',
                onError,
            });

            expect(onError).not.toHaveBeenCalled();
            expect(await result).toBe(valid);
            expect(timeout).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledTimes(valid ? 0 : 1);
        }
    );

    test('only async validators allocate and release timeout tasks in a mixed field', async () => {
        let release!: (valid: boolean) => void;
        const pending = new Promise<boolean>((resolve) => { release = resolve; });
        const timeout = jest.spyOn(globalThis, 'setTimeout');
        const clear = jest.spyOn(globalThis, 'clearTimeout');
        const result = validateField({
            schema: {
                type: 'string',
                validator: [
                    { type: 'sync', message: 'sync', validate: () => true },
                    { type: 'async', message: 'async', validate: () => pending },
                ],
            },
            field: 'field',
            value: 'value',
        });

        try {
            expect(timeout).toHaveBeenCalledTimes(1);
            expect(clear).not.toHaveBeenCalled();
            release(true);
            expect(await result).toBe(true);
            expect(clear).toHaveBeenCalledWith(timeout.mock.results[0]!.value);
        } finally {
            release(true);
            await result;
        }
    });

    test('skips validators that lack a validate method', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                // @ts-expect-error - simulating invalid validator object
                {
                    type: 'custom',
                    message: 'error',
                    // missing validate method
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'value',
            onError,
            field: 'testField',
            timeout: 1000,
        });
        expect(result).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    test('catches synchronous validator throwing an Error', async () => {
        const onError = jest.fn();

        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'throws',
                    message: 'should not be used',
                    validate: () => {
                        throw new Error('sync boom');
                    },
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'value',
            field: 'testField',
            timeout: 1000,
            onError,
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith({
            field: 'testField',
            rule: 'validation_error',
            message: 'Validation failed: sync boom',
        });
    });

    test('catches synchronous validator throwing a non-Error value', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'throws',
                    message: 'should not be used',
                    validate: () => {
                        throw 'sync string';
                    },
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'value',
            onError,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith({
            field: 'testField',
            rule: 'validation_error',
            message: 'Validation failed: sync string',
        });
    });

    test('catches async validator rejection with non-Error value', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'async',
                    message: 'async failed',
                    validate: () => Promise.reject('async string'),
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'value',
            onError,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith({
            field: 'testField',
            rule: 'validation_error',
            message: 'Validation failed: async string',
        });
    });

    test('awaits a Promise returned from another realm', async () => {
        const onError = jest.fn();
        const crossRealmResult = runInNewContext(
            'Promise.resolve(false)'
        ) as Promise<boolean>;
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'cross-realm',
                    message: 'cross-realm failure',
                    validate: () => crossRealmResult,
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'value',
            onError,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith({
            field: 'testField',
            rule: 'cross-realm',
            message: 'cross-realm failure',
        });
    });

    test('leaves collection and storage of reported errors to the caller', async () => {
        const errors: ValidationError[] = [
            { field: 'testField', rule: 'existing', message: 'existing' },
        ];
        const onError = jest.fn((error: ValidationError) => errors.push(error));

        const schema: FieldSchema = {
            type: 'string',
            validator: [
                { type: 'required', message: 'required', validate: () => false },
            ],
        };

        const result = await validateField({
            schema,
            value: '',
            onError,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([
            { field: 'testField', rule: 'existing', message: 'existing' },
            { field: 'testField', rule: 'required', message: 'required' },
        ]);
    });

    test('returns false without an error reporter when validation fails', async () => {
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                { type: 'required', message: 'required', validate: () => false },
            ],
        };

        const result = await validateField({
            schema,
            value: '',
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
    });

    test('uses default timeout / failFast when not provided', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [{ type: 'ok', message: 'ok', validate: () => true }],
        };

        const result = await validateField({
            schema,
            value: 'value',
            onError,
            field: 'testField',
        });

        expect(result).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    test('async validator that exceeds timeout records timeout error', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'slow',
                    message: 'slow',
                    validate: () => new Promise<boolean>(() => {}),
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'v',
            onError,
            field: 'f',
            timeout: 20,
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith({
            field: 'f',
            rule: 'validation_error',
            message: 'Validation failed: Validation timeout: f',
        });
    });

    test('isCurrent guard suppresses stale sync failures', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                { type: 'fail', message: 'fail', validate: () => false },
            ],
        };

        const result = await validateField({
            schema,
            value: 'v',
            onError,
            field: 'f',
            isCurrent: () => false,
        });

        expect(result).toBe(false);
        expect(onError).not.toHaveBeenCalled();
    });

    test('isCurrent guard suppresses stale async failures', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'asyncFail',
                    message: 'fail',
                    validate: async () => false,
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'v',
            onError,
            field: 'f',
            isCurrent: () => false,
        });

        expect(result).toBe(false);
        expect(onError).not.toHaveBeenCalled();
    });

    test('isCurrent guard suppresses stale async *rejections*', async () => {
        // Distinct from the "returns false" case above: here the async
        // validator throws, exercising the catch branch's stale-request guard.
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'asyncThrow',
                    message: 'boom',
                    validate: async () => {
                        throw new Error('network down');
                    },
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'v',
            onError,
            field: 'f',
            isCurrent: () => false,
        });

        expect(result).toBe(false);
        expect(onError).not.toHaveBeenCalled();
    });

    test('records async rejection error when the request is still current', async () => {
        // Complements the stale-guard test: with isCurrent true (the default),
        // a rejection is turned into a recorded validation error.
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'asyncThrow',
                    message: 'boom',
                    validate: async () => {
                        throw new Error('network down');
                    },
                },
            ],
        };

        const result = await validateField({
            schema,
            value: 'v',
            onError,
            field: 'f',
            isCurrent: () => true,
        });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith({
            field: 'f',
            rule: 'validation_error',
            message: 'Validation failed: network down',
        });
    });

    test('passes cross-field data to validator', async () => {
        let receivedData: any = null;
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'check',
                    message: 'no',
                    validate: (_v, data) => {
                        receivedData = data;
                        return true;
                    },
                },
            ],
        };

        await validateField({
            schema,
            value: 'v',
            field: 'f',
            data: { other: 'value' },
        });

        expect(receivedData).toEqual({ other: 'value' });
    });

    test('skips validators whose condition returns false', async () => {
        const onError = jest.fn();
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                {
                    type: 'cond',
                    message: 'should not fire',
                    validate: () => false,
                    condition: () => false,
                },
            ],
        };
        const result = await validateField({
            schema,
            value: 'v',
            onError,
            field: 'f',
        });
        expect(result).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    test('filters all conditions before running applicable validators', async () => {
        const order: string[] = [];
        const onError = jest.fn();
        const result = await validateField({
            schema: {
                type: 'string',
                validator: [
                    {
                        type: 'applicable',
                        message: 'failure',
                        condition: () => { order.push('first condition'); return true; },
                        validate: () => { order.push('validate'); return false; },
                    },
                    {
                        type: 'broken condition',
                        message: 'unused',
                        condition: () => { order.push('second condition'); throw new Error('boom'); },
                        validate: () => { throw new Error('must not run'); },
                    },
                ],
            },
            field: 'f',
            value: 'v',
            onError,
        });

        expect(result).toBe(false);
        expect(order).toEqual(['first condition', 'second condition', 'validate']);
        expect(onError.mock.calls.map(([error]) => error.rule)).toEqual([
            'condition_error', 'applicable',
        ]);
    });

    test.each([false, true])(
        'a failed condition stops failFast validation without reporting stale errors (current: %s)',
        async (current) => {
            const validate = jest.fn(() => false);
            const onError = jest.fn();
            const result = await validateField({
                schema: {
                    type: 'string',
                    validator: [
                        { type: 'first', message: 'first', validate },
                        {
                            type: 'condition',
                            message: 'unused',
                            condition: () => { throw new Error('boom'); },
                            validate,
                        },
                    ],
                },
                field: 'f',
                value: 'v',
                failFast: true,
                isCurrent: () => current,
                onError,
            });

            expect(result).toBe(false);
            expect(validate).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledTimes(current ? 1 : 0);
            if (current) {
                expect(onError).toHaveBeenCalledWith({
                    field: 'f',
                    rule: 'condition_error',
                    message: 'Validation condition failed: boom',
                });
            }
        }
    );

    test('runs validators concurrently and reports errors in completion order', async () => {
        let release!: (value: boolean) => void;
        let signalFast!: () => void;
        const slow = new Promise<boolean>((resolve) => { release = resolve; });
        const fastReported = new Promise<void>((resolve) => { signalFast = resolve; });
        const onError = jest.fn((error: ValidationError) => {
            if (error.rule === 'fast') signalFast();
        });
        const validateSlow = jest.fn(() => slow);
        const validateFast = jest.fn(() => false);
        const result = validateField({
            schema: {
                type: 'string',
                validator: [
                    { type: 'slow', message: 'slow', validate: validateSlow },
                    { type: 'fast', message: 'fast', validate: validateFast },
                ],
            },
            field: 'f',
            value: 'v',
            onError,
        });

        try {
            expect(validateSlow).toHaveBeenCalledTimes(1);
            expect(validateFast).toHaveBeenCalledTimes(1);
            await fastReported;
            expect(onError.mock.calls.map(([error]) => error.rule)).toEqual(['fast']);
            release(false);
            expect(await result).toBe(false);
            expect(onError.mock.calls.map(([error]) => error.rule)).toEqual(['fast', 'slow']);
        } finally {
            release(false);
            await result;
        }
    });

    describe('failFast strategy', () => {
        test('runs all validators by default (failFast=false)', async () => {
            interface S {
                field: string;
            }
            const schema: Model<S> = {
                field: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Required error'),
                        new Rule('length', 'Length error', () => false),
                        new Rule('format', 'Format error', () => false),
                    ],
                    default: '',
                },
            };

            const model = createModel<S>(schema);
            await model.setField('field', '');

            const errors = model.validationErrors['field'];
            expect(errors).toHaveLength(3);
            expect(errors![0]!.message).toBe('Required error');
            expect(errors![1]!.message).toBe('Length error');
            expect(errors![2]!.message).toBe('Format error');
            model.dispose();
        });

        test('stops at first error when failFast=true', async () => {
            interface S {
                field: string;
            }
            const schema: Model<S> = {
                field: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Required error'),
                        new Rule('length', 'Length error', () => false),
                        new Rule('format', 'Format error', () => false),
                    ],
                    default: '',
                },
            };

            const model = createModel<S>(schema, { failFast: true });
            await model.setField('field', '');

            const errors = model.validationErrors['field'];
            expect(errors).toHaveLength(1);
            expect(errors![0]!.message).toBe('Required error');
            model.dispose();
        });

        test('runs subsequent rules if previous ones pass with failFast=true', async () => {
            interface S {
                field: string;
            }
            const schema: Model<S> = {
                field: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Required error'),
                        new Rule('length', 'Length error', (val) => val.length > 5),
                        new Rule('format', 'Format error', () => false),
                    ],
                    default: '',
                },
            };

            const model = createModel<S>(schema, { failFast: true });
            await model.setField('field', 'short');

            const errors = model.validationErrors['field'];
            expect(errors).toHaveLength(1);
            expect(errors![0]!.message).toBe('Length error');
            model.dispose();
        });

        test('handles async rules with failFast=true', async () => {
            const asyncSpy = jest.fn();
            interface S {
                field: string;
            }
            const schema: Model<S> = {
                field: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Required error'),
                        new Rule('async', 'Async error', async () => {
                            asyncSpy();
                            await new Promise((r) => setTimeout(r, 10));
                            return false;
                        }),
                        new Rule('afterAsync', 'After async error', () => false),
                    ],
                    default: '',
                },
            };

            const model = createModel<S>(schema, { failFast: true });

            await model.setField('field', '');
            expect(asyncSpy).not.toHaveBeenCalled();
            expect(model.validationErrors['field']).toHaveLength(1);
            expect(model.validationErrors['field']![0]!.message).toBe(
                'Required error'
            );

            asyncSpy.mockClear();
            await model.setField('field', 'value');
            expect(asyncSpy).toHaveBeenCalled();
            expect(model.validationErrors['field']).toHaveLength(1);
            expect(model.validationErrors['field']![0]!.message).toBe('Async error');
            model.dispose();
        });
    });
});

describe('validateField race-condition (H8): stale async errors are guarded', () => {
    test('slow stale validator should NOT push errors after a newer request resolves', async () => {
        let firstResolve: ((v: boolean) => void) | null = null;
        let secondResolve: ((v: boolean) => void) | null = null;
        let call = 0;

        interface S {
            f: string;
        }
        const schema: Model<S> = {
            f: {
                type: 'string',
                default: '',
                validator: [
                    {
                        type: 'asyncCheck',
                        message: 'async failed',
                        validate: () =>
                            new Promise<boolean>((resolve) => {
                                call++;
                                if (call === 1) {
                                    firstResolve = resolve;
                                } else {
                                    secondResolve = resolve;
                                }
                            }),
                    },
                ],
            },
        };
        const model = createModel<S>(schema);

        const p1 = model.setField('f', 'old');
        const p2 = model.setField('f', 'new');

        await Promise.resolve();
        await Promise.resolve();
        expect(secondResolve).toBeTruthy();
        secondResolve!(true);
        expect(await p2).toBe(true);

        expect(firstResolve).toBeTruthy();
        firstResolve!(false);
        expect(await p1).toBe(false);

        expect(model.validationErrors.f || []).toEqual([]);
        expect(model.getField('f')).toBe('new');
        model.dispose();
    });
});
