import { createModel, Model, ModelReturn, ValidationError, ModelEvents } from '../index';
import { formatValidationErrors, ValidationRules } from '../validation';

describe('ModelManager - Error event routing', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('routes errors through typed model events', async () => {
        const validationCb = jest.fn();
        const fieldNotFoundCb = jest.fn();

        const model = createModel({
            name: {
                type: 'string',
                validator: [ValidationRules.required],
                default: '',
            },
        });
        model.on('validation:error', validationCb);
        model.on('field:not-found', fieldNotFoundCb);

        await model.setField('name', '');
        expect(validationCb).toHaveBeenCalledWith(
            expect.objectContaining({
                field: 'name',
                rule: 'required',
            })
        );

        // @ts-expect-error - testing non-existent field
        await expect(model.setField('missing', 'x')).rejects.toThrow('missing');
        expect(fieldNotFoundCb).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'field_not_found',
                field: 'missing',
            })
        );

        model.dispose();
    });

    test('field-not-found is emitted via the model event bus', async () => {
        const cb = jest.fn();
        const model = createModel({
            name: { type: 'string', validator: [], default: '' },
        });
        model.on('field:not-found', cb);
        // @ts-expect-error - runtime check for non-existent field
        await expect(model.setField('nonexistentField', 'value')).rejects.toThrow('nonexistentField');
        expect(cb).toHaveBeenCalled();
        expect(cb.mock.calls[0][0].code).toBe('field_not_found');
        expect(cb.mock.calls[0][0].field).toBe('nonexistentField');
        model.dispose();
    });

    test('disposing one model does not affect another model event bus', async () => {
        const schema = {
            value: {
                type: 'string' as const,
                default: '',
                validator: [
                    {
                        type: 'always',
                        message: 'always-fail',
                        validate: () => false,
                    },
                ],
            },
        };
        const modelA = createModel(schema);
        const modelB = createModel(schema);
        const callback = jest.fn();
        modelB.on('validation:error', callback);

        modelA.dispose();
        await modelB.setField('value', 'invalid');

        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({
                field: 'value',
                message: 'always-fail',
            })
        );
        modelB.dispose();
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

    test('the unsubscribe function removes a single callback', async () => {
        const cb = jest.fn();
        const model = createModel({
            field: { type: 'string', default: '' },
        });
        const unsubscribe = model.on('field:change', cb);
        unsubscribe();

        await model.setField('field', 'value');
        expect(cb).not.toHaveBeenCalled();
        model.dispose();
    });

    test('on() returns an unsubscribe function that removes the listener', async () => {
        const cb = jest.fn();
        const model = createModel({
            name: { type: 'string', default: '' },
        });
        const unsubscribe = model.on('field:change', cb);
        expect(typeof unsubscribe).toBe('function');

        await model.setField('name', 'Alice');
        expect(cb).toHaveBeenCalledTimes(1);

        unsubscribe();
        await model.setField('name', 'Bob');
        expect(cb).toHaveBeenCalledTimes(1); // no further calls
        model.dispose();
    });

    test('on() unsubscribe removes only its own listener', async () => {
        const cb1 = jest.fn();
        const cb2 = jest.fn();
        const model = createModel({
            name: { type: 'string', default: '' },
        });
        const unsub1 = model.on('field:change', cb1);
        model.on('field:change', cb2);

        unsub1();
        await model.setField('name', 'Carol');

        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test('on() unsubscribe is idempotent and safe to call twice', async () => {
        const cb = jest.fn();
        const model = createModel({
            name: { type: 'string', default: '' },
        });
        const unsubscribe = model.on('field:change', cb);
        unsubscribe();
        expect(() => unsubscribe()).not.toThrow();

        await model.setField('name', 'Dave');
        expect(cb).not.toHaveBeenCalled();
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

describe('formatValidationErrors', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('supports a custom formatter', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const model = createModel({
            field: {
                type: 'string',
                validator: [ValidationRules.required],
                default: '',
            },
        });
        await model.setField('field', '');
        expect(
            formatValidationErrors(
                model.validationErrors,
                (error) => `[${error.field}] ${error.message}`
            )
        ).toBe('[field] This field is required');
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

        const summary = formatValidationErrors(model.validationErrors);
        expect(summary).toContain('A required');
        expect(summary).toContain('B required');
        expect(summary).toContain('; ');
        model.dispose();
    });
});

describe('ModelManager - validation error ownership', () => {
    test('keeps unchanged field errors stable while replacing and clearing another field', async () => {
        const local = createModel({
            a: { type: 'string', validator: [ValidationRules.required] },
            b: { type: 'string', validator: [ValidationRules.required] },
        });

        try {
            await local.setFields({ a: '', b: '' });
            const original = local.validationErrors;
            const originalB = original.b;
            expect(Object.isFrozen(originalB)).toBe(true);
            expect(Object.isFrozen(originalB?.[0])).toBe(true);
            expect(() => { (originalB as ValidationError[]).push({ field: 'b', message: 'mutation' }); })
                .toThrow(TypeError);

            await local.setField('a', 'valid');
            const cleared = local.validationErrors;
            expect(cleared.a).toEqual([]);
            expect(cleared.b).toBe(originalB);
            expect(original.a).toHaveLength(1);

            await local.setField('a', '');
            const replaced = local.validationErrors;
            expect(replaced.a).toHaveLength(1);
            expect(replaced.b).toBe(originalB);
            expect(cleared.a).toEqual([]);
        } finally {
            local.dispose();
        }
    });

    test('consecutive synchronous writes discard superseded errors before notifying', async () => {
        const local = createModel({
            field: {
                type: 'string',
                validator: [{ type: 'allowed', message: 'invalid', validate: (value) => value === 'valid' }],
            },
        });
        const errors = jest.fn();
        const completion = jest.fn();
        local.on(ModelEvents.VALIDATION_ERROR, errors);
        local.on(ModelEvents.FIELD_VALIDATION_COMPLETE, completion);

        try {
            const superseded = local.setField('field', 'invalid');
            const current = local.setField('field', 'valid');
            expect(await superseded).toBe(false);
            expect(await current).toBe(true);
            expect(errors).not.toHaveBeenCalled();
            expect(completion).toHaveBeenCalledTimes(1);
            expect(completion).toHaveBeenCalledWith({ field: 'field', isValid: true, dirty: false });
            expect(local.data.field).toBe('valid');
            expect(local.validationErrors.field).toEqual([]);
            expect(local.getDirtyData()).toEqual({});
        } finally {
            local.dispose();
        }
    });

    test('stores the first error before notifying and isolates event payloads from snapshots', async () => {
        const local = createModel({
            field: {
                type: 'string',
                default: 'valid',
                validator: [
                    {
                        type: 'condition',
                        message: 'unused',
                        condition: () => { throw new Error('condition boom'); },
                        validate: () => true,
                    },
                    { type: 'first', message: 'first failure', validate: () => false },
                    { type: 'second', message: 'second failure', validate: async () => false },
                ],
            },
        });
        const initial = local.validationErrors;
        const snapshots: typeof local.validationErrors[] = [];
        local.on(ModelEvents.VALIDATION_ERROR, (error) => {
            snapshots.push(local.validationErrors);
            error.message = 'listener mutation';
        });

        try {
            expect(await local.setField('field', 'invalid')).toBe(false);
            expect(initial).toEqual({});
            expect(snapshots.map((snapshot) => snapshot.field?.length)).toEqual([1]);
            expect(snapshots[0]?.field?.[0]?.message).toBe(
                'Validation condition failed: condition boom'
            );
            expect(local.validationErrors.field?.map((error) => error.message)).toEqual([
                'Validation condition failed: condition boom',
            ]);
            expect(local.validationErrors).toBe(snapshots[0]);
        } finally {
            local.dispose();
        }
    });

    test('an error listener can replace the request without recording later stale errors', async () => {
        let replacement!: Promise<boolean>;
        const local = createModel({
            field: {
                type: 'string',
                default: 'initial',
                validator: [
                    { type: 'first', message: 'first failure', validate: (value) => value === 'new' },
                    { type: 'second', message: 'second failure', validate: async (value) => value === 'new' },
                ],
            },
        });
        const errors = jest.fn(() => { replacement = local.setField('field', 'new'); });
        local.on(ModelEvents.VALIDATION_ERROR, errors);

        try {
            expect(await local.setField('field', 'old')).toBe(false);
            expect(await replacement).toBe(true);
            expect(errors).toHaveBeenCalledTimes(1);
            expect(local.validationErrors.field).toEqual([]);
            expect(local.getDirtyData()).toEqual({});
            expect(local.data.field).toBe('new');
        } finally {
            local.dispose();
        }
    });

    test.each(['failure', 'rejection'] as const)(
        'ignores a late validation %s after disposal',
        async (outcome) => {
            let resolve!: (value: boolean) => void;
            let reject!: (error: Error) => void;
            const gate = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
            const local = createModel({
                field: {
                    type: 'string',
                    validator: [{ type: 'async', message: 'late', validate: () => gate }],
                },
            });
            const errors = jest.fn();
            local.on(ModelEvents.VALIDATION_ERROR, errors);
            const request = local.setField('field', 'pending');
            local.dispose();

            if (outcome === 'failure') resolve(false);
            else reject(new Error('late rejection'));
            expect(await request).toBe(false);
            expect(errors).not.toHaveBeenCalled();
            expect(local.validationErrors).toEqual({});
            expect(local.getDirtyData()).toEqual({});
        }
    );
});

// =============================================================================
// Type-level checks (compile-time only)
// =============================================================================
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

    test('single-field selector fires only for the matching field', async () => {
        const cb = jest.fn();
        model.subscribe((data) => data.qty, cb);

        await model.setField('coupon', 'X');
        expect(cb).not.toHaveBeenCalled();

        await model.setField('qty', 5);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(5, 1);
    });

    test('single-field selector returns an unsubscribe function', async () => {
        const cb = jest.fn();
        const unsub = model.subscribe((data) => data.qty, cb);
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

