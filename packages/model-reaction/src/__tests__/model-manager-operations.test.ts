import { createModel, Model, ModelReturn, ModelEvents } from '../index';
import { formatValidationErrors, ValidationRules } from '../validation';

describe('ModelManager - Basic Operations', () => {
    interface User {
        name: string;
        age: number;
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

    test('initializes with default values', () => {
        expect(model.getField('name')).toBe('');
        expect(model.getField('age')).toBe(18);
    });

    test.each([0, 5])(
        'initializes downstream fields when an intermediate default is unchanged (debounce: %s)',
        async (debounceReactions) => {
            const local = createModel({
                source: { type: 'number', default: 1 },
                intermediate: {
                    type: 'number',
                    default: 2,
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => source * 2,
                    },
                },
                downstream: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['intermediate'],
                        computed: ({ intermediate }) => intermediate + 1,
                    },
                },
            }, { debounceReactions });
            const changes = jest.fn();
            local.on('field:change', changes);
            try {
                await local.settled();
                expect(local.data).toEqual({
                    source: 1,
                    intermediate: 2,
                    downstream: 3,
                });
                expect(changes).toHaveBeenCalledTimes(1);
                expect(changes).toHaveBeenCalledWith({
                    field: 'downstream',
                    value: 3,
                });
                changes.mockClear();
                await local.setField('source', 1);
                await local.settled();
                expect(changes).not.toHaveBeenCalled();
            } finally {
                local.dispose();
            }
        }
    );

    test('preserves initialization when a debounced input edit returns to its default', async () => {
        const local = createModel({
            source: { type: 'number', default: 1 },
            intermediate: {
                type: 'number',
                default: 2,
                reaction: { fields: ['source'], computed: ({ source }) => source * 2 },
            },
            downstream: {
                type: 'number',
                default: 0,
                reaction: { fields: ['intermediate'], computed: ({ intermediate }) => intermediate + 1 },
            },
        }, { debounceReactions: 5 });
        try {
            await local.setField('source', 2);
            await local.setField('source', 1);
            await local.settled();
            expect(local.data).toEqual({ source: 1, intermediate: 2, downstream: 3 });
        } finally {
            local.dispose();
        }
    });

    test('sets valid field values asynchronously', async () => {
        const result = await model.setField('name', 'Test User');
        expect(result).toBe(true);
        expect(model.getField('name')).toBe('Test User');
    });

    test('rejects invalid field values and keeps the previous value', async () => {
        const original = model.getField('age');
        // @ts-expect-error - runtime type check
        const result = await model.setField('age', 'not-a-number');
        expect(result).toBe(false);
        expect(model.getField('age')).toBe(original);
        expect(formatValidationErrors(model.validationErrors)).toContain('age: Must be a number');
    });

    test('handles non-existent field modification', async () => {
        const errorCallback = jest.fn();
        model.on('field:not-found', errorCallback);

        // @ts-expect-error - runtime check for non-existent field
        await expect(model.setField('nonexistentField', 'value')).rejects.toThrow('nonexistentField');
        expect(errorCallback).toHaveBeenCalled();
        expect(errorCallback.mock.calls[0][0].code).toBe('field_not_found');
        expect(errorCallback.mock.calls[0][0].field).toBe('nonexistentField');
        // @ts-expect-error - runtime check for non-existent field
        expect(model.getField('nonexistentField')).toBeUndefined();
    });

    test('exposes data snapshot via the data getter', async () => {
        await model.setField('name', 'Alice');
        const snapshot = model.data;
        expect(snapshot.name).toBe('Alice');
        expect(snapshot.age).toBe(18);
    });

    test('unknown fields reject without an option', async () => {
        const strictModel = createModel<{ a: number }>(
            { a: { type: 'number', default: 0 } }
        );

        await expect(
            // @ts-expect-error intentional unknown field
            strictModel.setField('unknown', 1)
        ).rejects.toThrow(/does not exist in the model schema/);

        strictModel.dispose();
    });
});


describe('ModelManager - Transform', () => {
    test('transform is applied before validation', async () => {
        const model = createModel({
            field: {
                type: 'string',
                transform: (v: string) => v.trim(),
                validator: [ValidationRules.required],
                default: '',
            },
        });

        const resultSpaces = await model.setField('field', '   ');
        expect(resultSpaces).toBe(false);

        const resultPadded = await model.setField('field', '  hello  ');
        expect(resultPadded).toBe(true);
        expect(model.getField('field')).toBe('hello');

        model.dispose();
    });

    test('transform value before setting (no validators)', async () => {
        const model = createModel({
            field: {
                type: 'string',
                transform: (val: string) => val.trim(),
            },
        });

        await model.setField('field', '  value  ');
        expect(model.getField('field')).toBe('value');
        model.dispose();
    });
});


