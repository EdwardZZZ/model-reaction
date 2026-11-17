import { createModel, ModelEvents } from '../index';

describe('synchronous field writes', () => {
    test('writes and computes the whole chain before returning', () => {
        const model = createModel({
            a: { type: 'number', default: 1 },
            b: { type: 'number', reaction: { fields: ['a'], computed: ({ a }) => a * 2 } },
            c: { type: 'number', reaction: { fields: ['b'], computed: ({ b }) => b + 1 } },
        });
        expect(model.data).toEqual({ a: 1, b: 2, c: 3 });
        expect(model.setField('a', 4)).toBeUndefined();
        expect(model.data).toEqual({ a: 4, b: 8, c: 9 });
        model.dispose();
    });

    test('propagates equal initialized intermediates synchronously', () => {
        const model = createModel({
            a: { type: 'number', default: 1 },
            b: { type: 'number', default: 2, reaction: { fields: ['a'], computed: ({ a }) => a * 2 } },
            c: { type: 'number', default: 0, reaction: { fields: ['b'], computed: ({ b }) => b + 1 } },
        });
        expect(model.data).toEqual({ a: 1, b: 2, c: 3 });
        model.dispose();
    });

    test('recomputes consecutive edits that return to the input default', () => {
        const model = createModel({
            a: { type: 'number', default: 1 },
            b: { type: 'number', default: 2, reaction: { fields: ['a'], computed: ({ a }) => a * 2 } },
            c: { type: 'number', default: 0, reaction: { fields: ['b'], computed: ({ b }) => b + 1 } },
        });
        model.setField('a', 2);
        expect(model.data.c).toBe(5);
        model.setField('a', 1);
        expect(model.data.c).toBe(3);
        model.dispose();
    });

    test('transforms direct and computed writes once but seeds defaults directly', () => {
        const transform = jest.fn(Number);
        const model = createModel({
            a: { type: 'number', default: 2, transform },
            b: { type: 'number', transform, reaction: { fields: ['a'], computed: ({ a }) => a + 1 } },
        });
        expect(transform).toHaveBeenCalledTimes(1);
        model.setField('a', '4' as unknown as number);
        expect(transform).toHaveBeenCalledTimes(3);
        expect(model.data).toEqual({ a: 4, b: 5 });
        model.dispose();
    });

    test('preserves optional, nullish and non-finite values without business checks', () => {
        const model = createModel<{ name: string | null | undefined; count: number }>({
            name: { type: 'string' },
            count: { type: 'number', default: 0 },
        });
        expect(model.getField('name')).toBeUndefined();
        model.setField('name', null);
        model.setField('count', NaN);
        expect(model.data).toEqual({ name: null, count: NaN });
        model.setField('name', undefined);
        expect(Object.hasOwn(model.data, 'name')).toBe(true);
        model.dispose();
    });

    test('keeps stable frozen snapshots and structural equality', () => {
        const model = createModel({ value: { type: 'object', default: { a: 1 } } });
        const old = model.data;
        const listener = jest.fn();
        model.on(ModelEvents.FIELD_CHANGE, listener);
        model.setField('value', { a: 1 });
        expect(model.data).toBe(old);
        expect(listener).not.toHaveBeenCalled();
        model.setField('value', { a: 2 });
        expect(model.data).not.toBe(old);
        expect(Object.isFrozen(model.data)).toBe(true);
        expect(old.value).toEqual({ a: 1 });
        expect(listener).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test.each(['constructor', '__proto__', 'toString'])('supports own field %s and reactions', (field) => {
        const model = createModel({
            [field]: { type: 'string', default: 'old' },
            mirror: { type: 'string', reaction: { fields: [field], computed: (data) => data[field] } },
        });
        model.setField(field, 'new');
        expect(model.data[field]).toBe('new');
        expect(model.data.mirror).toBe('new');
        expect(Object.getPrototypeOf(model.data)).toBe(Object.prototype);
        model.dispose();
    });

    test.each(['constructor', '__proto__', 'toString'])('rejects inherited key %s synchronously', (field) => {
        const model = createModel({ name: { type: 'string', default: 'old' } });
        const listener = jest.fn();
        model.on(ModelEvents.FIELD_NOT_FOUND, listener);
        expect(() => model.setField(field as 'name', 'new')).toThrow('does not exist');
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ field, code: 'field_not_found' }));
        expect(model.data.name).toBe('old');
        model.dispose();
    });

    test('supports an empty model', async () => {
        const model = createModel({});
        expect(model.setFields({})).toBeUndefined();
        await model.settled();
        expect(model.data).toEqual({});
        model.dispose();
    });
});
