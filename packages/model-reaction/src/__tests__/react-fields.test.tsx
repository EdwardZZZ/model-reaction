/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { createModel } from '../index';
import { useModelField, useModelFields, useModelFieldState } from '../react';
import { makeCart } from './react-test-helpers';

describe('React field bindings', () => {
    test('subscribes only to the requested field and skips equal writes', () => {
        const model = makeCart();
        let renders = 0;
        const { result, unmount } = renderHook(() => { renders++; return useModelField(model, 'qty'); });
        const initial = renders;
        act(() => model.setField('coupon', 'SAVE10'));
        act(() => model.setField('qty', 1));
        expect(renders).toBe(initial);
        act(() => model.setField('qty', 7));
        expect(result.current).toBe(7);
        expect(renders).toBe(initial + 1);
        unmount();
        model.dispose();
    });

    test('picks fields, filters unrelated updates and rebuilds when keys change', () => {
        const model = makeCart();
        let renders = 0;
        const { result, rerender, unmount } = renderHook(
            ({ keys }: { keys: Array<'qty' | 'price' | 'coupon'> }) => {
                renders++;
                return useModelFields(model, keys);
            }, { initialProps: { keys: ['qty', 'price'] as Array<'qty' | 'price' | 'coupon'> } }
        );
        const initial = renders;
        expect(result.current).toEqual({ qty: 1, price: 100 });
        act(() => model.setField('coupon', 'SAVE10'));
        expect(renders).toBe(initial);
        act(() => model.setField('price', 250));
        expect(result.current).toEqual({ qty: 1, price: 250 });
        rerender({ keys: ['qty', 'coupon'] });
        expect(result.current).toEqual({ qty: 1, coupon: 'SAVE10' });
        unmount();
        model.dispose();
    });

    test('returns a stable synchronous setter and updates when the field changes', () => {
        const model = makeCart();
        const { result, rerender, unmount } = renderHook(
            ({ field }: { field: 'qty' | 'price' }) => useModelFieldState(model, field),
            { initialProps: { field: 'qty' as 'qty' | 'price' } }
        );
        const setter = result.current[1];
        act(() => expect(setter(3)).toBeUndefined());
        expect(result.current).toHaveLength(2);
        expect(result.current[0]).toBe(3);
        expect(result.current[1]).toBe(setter);
        rerender({ field: 'price' });
        act(() => result.current[1](50));
        expect(model.data.qty).toBe(3);
        expect(model.data.price).toBe(50);
        unmount();
        model.dispose();
    });

    test('propagates synchronous transform exceptions through the lower-level setter', () => {
        const model = createModel({
            count: { type: 'number', default: 1, transform: () => { throw new Error('write failed'); } },
        });
        const { result, unmount } = renderHook(() => useModelFieldState(model, 'count'));
        expect(() => result.current[1](2)).toThrow('write failed');
        expect(result.current[0]).toBe(1);
        unmount();
        model.dispose();
    });
});
