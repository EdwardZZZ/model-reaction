import { validateField } from '../validate-field';
import { FieldSchema } from '../types';
import { Rule, ValidationRules } from '../rules';
import { createModel, Model } from '../index';

describe('validateField (unit)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('returns true when schema has no validators', async () => {
        const schema: FieldSchema = { type: 'string' };
        const errors: Record<string, any[]> = {};

        const result = await validateField({
            schema,
            value: 'value',
            errors,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(true);
    });

    test('skips validators that lack a validate method', async () => {
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'testField',
            timeout: 1000,
        });
        expect(result).toBe(true);
    });

    test('catches synchronous validator throwing an Error', async () => {
        const onError = jest.fn();
        const errors: Record<string, any[]> = {};

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
            errors,
            field: 'testField',
            timeout: 1000,
            onError,
        });

        expect(result).toBe(false);
        expect(errors.testField?.[0]?.rule).toBe('validation_error');
        expect(errors.testField?.[0]?.message).toContain('Validation failed: sync boom');
        expect(onError).toHaveBeenCalledWith(errors.testField?.[0]);
    });

    test('catches synchronous validator throwing a non-Error value', async () => {
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(errors.testField?.[0]?.message).toContain(
            'Validation failed: sync string'
        );
    });

    test('catches async validator rejection with non-Error value', async () => {
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(errors.testField?.[0]?.message).toContain(
            'Validation failed: async string'
        );
    });

    test('reuses existing error array for validation failures', async () => {
        const errors: Record<string, any[]> = {
            testField: [
                { field: 'testField', rule: 'existing', message: 'existing' },
            ],
        };

        const schema: FieldSchema = {
            type: 'string',
            validator: [
                { type: 'required', message: 'required', validate: () => false },
            ],
        };

        const result = await validateField({
            schema,
            value: '',
            errors,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(errors.testField?.length).toBe(2);
        expect(errors.testField?.[0]?.rule).toBe('existing');
    });

    test('initialises error array when validation fails', async () => {
        const errors: Record<string, any[]> = {};
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                { type: 'required', message: 'required', validate: () => false },
            ],
        };

        const result = await validateField({
            schema,
            value: '',
            errors,
            field: 'testField',
            timeout: 1000,
        });

        expect(result).toBe(false);
        expect(errors.testField?.length).toBe(1);
    });

    test('uses default timeout / failFast when not provided', async () => {
        const errors: Record<string, any[]> = {};
        const schema: FieldSchema = {
            type: 'string',
            validator: [{ type: 'ok', message: 'ok', validate: () => true }],
        };

        const result = await validateField({
            schema,
            value: 'value',
            errors,
            field: 'testField',
        });

        expect(result).toBe(true);
        expect(errors.testField).toBeUndefined();
    });

    test('async validator that exceeds timeout records timeout error', async () => {
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'f',
            timeout: 20,
        });

        expect(result).toBe(false);
        expect(errors.f?.[0]?.message).toContain('Validation timeout');
    });

    test('isCurrent guard suppresses stale sync failures', async () => {
        const errors: Record<string, any[]> = {};
        const schema: FieldSchema = {
            type: 'string',
            validator: [
                { type: 'fail', message: 'fail', validate: () => false },
            ],
        };

        const result = await validateField({
            schema,
            value: 'v',
            errors,
            field: 'f',
            isCurrent: () => false,
        });

        expect(result).toBe(false);
        // No error should have been pushed because the request is stale.
        expect(errors.f).toBeUndefined();
    });

    test('isCurrent guard suppresses stale async failures', async () => {
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'f',
            isCurrent: () => false,
        });

        expect(result).toBe(false);
        expect(errors.f).toBeUndefined();
    });

    test('isCurrent guard suppresses stale async *rejections*', async () => {
        // Distinct from the "returns false" case above: here the async
        // validator throws, exercising the catch branch's stale-request guard.
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'f',
            isCurrent: () => false,
        });

        expect(result).toBe(false);
        // Stale request → the rejection must be swallowed, no error recorded.
        expect(errors.f).toBeUndefined();
    });

    test('records async rejection error when the request is still current', async () => {
        // Complements the stale-guard test: with isCurrent true (the default),
        // a rejection is turned into a recorded validation error.
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'f',
            isCurrent: () => true,
        });

        expect(result).toBe(false);
        expect(errors.f?.[0]?.message).toContain('network down');
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
            errors: {},
            field: 'f',
            data: { other: 'value' },
        });

        expect(receivedData).toEqual({ other: 'value' });
    });

    test('skips validators whose condition returns false', async () => {
        const errors: Record<string, any[]> = {};
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
            errors,
            field: 'f',
        });
        expect(result).toBe(true);
        expect(errors.f).toBeUndefined();
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

        // current errors should still be clean for f
        expect(model.validationErrors.f || []).toEqual([]);
        expect(model.getField('f')).toBe('new');
        model.dispose();
    });
});
