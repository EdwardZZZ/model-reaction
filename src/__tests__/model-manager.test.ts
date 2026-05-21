import { ModelManager } from '../model-manager';
import {
    createModel,
    Model,
    ModelReturn,
    ValidationRules,
    ErrorType,
    ErrorHandler,
} from '../index';

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
        expect(model.getValidationSummary()).toContain('age: Must be a number');
    });

    test('handles non-existent field modification', async () => {
        const errorCallback = jest.fn();
        model.on('field:not-found', errorCallback);

        // @ts-expect-error - runtime check for non-existent field
        const result = await model.setField('nonexistentField', 'value');

        expect(result).toBe(false);
        expect(errorCallback).toHaveBeenCalled();
        expect(errorCallback.mock.calls[0][0].type).toBe(
            ErrorType.FIELD_NOT_FOUND
        );
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

    test('strictMode causes setField on unknown field to throw', async () => {
        const strictModel = createModel<{ a: number }>(
            { a: { type: 'number', default: 0 } },
            { strictMode: true }
        );

        await expect(
            // @ts-expect-error intentional unknown field
            strictModel.setField('unknown', 1)
        ).rejects.toThrow(/does not exist in the model schema/);

        strictModel.dispose();
    });
});

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
        const summary = model.getValidationSummary();
        expect(summary).toContain('name: This field is required');
        expect(summary).toContain('age: Must be a number');
        expect(summary).toContain('email: Invalid email format');
    });
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
});

describe('ModelManager - Dirty Data Management', () => {
    interface User {
        name: string;
        age: number;
        email: string;
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
        email: {
            type: 'string',
            validator: [ValidationRules.required, ValidationRules.email],
            default: '',
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

    test('manages dirty data correctly through invalid → clear → valid → invalid → fix', async () => {
        expect(model.getDirtyData()).toEqual({});

        // @ts-expect-error - runtime type check
        await model.setField('age', 'invalid-age');
        expect(model.getDirtyData()).toHaveProperty('age');
        expect(model.getDirtyData().age).toBe('invalid-age');

        model.clearDirtyData();
        expect(model.getDirtyData()).toEqual({});

        await model.setField('name', 'Valid Name');
        expect(model.getDirtyData()).not.toHaveProperty('name');

        await model.setField('email', 'invalid-email');
        expect(model.getDirtyData()).toHaveProperty('email');

        await model.setField('email', 'valid@example.com');
        expect(model.getDirtyData()).not.toHaveProperty('email');
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
        expect(model.getValidationSummary()).toContain(
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
        expect(model.getValidationSummary()).toBe('Validation passed');

        await model.setField('age', 17.9);
        await model.validateAll();
        expect(model.getValidationSummary()).toContain(
            'age: Value must be greater than or equal to 18'
        );

        await model.setField('age', Number.MAX_SAFE_INTEGER);
        await model.validateAll();
        expect(model.getValidationSummary()).toBe('Validation passed');

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
        expect(model.getValidationSummary()).toBe('Validation passed');
        model.dispose();
    });
});

describe('ModelManager - Error routing & ErrorHandler integration', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('routes errors through a custom shared ErrorHandler', async () => {
        const errorHandler = new ErrorHandler();
        const validationCb = jest.fn();
        const fieldNotFoundCb = jest.fn();

        errorHandler.onError(ErrorType.VALIDATION, validationCb);
        errorHandler.onError(ErrorType.FIELD_NOT_FOUND, fieldNotFoundCb);

        const model = createModel(
            {
                name: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: '',
                },
            },
            { errorHandler }
        );

        await model.setField('name', '');
        expect(validationCb).toHaveBeenCalled();

        // @ts-expect-error - testing non-existent field
        await model.setField('missing', 'x');
        expect(fieldNotFoundCb).toHaveBeenCalled();

        model.dispose();
    });

    test('field-not-found is emitted via the model event bus', async () => {
        const cb = jest.fn();
        const model = createModel({
            name: { type: 'string', validator: [], default: '' },
        });
        model.on('field:not-found', cb);
        // @ts-expect-error - runtime check for non-existent field
        await model.setField('nonexistentField', 'value');
        expect(cb).toHaveBeenCalled();
        expect(cb.mock.calls[0][0].type).toBe(ErrorType.FIELD_NOT_FOUND);
        expect(cb.mock.calls[0][0].field).toBe('nonexistentField');
        model.dispose();
    });

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
                            validate: () => false,
                        },
                    ],
                },
            },
            { errorHandler: sharedHandler }
        );

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
                            validate: () => false,
                        },
                    ],
                },
            },
            { errorHandler: sharedHandler }
        );

        await modelB.setField('y', 'something');
        expect(externalCalls).toContain('always-fail-B');

        modelB.dispose();

        sharedHandler.triggerError(
            sharedHandler.createValidationError('manual', 'manual-error')
        );
        expect(externalCalls).toContain('manual-error');
    });
});

