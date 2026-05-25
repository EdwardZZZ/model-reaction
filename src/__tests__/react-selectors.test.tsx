/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { useCallback, useState } from 'react';
import { act, render } from '@testing-library/react';

import { createModel } from '../index';
import { useModelComputed, useModelSelector } from '../react';

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

// ---------------------------------------------------------------------------
// useModelSelector
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
