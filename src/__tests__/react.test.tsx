/**
 * @jest-environment jsdom
 *
 * Tests for the React adapter (`src/react.ts`):
 * - `useModelSelector`: selector + custom `isEqual` re-render suppression
 * - `useModelComputed`: ref-locked variant that does not resubscribe on
 *   selector identity changes
 */
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { act, render, renderHook } from '@testing-library/react';

import { createModel, ValidationRules } from '../index';
import { useModelComputed, useModelSelector } from '../react';
import type { ModelReturn } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Cart {
    qty: number;
    price: number;
    coupon: string;
    items: Record<string, { name: string }>;
}

function makeCart() {
    return createModel<Cart>({
        qty:    { type: 'number', default: 1 },
        price:  { type: 'number', default: 100 },
        coupon: { type: 'string', default: '' },
        items:  {
            type: 'object',
            default: { a: { name: 'A' }, b: { name: 'B' } },
        },
    });
}

interface OrderState {
    items: Array<{ id: string; qty: number }>;
    coupon: string;
    note: string;
}

function makeOrderModel() {
    return createModel<OrderState>({
        items: {
            type: 'array',
            default: [
                { id: 'a', qty: 1 },
                { id: 'b', qty: 2 },
            ],
        },
        coupon: { type: 'string', default: '' },
        note: { type: 'string', default: '', validator: [ValidationRules.string] },
    });
}

/**
 * Hook harness: counts renders without polluting the hook under test.
 */
function useTracked<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (d: T) => R,
    isEqual?: (a: R, b: R) => boolean
) {
    const renders = useRef(0);
    renders.current += 1;
    const value = useModelSelector(model, selector, isEqual);
    return { value, renders: renders.current };
}

// ---------------------------------------------------------------------------
// useModelSelector — basic behaviour
// ---------------------------------------------------------------------------

describe('useModelSelector', () => {
    it('subscribes to derived value and re-renders only when it changes', async () => {
        const cart = makeCart();
        let renderCount = 0;
        let lastTotal = 0;

        function Total() {
            renderCount++;
            const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
            const total = useModelSelector(cart, selectTotal);
            lastTotal = total;
            return <span>{total}</span>;
        }

        render(<Total />);
        const initialRenders = renderCount;
        expect(lastTotal).toBe(100);

        // Field that does NOT affect the selector → no extra render.
        await act(async () => {
            await cart.setField('coupon', 'SAVE10');
        });
        expect(renderCount).toBe(initialRenders);
        expect(lastTotal).toBe(100);

        // Field that DOES affect the selector → exactly one extra render.
        await act(async () => {
            await cart.setField('qty', 3);
        });
        expect(lastTotal).toBe(300);
        expect(renderCount).toBe(initialRenders + 1);

        cart.dispose();
    });

    it('re-subscribes when the selector reference changes', async () => {
        const cart = makeCart();
        let subscribeCalls = 0;
        const originalSubscribe = cart.subscribe;
        cart.subscribe = ((...args: Parameters<typeof originalSubscribe>) => {
            subscribeCalls++;
            return originalSubscribe(...args);
        }) as typeof originalSubscribe;

        let setBump: (v: number) => void = () => undefined;

        function Total() {
            const [bump, setBumpState] = useState(0);
            setBump = setBumpState;
            // Intentionally unstable: a *new* selector each render whose
            // identity changes whenever `bump` changes.
            const selector = useCallback(
                (d: Cart) => d.qty * d.price + bump * 0,
                [bump],
            );
            const total = useModelSelector(cart, selector);
            return <span>{total}</span>;
        }

        render(<Total />);
        const before = subscribeCalls;
        expect(before).toBeGreaterThan(0);

        await act(async () => {
            setBump(1);
        });
        expect(subscribeCalls).toBeGreaterThan(before);

        cart.dispose();
    });
});

// ---------------------------------------------------------------------------
// useModelSelector — isEqual suppression for complex derived values
// ---------------------------------------------------------------------------

