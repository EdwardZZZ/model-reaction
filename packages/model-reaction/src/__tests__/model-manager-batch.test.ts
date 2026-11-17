import { createModel, ModelEvents } from '../index';

describe('synchronous batch writes', () => {
    test('commits all inputs before one dependent computation', () => {
        const computed = jest.fn(({ a, b }) => a + b);
        const model = createModel({
            a: { type: 'number', default: 1 },
            b: { type: 'number', default: 2 },
            sum: { type: 'number', reaction: { fields: ['a', 'b'], computed } },
        });
        computed.mockClear();
        expect(model.setFields({ a: 4, b: 5 })).toBeUndefined();
        expect(model.data.sum).toBe(9);
        expect(computed).toHaveBeenCalledTimes(1);
        expect(computed).toHaveBeenCalledWith({ a: 4, b: 5 });
        model.dispose();
    });

    test('only changed dependencies trigger computation', () => {
        const computed = jest.fn(({ a }) => a * 2);
        const model = createModel({
            a: { type: 'number', default: 1 },
            b: { type: 'number', default: 2 },
            target: { type: 'number', reaction: { fields: ['a'], computed } },
        });
        computed.mockClear();
        model.setFields({ a: 1, b: 3 });
        expect(computed).not.toHaveBeenCalled();
        model.dispose();
    });

    test('checks every key before reading values or running transforms', async () => {
        const transform = jest.fn(Number);
        const read = jest.fn(() => 2);
        const model = createModel({ a: { type: 'number', default: 1, transform } });
        const fields = Object.defineProperty({ missing: 2 }, 'a', { get: read, enumerable: true });
        expect(() => model.setFields(fields as any)).toThrow('does not exist');
        expect(transform).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(model.data.a).toBe(1);
        await model.settled();
        model.dispose();
    });

    test('prepares every transform before committing and releases tasks on failure', async () => {
        const model = createModel({
            a: { type: 'number', default: 1, transform: Number },
            b: { type: 'number', default: 2, transform: () => { throw new Error('transform failed'); } },
        });
        const onChange = jest.fn();
        model.on(ModelEvents.FIELD_CHANGE, onChange);
        expect(() => model.setFields({ a: 3, b: 4 })).toThrow('transform failed');
        expect(model.data).toEqual({ a: 1, b: 2 });
        expect(onChange).not.toHaveBeenCalled();
        await model.settled();
        model.dispose();
    });

    test('permits reentrant field-change writes and converges before returning', () => {
        const model = createModel({
            a: { type: 'number', default: 0 },
            b: { type: 'number', default: 0 },
            sum: { type: 'number', reaction: { fields: ['a', 'b'], computed: ({ a, b }) => a + b } },
        });
        model.on(ModelEvents.FIELD_CHANGE, ({ field }) => {
            if (field === 'a') model.setField('b', 10);
        });
        model.setFields({ a: 1, b: 2 });
        expect(model.data).toEqual({ a: 1, b: 2, sum: 3 });
        model.dispose();
    });

    test('does not continue committing after disposal from a change listener', async () => {
        const model = createModel({
            a: { type: 'number', default: 0 },
            b: { type: 'number', default: 0 },
        });
        model.on(ModelEvents.FIELD_CHANGE, () => model.dispose());
        model.setFields({ a: 1, b: 2 });
        expect(model.data).toEqual({});
        await model.settled();
    });

    test('actions observe the final transformed batch', async () => {
        const observed: unknown[] = [];
        const model = createModel({
            a: { type: 'number', default: 1, transform: Number },
            b: { type: 'number', default: 2 },
            sum: {
                type: 'number',
                reaction: {
                    fields: ['a', 'b'],
                    computed: ({ a, b }) => a + b,
                    action: [() => { observed.push(model.data); }],
                },
            },
        });
        model.setFields({ a: 3, b: 4 });
        expect(observed).toEqual([]);
        await model.settled();
        expect(observed).toEqual([{ a: 3, b: 4, sum: 7 }]);
        model.dispose();
    });
});
