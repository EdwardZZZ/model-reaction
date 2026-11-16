import { createModel, Model, ModelReturn } from '../index';
import { formatValidationErrors, ValidationRules } from '../validation';

describe('ModelManager - Batch Operations (setFields)', () => {
    interface User {
        name: string;
        age: number;
        email: string;
    }

    const testSchema: Model<User> = {
        name: {
            type: 'string',
            validator: [ValidationRules.required],
            default: '',
        },
        age: {
            type: 'number',
            validator: [
                ValidationRules.required,
                ValidationRules.number,
                ValidationRules.min(18),
            ],
            default: 18,
        },
        email: {
            type: 'string',
            validator: [ValidationRules.required, ValidationRules.email],
            default: '',
        },
    };

    let model: ModelReturn<User>;

    beforeEach(() => {
        model = createModel<User>(testSchema, { asyncValidationTimeout: 5000 });
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        model.dispose();
    });

    test('handles successful batch updates', async () => {
        const result = await model.setFields({
            name: 'Batch User',
            age: 25,
            email: 'batch@example.com',
        });
        expect(result).toBe(true);
        expect(model.getField('name')).toBe('Batch User');
        expect(model.getField('age')).toBe(25);
        expect(model.getField('email')).toBe('batch@example.com');
        expect(model.getDirtyData()).toEqual({});
    });

    test('rejects invalid batch updates and surfaces all errors', async () => {
        const result = await model.setFields({
            name: '',
            // @ts-expect-error - runtime type check
            age: 'invalid',
            email: 'not-an-email',
        });
        expect(result).toBe(false);
        const summary = formatValidationErrors(model.validationErrors);
        expect(summary).toContain('name: This field is required');
        expect(summary).toContain('age: Must be a number');
        expect(summary).toContain('email: Invalid email format');
    });

    test('validates fields against the merged batch data', async () => {
        interface Credentials {
            password: string;
            confirmPassword: string;
        }
        const credentials = createModel<Credentials>({
            password: { type: 'string', default: 'old-password' },
            confirmPassword: {
                type: 'string',
                default: 'old-password',
                validator: [
                    {
                        type: 'matchesPassword',
                        message: 'Passwords must match',
                        validate: (value, data) => value === data?.password,
                    },
                ],
            },
        });

        const result = await credentials.setFields({
            password: 'new-password',
            confirmPassword: 'new-password',
        });

        expect(result).toBe(true);
        expect(credentials.data).toEqual({
            password: 'new-password',
            confirmPassword: 'new-password',
        });
        expect(credentials.validationErrors.confirmPassword).toEqual([]);
        credentials.dispose();
    });

    test.each(['setFields', 'validateAll'] as const)(
        '%s shares a read-only candidate snapshot across conditions and validators',
        async (operation) => {
            const contexts: Record<string, any>[] = [];
            const validator = {
                type: 'matchesCandidate',
                message: 'must match the candidate',
                condition: (data: Record<string, any>) => {
                    contexts.push(data);
                    return true;
                },
                validate: (value: number, data?: Record<string, any>) => {
                    contexts.push(data!);
                    return value === data?.source;
                },
            };
            const local = createModel({
                source: { type: 'number', default: 2, validator: [validator] },
                matching: { type: 'number', default: 2, validator: [validator] },
            });
            try {
                const valid = operation === 'setFields'
                    ? await local.setFields({ source: 3, matching: 3 })
                    : await local.validateAll();
                const expected = operation === 'setFields' ? 3 : 2;
                expect(valid).toBe(true);
                expect(contexts).toHaveLength(4);
                for (const context of contexts) {
                    expect(context).toBe(contexts[0]);
                    expect(context).toEqual({ source: expected, matching: expected });
                    expect(Object.isFrozen(context)).toBe(true);
                    expect(Reflect.set(context, 'source', -1)).toBe(false);
                }
                expect(local.data).toEqual({ source: expected, matching: expected });
            } finally {
                local.dispose();
            }
        }
    );

    test('rejects unknown batch keys before transform or validation starts', async () => {
        const transform = jest.fn((value) => value);
        const validate = jest.fn(async () => true);
        const read = jest.fn(() => 2);
        interface Schema {
            source: number;
            derived: number;
        }
        const strictModel = createModel<Schema>(
            {
                source: {
                    type: 'number',
                    default: 1,
                    transform,
                    validator: [
                        {
                            type: 'delayed',
                            message: 'Source is invalid',
                            validate,
                        },
                    ],
                },
                derived: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => source * 2,
                    },
                },
            }
        );
        await strictModel.settled();

        await expect(
            strictModel.setFields({
                get source() { return read(); },
                // @ts-expect-error intentional unknown field
                ghost: 1,
            })
        ).rejects.toThrow(/does not exist in the model schema/);
        await strictModel.settled();

        expect(strictModel.getField('source')).toBe(1);
        expect(strictModel.getField('derived')).toBe(2);
        expect(transform).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        strictModel.dispose();
    });

    test('transforms batch input once and revalidates the prepared values', async () => {
        const transform = jest.fn((value: number) => value + 1);
        const validate = jest.fn((value: number, data?: Record<string, any>) =>
            value === data?.source
        );
        const local = createModel({
            source: { type: 'number', default: 0, transform },
            matching: {
                type: 'number',
                default: 0,
                validator: [{
                    type: 'matches',
                    message: 'must match transformed source',
                    validate,
                }],
            },
        });

        try {
            expect(await local.setFields({ source: 1, matching: 2 })).toBe(true);
            expect(await local.validateAll()).toBe(true);
            expect(transform).toHaveBeenCalledTimes(1);
            expect(validate).toHaveBeenCalledTimes(2);
            expect(validate.mock.calls.map(([, data]) => data)).toEqual([
                { source: 2, matching: 2 },
                { source: 2, matching: 2 },
            ]);
            expect(local.data).toEqual({ source: 2, matching: 2 });
        } finally {
            local.dispose();
        }
    });

    test.each(['setField', 'setFields'] as const)(
        '%s supplies its transformed candidate to both condition and validate',
        async (operation) => {
            const contexts: Readonly<Record<string, any>>[] = [];
            const transform = jest.fn((value: number) => value + 1);
            const local = createModel({
                amount: {
                    type: 'number',
                    default: 0,
                    transform,
                    validator: [{
                        type: 'candidate',
                        message: 'candidate mismatch',
                        condition: (data) => { contexts.push(data); return true; },
                        validate: (value, data) => { contexts.push(data!); return value === data?.amount; },
                    }],
                },
            });
            try {
                const result = operation === 'setField'
                    ? await local.setField('amount', 4)
                    : await local.setFields({ amount: 4 });
                expect(result).toBe(true);
                expect(transform).toHaveBeenCalledTimes(1);
                expect(contexts).toEqual([{ amount: 5 }, { amount: 5 }]);
                expect(contexts[0]).toBe(contexts[1]);
                expect(Object.isFrozen(contexts[0])).toBe(true);
                expect(local.data.amount).toBe(5);
            } finally {
                local.dispose();
            }
        }
    );

    test('validateAll reuses transformed dirty values without transforming again', async () => {
        let allowed = false;
        const transform = jest.fn((value: number) => value + 1);
        const local = createModel({
            amount: {
                type: 'number',
                default: 0,
                transform,
                validator: [{ type: 'allowed', message: 'not yet', validate: () => allowed }],
            },
        });
        try {
            expect(await local.setField('amount', 4)).toBe(false);
            expect(local.getDirtyData()).toEqual({ amount: 5 });
            allowed = true;
            expect(await local.validateAll()).toBe(true);
            expect(transform).toHaveBeenCalledTimes(1);
            expect(local.data.amount).toBe(5);
            expect(local.getDirtyData()).toEqual({});
        } finally {
            local.dispose();
        }
    });

    test('a rejected validator setup drains sibling work before releasing the batch', async () => {
        let release!: (valid: boolean) => void;
        const gate = new Promise<boolean>((resolve) => { release = resolve; });
        const failure = new Error('unavailable rules');
        const action = jest.fn();
        const local = createModel({
            broken: {
                type: 'number',
                get validator(): never { throw failure; },
            },
            source: {
                type: 'number',
                validator: [{ type: 'gate', message: '', validate: () => gate }],
            },
            derived: {
                type: 'number',
                reaction: { fields: ['source'], computed: ({ source }) => source * 2, action: [action] },
            },
        });
        let finished = false;
        const batch = local.setFields({ broken: 1, source: 2 }).catch((error: unknown) => {
            finished = true;
            return error;
        });
        let idle = false;
        const settled = local.settled().then(() => { idle = true; });
        try {
            await Promise.resolve();
            await Promise.resolve();
            expect(finished).toBe(false);
            expect(idle).toBe(false);
            release(true);
            expect(await batch).toBe(failure);
            await settled;
            expect(local.data.source).toBe(2);
            expect(local.data.derived).toBe(4);
            expect(action).toHaveBeenCalledTimes(1);
        } finally {
            release(true);
            await batch;
            local.dispose();
        }
    });

    test('releases the batch task when a transform throws before validation', async () => {
        const failure = new Error('cannot transform');
        const local = createModel({
            source: {
                type: 'number',
                default: 0,
                transform: () => { throw failure; },
            },
        });

        try {
            await expect(local.setFields({ source: 1 })).rejects.toBe(failure);
            await local.settled();
            expect(local.data.source).toBe(0);
        } finally {
            local.dispose();
        }
    });

    test.each(['setFields', 'validateAll'] as const)(
        '%s returns after registering reactions while actions remain pending',
        async (operation) => {
            let valid = true;
            let release!: () => void;
            const actionGate = new Promise<void>((resolve) => { release = resolve; });
            const action = jest.fn(() => actionGate);
            const local = createModel({
                source: {
                    type: 'number',
                    validator: [{
                        type: 'allowed',
                        message: 'not yet',
                        validate: () => valid,
                    }],
                },
                derived: {
                    type: 'number',
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => source * 2,
                        action: [action],
                    },
                },
            });

            try {
                if (operation === 'validateAll') {
                    valid = false;
                    expect(await local.setField('source', 2)).toBe(false);
                    valid = true;
                }
                const result = operation === 'setFields'
                    ? local.setFields({ source: 2 })
                    : local.validateAll();
                expect(await result).toBe(true);
                let idle = false;
                const settled = local.settled().then(() => { idle = true; });
                await Promise.resolve();
                expect(idle).toBe(false);
                release();
                await settled;
                expect(action).toHaveBeenCalledTimes(1);
                expect(local.data.derived).toBe(4);
            } finally {
                release();
                await local.settled();
                local.dispose();
            }
        }
    );
});