describe('ModelManager - Event facade', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('emits field:change on valid field update', async () => {
        const cb = jest.fn();
        const model = createModel({
            name: { type: 'string', default: '' },
        });
        model.on('field:change', cb);
        await model.setField('name', 'Alice');
        expect(cb).toHaveBeenCalledWith({ field: 'name', value: 'Alice' });
        model.dispose();
    });

    test('off() unsubscribes a single callback', async () => {
        const cb = jest.fn();
        const model = createModel({
            field: { type: 'string', default: '' },
        });
        model.on('field:change', cb);
        model.off('field:change', cb);

        await model.setField('field', 'value');
        expect(cb).not.toHaveBeenCalled();
        model.dispose();
    });

    test('off() without callback removes all listeners for that event', async () => {
        const cb1 = jest.fn();
        const cb2 = jest.fn();
        const model = createModel({
            name: { type: 'string', default: '' },
        });
        model.on('field:change', cb1);
        model.on('field:change', cb2);
        model.off('field:change');

        await model.setField('name', 'test');
        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).not.toHaveBeenCalled();
        model.dispose();
    });

    test('listener throwing does not prevent subsequent listeners', async () => {
        const model = createModel<{ a: number }>({
            a: { type: 'number', default: 0 },
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
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
        model.dispose();
    });
});

describe('ModelManager - Validation summary & errorFormatter', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('uses custom errorFormatter for getValidationSummary', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const model = createModel(
            {
                field: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: '',
                },
            },
            { errorFormatter: (err) => `[${err.field}] ${err.message}` }
        );
        await model.setField('field', '');
        expect(model.getValidationSummary()).toBe(
            '[field] This field is required'
        );
        model.dispose();
    });

    test('joins errors across multiple fields with semicolons', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const model = createModel({
            a: {
                type: 'string',
                validator: [
                    ValidationRules.required.withMessage('A required'),
                ],
                default: '',
            },
            b: {
                type: 'string',
                validator: [
                    ValidationRules.required.withMessage('B required'),
                ],
                default: '',
            },
        });

        await model.setField('a', '');
        await model.setField('b', '');

        const summary = model.getValidationSummary();
        expect(summary).toContain('A required');
        expect(summary).toContain('B required');
        expect(summary).toContain('; ');
        model.dispose();
    });
});

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
        expect(model.getValidationSummary()).toBe('Validation passed');
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
        expect(model.validationErrors.field.length).toBeGreaterThan(0);

        model.clearDirtyData();
        expect(model.getDirtyData()).toEqual({});
        expect(model.getField('field')).toBe('valid');
        expect(model.validationErrors.field.length).toBeGreaterThan(0);
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
});

describe('ModelManager - Direct (internal collaborators)', () => {
    test('reaction-system emit forwards through model manager event bus', () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: { type: 'string', default: 'val' },
        };
        const manager = new ModelManager<Schema>(schema);
        const cb = jest.fn();
        manager.on('custom:event', cb);

        const internal = manager as any;
        internal.reactionSystem.callbacks.emit('custom:event', { value: 1 });

        expect(cb).toHaveBeenCalledWith({ value: 1 });
        manager.dispose();
    });

    test('reaction setError reuses existing validation error array', () => {
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
        internal.reactionSystem.callbacks.setError('field', {
            field: 'field',
            rule: 'reaction_error',
            message: 'second',
        });

        expect(manager.validationErrors.field?.length).toBe(2);
        manager.dispose();
    });
});