describe('useModelSelector — isEqual suppression for complex derived values', () => {
    test('default Object.is fires every time selector returns a new object reference', async () => {
        const model = makeOrderModel();

        const { result } = renderHook(() =>
            // No isEqual → falls back to Object.is. Each call to the selector
            // produces a brand-new array, so every commit is treated as a change.
            useTracked(model, (d) => d.items.map((i) => i.qty))
        );

        const initialRenders = result.current.renders;
        expect(result.current.value).toEqual([1, 2]);

        // Mutating an unrelated field still re-runs the selector and the
        // resulting `[1, 2]` array is a new reference → re-render happens.
        await act(async () => {
            await model.setField('coupon', 'SAVE10');
        });

        expect(result.current.renders).toBeGreaterThan(initialRenders);

        model.dispose();
    });

    test('structural isEqual suppresses re-render when derived array is unchanged', async () => {
        const model = makeOrderModel();

        const arrayEq = <U,>(a: U[], b: U[]) =>
            a.length === b.length && a.every((v, i) => v === b[i]);

        const { result } = renderHook(() =>
            useTracked(
                model,
                (d) => d.items.map((i) => i.qty),
                arrayEq
            )
        );

        const initialRenders = result.current.renders;
        expect(result.current.value).toEqual([1, 2]);

        // Unrelated field changes; derived array is structurally equal to the
        // previous one. With our custom equality, hook MUST NOT re-render.
        await act(async () => {
            await model.setField('coupon', 'SAVE10');
        });
        expect(result.current.renders).toBe(initialRenders);

        await act(async () => {
            await model.setField('note', 'gift wrap');
        });
        expect(result.current.renders).toBe(initialRenders);

        // Now actually change the derived value: items[1].qty 2 → 5.
        await act(async () => {
            await model.setField('items', [
                { id: 'a', qty: 1 },
                { id: 'b', qty: 5 },
            ]);
        });

        expect(result.current.renders).toBe(initialRenders + 1);
        expect(result.current.value).toEqual([1, 5]);

        model.dispose();
    });

    test('structural isEqual on derived object: same shape skips, real change re-renders', async () => {
        const model = makeOrderModel();

        // Derived: { totalQty, hasCoupon } — both pieces of info recomputed
        // from primitive fields, packed into a fresh object every call.
        const selector = (d: OrderState) => ({
            totalQty: d.items.reduce((s, x) => s + x.qty, 0),
            hasCoupon: d.coupon.length > 0,
        });
        const objEq = (
            a: { totalQty: number; hasCoupon: boolean },
            b: { totalQty: number; hasCoupon: boolean }
        ) => a.totalQty === b.totalQty && a.hasCoupon === b.hasCoupon;

        const { result } = renderHook(() => useTracked(model, selector, objEq));
        const r0 = result.current.renders;
        expect(result.current.value).toEqual({ totalQty: 3, hasCoupon: false });

        // Change `note` (not in selector) → no re-render.
        await act(async () => {
            await model.setField('note', 'urgent');
        });
        expect(result.current.renders).toBe(r0);

        // Replace items but keep total qty unchanged → object is structurally
        // equal → MUST NOT re-render.
        await act(async () => {
            await model.setField('items', [
                { id: 'a', qty: 2 },
                { id: 'b', qty: 1 },
            ]);
        });
        expect(result.current.renders).toBe(r0);
        expect(result.current.value).toEqual({ totalQty: 3, hasCoupon: false });

        // Add a coupon → hasCoupon flips → MUST re-render.
        await act(async () => {
            await model.setField('coupon', 'SAVE10');
        });
        expect(result.current.renders).toBe(r0 + 1);
        expect(result.current.value).toEqual({ totalQty: 3, hasCoupon: true });

        // Change items so total qty changes → MUST re-render again.
        await act(async () => {
            await model.setField('items', [
                { id: 'a', qty: 4 },
                { id: 'b', qty: 1 },
            ]);
        });
        expect(result.current.renders).toBe(r0 + 2);
        expect(result.current.value).toEqual({ totalQty: 5, hasCoupon: true });

        model.dispose();
    });

    test('isEqual is consulted on every model mutation (not just relevant ones)', async () => {
        const model = makeOrderModel();
        const isEqual = jest.fn((a: number, b: number) => a === b);

        const { result } = renderHook(() =>
            useTracked(model, (d) => d.items.length, isEqual)
        );
        const r0 = result.current.renders;

        // Two unrelated mutations — selector still resolves to 2 each time;
        // isEqual is invoked, returns true, no re-render is scheduled.
        await act(async () => {
            await model.setField('coupon', 'A');
        });
        await act(async () => {
            await model.setField('note', 'B');
        });

        expect(isEqual).toHaveBeenCalled();
        expect(isEqual.mock.calls.every(([a, b]) => a === b)).toBe(true);
        expect(result.current.renders).toBe(r0);

        // A mutation that changes the derived value — isEqual returns false,
        // hook re-renders.
        await act(async () => {
            await model.setField('items', [{ id: 'c', qty: 9 }]);
        });
        expect(result.current.renders).toBe(r0 + 1);
        expect(result.current.value).toBe(1);

        model.dispose();
    });
});

