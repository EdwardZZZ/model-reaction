import { createModel, ModelEvents } from '../index';

describe('model events and selectors', () => {
    test('emits committed values synchronously and isolates throwing listeners', () => {
        const model = createModel({ name: { type: 'string', default: '' } });
        const listener = jest.fn();
        model.on(ModelEvents.FIELD_CHANGE, () => { throw new Error('listener failed'); });
        const unsubscribe = model.on(ModelEvents.FIELD_CHANGE, listener);
        model.setField('name', 'Ada');
        expect(listener).toHaveBeenCalledWith({ field: 'name', value: 'Ada' });
        unsubscribe();
        unsubscribe();
        model.setField('name', 'Grace');
        expect(listener).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test('removes only the selected callback and keeps model buses independent', () => {
        const first = createModel({ name: { type: 'string', default: '' } });
        const second = createModel({ name: { type: 'string', default: '' } });
        const one = jest.fn(), two = jest.fn(), other = jest.fn();
        const unsubscribe = first.on(ModelEvents.FIELD_CHANGE, one);
        first.on(ModelEvents.FIELD_CHANGE, two);
        second.on(ModelEvents.FIELD_CHANGE, other);
        unsubscribe();
        first.setField('name', 'Ada');
        expect(one).not.toHaveBeenCalled();
        expect(two).toHaveBeenCalledTimes(1);
        expect(other).not.toHaveBeenCalled();
        first.dispose();
        second.setField('name', 'Grace');
        expect(other).toHaveBeenCalledTimes(1);
        second.dispose();
    });

    test('selector subscriptions filter unrelated changes and report previous values', () => {
        const model = createModel({
            a: { type: 'number', default: 1 },
            b: { type: 'number', default: 2 },
            note: { type: 'string', default: '' },
        });
        const callback = jest.fn();
        const unsubscribe = model.subscribe((data) => data.a + data.b, callback);
        model.setField('note', 'unrelated');
        expect(callback).not.toHaveBeenCalled();
        model.setField('a', 3);
        expect(callback).toHaveBeenCalledWith(5, 3);
        unsubscribe();
        model.setField('b', 4);
        expect(callback).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test('uses custom equality for selected objects', () => {
        const model = createModel({ a: { type: 'number', default: 1 }, b: { type: 'number', default: 2 } });
        const callback = jest.fn();
        model.subscribe((data) => ({ a: data.a }), callback, (a, b) => a.a === b.a);
        model.setField('b', 3);
        expect(callback).not.toHaveBeenCalled();
        model.setField('a', 4);
        expect(callback).toHaveBeenCalledWith({ a: 4 }, { a: 1 });
        model.dispose();
    });
});