// =============================================================================
// Type-level checks (compile-time only)
// =============================================================================
describe('ModelManager - Type checks', () => {
    test('valid Model schema compiles without error', () => {
        interface User {
            id: number;
            name: string;
            email?: string;
        }
        const validSchema: Model<User> = {
            id: { type: 'number' },
            name: {
                type: 'string',
                validator: [ValidationRules.required],
            },
            email: { type: 'string' },
        };
        const manager = new ModelManager<User>(validSchema);
        expect(manager).toBeInstanceOf(ModelManager);
        manager.dispose();
    });
});

describe('ModelManager - selector subscriptions', () => {
    interface Cart {
        qty: number;
        price: number;
        coupon: string;
    }
    const cartSchema: Model<Cart> = {
        qty: { type: 'number', default: 1 },
        price: { type: 'number', default: 100 },
        coupon: { type: 'string', default: '' },
    };

    let model: ModelReturn<Cart>;
    beforeEach(() => {
        model = createModel<Cart>(cartSchema);
    });
    afterEach(() => model.dispose());

    test('subscribeField fires only for the matching field', async () => {
        const cb = jest.fn();
        model.subscribeField('qty', cb);

        await model.setField('coupon', 'X');
        expect(cb).not.toHaveBeenCalled();

        await model.setField('qty', 5);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(5);
    });

    test('subscribeField returns an unsubscribe function', async () => {
        const cb = jest.fn();
        const unsub = model.subscribeField('qty', cb);
        unsub();
        await model.setField('qty', 5);
        expect(cb).not.toHaveBeenCalled();
    });

    test('subscribe with selector fires only when derived value changes', async () => {
        const cb = jest.fn();
        model.subscribe((d) => d.qty * d.price, cb);

        // Mutating coupon does not change total → no callback
        await model.setField('coupon', 'SAVE10');
        expect(cb).not.toHaveBeenCalled();

        // qty changes → total changes
        await model.setField('qty', 2);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(200, 100);

        // Setting price to its current value should not fire (Object.is)
        await model.setField('price', 100);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('subscribe accepts custom isEqual for structural comparison', async () => {
        interface ListModel {
            items: string[];
            filter: string;
        }
        const m = createModel<ListModel>({
            items: { type: 'array', default: ['a', 'ab', 'b'] },
            filter: { type: 'string', default: '' },
        });

        const cb = jest.fn();
        m.subscribe(
            (d) => d.items.filter((x) => x.includes(d.filter)),
            cb,
            (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
        );

        // Same filtered result → no callback
        await m.setField('items', ['a', 'ab', 'b']);
        expect(cb).not.toHaveBeenCalled();

        await m.setField('filter', 'a');
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual(['a', 'ab']);

        m.dispose();
    });

    test('subscribe unsubscribe stops further notifications', async () => {
        const cb = jest.fn();
        const unsub = model.subscribe((d) => d.qty, cb);
        await model.setField('qty', 2);
        expect(cb).toHaveBeenCalledTimes(1);
        unsub();
        await model.setField('qty', 3);
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

describe('createModel - schema type inference', () => {
    test('infers data shape from schema literal without explicit type arg', async () => {
        const m = createModel({
            name: { type: 'string' as const, default: 'a' },
            age: { type: 'number' as const, default: 0 },
            active: { type: 'boolean' as const, default: false },
        });

        // Type is inferred from schema; runtime values verify the data shape.
        expect(m.data.name).toBe('a');
        expect(m.data.age).toBe(0);
        expect(m.data.active).toBe(false);

        await m.setField('age', 42);
        expect(m.getField('age')).toBe(42);
        m.dispose();
    });
});