// ---------------------------------------------------------------------------
// useModelComputed
// ---------------------------------------------------------------------------

describe('useModelComputed', () => {
    it('does NOT resubscribe when the selector reference changes', async () => {
        const cart = makeCart();

        // Spy on the underlying event channel that `useModelComputed`
        // subscribes to. Reference changes must not produce additional
        // listener registrations.
        const originalOn = cart.on;
        let onCalls = 0;
        cart.on = ((...args: Parameters<typeof originalOn>) => {
            onCalls++;
            return originalOn(...args);
        }) as typeof originalOn;

        let setBump: (v: number) => void = () => undefined;

        function Total() {
            const [bump, setBumpState] = useState(0);
            setBump = setBumpState;
            // Inline arrow → fresh reference every render.
            const total = useModelComputed(cart, (d) => d.qty * d.price + bump * 0);
            return <span>{total}</span>;
        }

        render(<Total />);
        const initialOnCalls = onCalls;
        expect(initialOnCalls).toBeGreaterThan(0);

        // Trigger several renders with a new selector identity each time.
        await act(async () => {
            setBump(1);
        });
        await act(async () => {
            setBump(2);
        });

        expect(onCalls).toBe(initialOnCalls);

        cart.dispose();
    });

    it('reflects per-render closure variables without `useCallback`', async () => {
        const cart = makeCart();

        let setId: (v: 'a' | 'b') => void = () => undefined;
        let lastName: string | undefined;

        function Row({ initialId }: { initialId: 'a' | 'b' }) {
            const [id, setIdState] = useState<'a' | 'b'>(initialId);
            setId = setIdState;
            const item = useModelComputed(cart, (d) => d.items[id]);
            lastName = item?.name;
            return <span>{item?.name}</span>;
        }

        render(<Row initialId="a" />);
        expect(lastName).toBe('A');

        // Closure variable `id` updates between renders. Without ref-locked
        // semantics we'd be stuck on 'A'.
        await act(async () => {
            setId('b');
        });
        expect(lastName).toBe('B');

        cart.dispose();
    });

    it('re-renders when the model emits a relevant change', async () => {
        const cart = makeCart();
        let renderCount = 0;
        let lastTotal = 0;

        function Total() {
            renderCount++;
            const total = useModelComputed(cart, (d) => d.qty * d.price);
            lastTotal = total;
            return <span>{total}</span>;
        }

        render(<Total />);
        const before = renderCount;
        expect(lastTotal).toBe(100);

        await act(async () => {
            await cart.setField('qty', 5);
        });
        expect(lastTotal).toBe(500);
        // At least one new render must have occurred.
        expect(renderCount).toBeGreaterThan(before);

        cart.dispose();
    });

    it('honours custom `isEqual` (no re-render when slice is shallow-equal)', async () => {
        const cart = makeCart();
        let renderCount = 0;
        let lastSliceRef: { qty: number; price: number } | null = null;

        const shallowEq = (
            a: { qty: number; price: number },
            b: { qty: number; price: number },
        ) => a.qty === b.qty && a.price === b.price;

        function Slice() {
            renderCount++;
            const slice = useModelComputed(
                cart,
                (d) => ({ qty: d.qty, price: d.price }),
                shallowEq,
            );
            lastSliceRef = slice;
            return <span>{slice.qty * slice.price}</span>;
        }

        render(<Slice />);
        const initialRenders = renderCount;
        const refAfterFirst = lastSliceRef;

        // Mutate an unrelated field — selector returns a *new* container,
        // but shallowEq must short-circuit and reuse the cached snapshot,
        // so React sees the same reference and skips the re-render.
        await act(async () => {
            await cart.setField('coupon', 'X');
        });
        expect(renderCount).toBe(initialRenders);
        expect(lastSliceRef).toBe(refAfterFirst);

        // Mutating an *included* field bumps the cache; one re-render.
        await act(async () => {
            await cart.setField('qty', 9);
        });
        expect(renderCount).toBe(initialRenders + 1);
        expect(lastSliceRef).not.toBe(refAfterFirst);
        expect(lastSliceRef).toEqual({ qty: 9, price: 100 });

        cart.dispose();
    });
});