describe('ModelManager - Boundary values', () => {
    test('handles null and undefined values for optional fields', async () => {
        interface NullableSchema {
            nullableField: string | null;
            requiredField: string | null;
        }
        const nullableSchema: Model<NullableSchema> = {
            nullableField: {
                type: 'string',
                validator: [],
                default: null,
            },
            requiredField: {
                type: 'string',
                validator: [ValidationRules.required],
                default: '',
            },
        };
        const model = createModel<NullableSchema>(nullableSchema);
        jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(model.getField('nullableField')).toBeNull();

        await model.setField('requiredField', null);
        await model.validateAll();
        expect(formatValidationErrors(model.validationErrors)).toContain(
            'requiredField: This field is required'
        );

        jest.restoreAllMocks();
        model.dispose();
    });

    test('handles boundary values for number validation', async () => {
        interface BoundarySchema {
            age: number;
        }
        const boundarySchema: Model<BoundarySchema> = {
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
        const model = createModel<BoundarySchema>(boundarySchema);
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await model.setField('age', 18);
        await model.validateAll();
        expect(formatValidationErrors(model.validationErrors)).toBe('Validation passed');

        await model.setField('age', 17.9);
        await model.validateAll();
        expect(formatValidationErrors(model.validationErrors)).toContain(
            'age: Value must be greater than or equal to 18'
        );

        await model.setField('age', Number.MAX_SAFE_INTEGER);
        await model.validateAll();
        expect(formatValidationErrors(model.validationErrors)).toBe('Validation passed');

        jest.restoreAllMocks();
        model.dispose();
    });

    test('field without default has undefined initial value', () => {
        const model = createModel({
            field: { type: 'number', validator: [ValidationRules.number] },
        });

        expect(model.getField('field')).toBeUndefined();
        model.dispose();
    });

    test('field without validator always passes', async () => {
        const model = createModel({
            open: { type: 'string', default: '' },
        });
        expect(await model.setField('open', 'anything')).toBe(true);
        expect(await model.setField('open', '')).toBe(true);
        expect(model.validationErrors.open || []).toHaveLength(0);
        model.dispose();
    });

    test('empty schema validateAll returns true', async () => {
        const model = createModel({});
        const ok = await model.validateAll();
        expect(ok).toBe(true);
        expect(formatValidationErrors(model.validationErrors)).toBe('Validation passed');
        model.dispose();
    });
});


describe('ModelManager - own field keys', () => {
    test.each(['toString', 'constructor', '__proto__'])(
        'preserves %s through validation, dirty storage, clearing and reactions',
        async (field) => {
            const schema: Model = {
                [field]: {
                    type: 'number',
                    default: 1,
                    transform: Number,
                    validator: [{
                        type: 'positive',
                        message: 'positive',
                        validate: (value, data) => value > 0 && data?.[field] === value,
                    }],
                },
                derived: {
                    type: 'number',
                    reaction: { fields: [field], computed: (data) => data[field] * 2 },
                },
            };
            const local = createModel(schema);
            const completion = jest.fn();
            local.on(ModelEvents.FIELD_VALIDATION_COMPLETE, completion);
            try {
                await local.settled();
                expect(await local.validateAll()).toBe(true);
                expect(local.getField(field)).toBe(1);
                expect(local.getDirtyData()).toEqual({});
                expect(await local.setField(field, '-1')).toBe(false);
                expect(local.getDirtyData()).toEqual({ [field]: -1 });
                expect(local.validationErrors[field]?.[0]?.rule).toBe('positive');
                expect(completion).toHaveBeenLastCalledWith({ field, isValid: false, dirty: true });
                expect(await local.validateAll()).toBe(false);
                local.clearDirtyData();
                expect(local.getDirtyData()).toEqual({});
                expect(await local.setFields({ [field]: 2 })).toBe(true);
                await local.settled();
                expect(local.data).toEqual({ [field]: 2, derived: 4 });
                expect(Object.getPrototypeOf(local.data)).toBe(Object.prototype);
                expect(Object.isFrozen(local.data)).toBe(true);
                expect(local.validationErrors[field]).toEqual([]);
            } finally {
                local.dispose();
            }
        }
    );

    test.each(['toString', 'constructor', '__proto__'])(
        'rejects inherited schema key %s before touching a valid sibling',
        async (field) => {
            const schema: Model = Object.create({ [field]: { type: 'number', default: 1 } });
            schema.source = { type: 'number', default: 0 };
            const local = createModel(schema);
            const errors = jest.fn();
            local.on(ModelEvents.FIELD_NOT_FOUND, errors);
            try {
                expect(local.getField(field)).toBeUndefined();
                await expect(local.setFields({ source: 2, [field]: 3, missing: 4 })).rejects.toThrow(field);
                expect(local.data).toEqual({ source: 0 });
                expect(errors).toHaveBeenCalledTimes(1);
                expect(errors).toHaveBeenCalledWith(expect.objectContaining({ field }));
                await local.settled();
            } finally {
                local.dispose();
            }
        }
    );
});
