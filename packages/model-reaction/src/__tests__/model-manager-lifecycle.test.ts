import { createModel, ModelEvents } from '../index';
import { ModelManager } from '../core/model-manager';

describe('model lifecycle', () => {
    test('exposes bound public methods and throws synchronously after disposal', async () => {
        const model = createModel({ count: { type: 'number', default: 1 } });
        expect(model).toBeInstanceOf(ModelManager);
        const { setField, setFields, getField, dispose, settled } = model;
        setField('count', 2);
        expect(getField('count')).toBe(2);
        dispose();
        dispose();
        expect(model.data).toEqual({});
        expect(() => setField('count', 3)).toThrow('disposed');
        expect(() => setFields({ count: 3 })).toThrow('disposed');
        await settled();
    });

    test('stops subscriptions and cancels unstarted actions on disposal', async () => {
        const computed = jest.fn(({ input }) => input + 1);
        const action = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            output: { type: 'number', reaction: { fields: ['input'], computed, action: [action] } },
        });
        const listener = jest.fn();
        model.on(ModelEvents.FIELD_CHANGE, listener);
        model.setField('input', 1);
        const waiting = model.settled();
        model.dispose();
        await waiting;
        expect(computed).toHaveBeenCalledTimes(1);
        expect(action).not.toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(2);
        expect(model.data).toEqual({});
    });

    test('does not commit after disposal from a direct transform', () => {
        const model = createModel({
            count: { type: 'number', default: 1, transform: (value) => { model.dispose(); return value; } },
        });
        model.setField('count', 2);
        expect(model.data).toEqual({});
    });

    test('clones array and nested object defaults per instance', () => {
        const schema = {
            list: { type: 'array' as const, default: [{ name: 'a' }] },
            detail: { type: 'object' as const, default: { nested: { name: 'a' } } },
        };
        const first = createModel(schema);
        const second = createModel(schema);
        first.data.list[0]!.name = 'changed';
        first.data.detail.nested.name = 'changed';
        expect(second.data.list[0]!.name).toBe('a');
        expect(second.data.detail.nested.name).toBe('a');
        expect(schema.detail.default.nested.name).toBe('a');
        first.dispose();
        second.dispose();
    });

    test('preserves Date default identity as an immutable leaf', () => {
        const date = new Date(0);
        const model = createModel({ date: { type: 'date', default: date } });
        expect(model.data.date).toBe(date);
        model.dispose();
    });
});