describe('ModelManager - validateAll', () => {
    interface User {
        name: string;
        age: number;
    }
    const schema: Model<User> = {
        name: {
            type: 'string',
            validator: [ValidationRules.required],
            default: '',
        },
        age: {
            type: 'number',
            validator: [
                ValidationRules.required,
                ValidationRules.number,
                ValidationRules.min(18),
            ],
            default: 18,
        },
    };

    let model: ModelReturn<User>;

    beforeEach(() => {
        model = createModel<User>(schema);
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        model.dispose();
    });

    test('validates all fields and reports failures', async () => {
        await model.setField('name', '');
        await model.setField('age', 15);

        const isValid = await model.validateAll();
        expect(isValid).toBe(false);
        expect(model.validationErrors).toHaveProperty('name');
        expect(model.validationErrors).toHaveProperty('age');
    });

    test('emits validation:complete with isValid flag', async () => {
        const completeCb = jest.fn();
        model.on('validation:complete', completeCb);
        const ok = await model.validateAll();
        expect(ok).toBe(false);
        expect(completeCb).toHaveBeenCalledWith({ isValid: false });
    });

    test('updates data when validateAll passes on dirty data', async () => {
        let shouldPass = false;
        interface S {
            field: string;
        }
        const local = createModel<S>({
            field: {
                type: 'string',
                validator: [
                    {
                        type: 'custom',
                        message: 'error',
                        validate: () => shouldPass,
                    },
                ],
                default: 'valid',
            },
        });

        await local.setField('field', 'invalid');
        expect(local.getDirtyData()['field']).toBe('invalid');
        expect(local.getField('field')).toBe('valid');

        shouldPass = true;
        await local.validateAll();

        expect(local.getField('field')).toBe('invalid');
        expect(local.getDirtyData()).toEqual({});
        local.dispose();
    });

    test('validates mutually dependent dirty fields against one candidate snapshot', async () => {
        interface Pair {
            a: string;
            b: string;
        }
        const local = createModel<Pair>({
            a: {
                type: 'string',
                default: 'old',
                validator: [
                    {
                        type: 'matches-b',
                        message: 'a must match b',
                        validate: (value, data) => value === data?.b,
                    },
                ],
            },
            b: {
                type: 'string',
                default: 'old',
                validator: [
                    {
                        type: 'matches-a',
                        message: 'b must match a',
                        validate: (value, data) => value === data?.a,
                    },
                ],
            },
        });

        expect(await local.setField('a', 'new')).toBe(false);
        expect(await local.setField('b', 'new')).toBe(false);
        expect(local.getDirtyData()).toEqual({ a: 'new', b: 'new' });

        expect(await local.validateAll()).toBe(true);
        expect(local.data).toEqual({ a: 'new', b: 'new' });
        expect(local.getDirtyData()).toEqual({});
        local.dispose();
    });
});

