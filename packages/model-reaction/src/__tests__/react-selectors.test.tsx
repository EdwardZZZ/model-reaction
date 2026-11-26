/** @jest-environment jsdom */
import * as React from 'react';
import { useCallback, useState } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { shallow, useModelComputed, useModelSelector } from '../react';
import {
    makeCart,
    makeOrderModel,
    useTracked,
    type Cart,
    type OrderState,
} from './react-test-helpers';

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

    it('updates the snapshot when the selector reference changes', async () => {
        const cart = makeCart();
        const subscribeSpy = jest.spyOn(cart, 'subscribe');

        let setBump: (v: number) => void = () => undefined;

        function Total() {
            const [bump, setBumpState] = useState(0);
            setBump = setBumpState;
            // The selector changes with a render value and produces a new
            // result immediately as the subscription is rebuilt.
            const selector = useCallback(
                (d: Cart) => d.qty * d.price + bump,
                [bump],
            );
            const total = useModelSelector(cart, selector);
            return <span>{total}</span>;
        }

        const { getByText } = render(<Total />);
        expect(getByText('100')).toBeTruthy();
        const before = subscribeSpy.mock.calls.length;
        expect(before).toBeGreaterThan(0);

        await act(async () => {
            setBump(1);
        });
        expect(getByText('101')).toBeTruthy();
        expect(subscribeSpy.mock.calls.length).toBeGreaterThan(before);

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
// useModelComputed — render-local selectors and stable subscriptions
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

        // The selector must read the latest `id` without resubscribing.
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

describe.each([
    { name: 'useModelSelector', useSelection: useModelSelector },
    { name: 'useModelComputed', useSelection: useModelComputed },
])('$name — shared snapshot behaviour', ({ useSelection }) => {
    it('switches models and cleans up the previous subscription', async () => {
        const first = makeCart();
        const second = makeCart();
        await second.setField('qty', 2);
        const { result, rerender, unmount } = renderHook(
            ({ model }) => useTracked(model, (d) => d.qty, undefined, useSelection),
            { initialProps: { model: first } }
        );
        try {
            expect(result.current.value).toBe(1);
            rerender({ model: second });
            expect(result.current.value).toBe(2);
            const before = result.current.renders;
            await act(async () => { await first.setField('qty', 3); });
            expect(result.current.renders).toBe(before);
            await act(async () => { await second.setField('qty', 4); });
            expect(result.current.value).toBe(4);
        } finally {
            unmount();
            first.dispose();
            second.dispose();
        }
    });

    it('updates equality while preserving its subscription policy', async () => {
        const cart = makeCart();
        const onSpy = jest.spyOn(cart, 'on');
        const { result, rerender, unmount } = renderHook(
            ({ isEqual }) => {
                const selector = useCallback((data: Cart) => ({ qty: data.qty }), []);
                return useSelection(cart, selector, isEqual);
            },
            { initialProps: { isEqual: shallow as (a: { qty: number }, b: { qty: number }) => boolean } }
        );
        try {
            const first = result.current;
            const subscriptions = onSpy.mock.calls.length;
            rerender({ isEqual: Object.is });
            expect(result.current).not.toBe(first);
            if (useSelection === useModelComputed) {
                expect(onSpy).toHaveBeenCalledTimes(subscriptions);
            } else {
                expect(onSpy.mock.calls.length).toBeGreaterThan(subscriptions);
            }
            const second = result.current;
            await act(async () => { await cart.setField('coupon', 'X'); });
            expect(result.current).not.toBe(second);
            rerender({ isEqual: shallow });
            const third = result.current;
            await act(async () => { await cart.setField('coupon', 'Y'); });
            expect(result.current).toBe(third);
        } finally {
            unmount();
            cart.dispose();
        }
    });

    it('keeps the committed selector active when a new selector render suspends', async () => {
        const cart = makeCart();
        const suspended = new Promise<void>(() => {});
        const attempts = jest.fn();
        let changeId!: (id: 'a' | 'b') => void;
        function Row({ id }: { id: 'a' | 'b' }) {
            const name = useSelection(cart, (d) => d.items[id]?.name);
            attempts(id);
            if (id === 'b') throw suspended;
            return <span>{name}</span>;
        }
        function App() {
            const [id, setId] = useState<'a' | 'b'>('a');
            changeId = setId;
            return <React.Suspense fallback="loading"><Row id={id} /></React.Suspense>;
        }
        const { getByText, unmount } = render(<App />);
        try {
            act(() => { React.startTransition(() => changeId('b')); });
            expect(attempts).toHaveBeenCalledWith('b');
            expect(getByText('A')).toBeTruthy();
            await act(async () => {
                await cart.setField('items', { a: { name: 'Updated A' }, b: { name: 'B' } });
            });
            expect(getByText('Updated A')).toBeTruthy();
            act(() => changeId('a'));
            expect(getByText('Updated A')).toBeTruthy();
        } finally {
            unmount();
            cart.dispose();
        }
    });
});


// ---------------------------------------------------------------------------
// shallow — equality helper
// ---------------------------------------------------------------------------

describe('shallow', () => {
    it('treats identical references and primitives as equal', () => {
        const obj = { a: 1 };
        expect(shallow(obj, obj)).toBe(true);
        expect(shallow(1, 1)).toBe(true);
        expect(shallow('x', 'x')).toBe(true);
        expect(shallow(null, null)).toBe(true);
    });

    it('compares plain objects one level deep', () => {
        expect(shallow({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
        expect(shallow({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
        expect(shallow({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        // Nested objects are compared by reference, not structurally.
        const nested = { c: 1 };
        expect(shallow({ a: nested }, { a: nested })).toBe(true);
        expect(shallow({ a: { c: 1 } }, { a: { c: 1 } })).toBe(false);
    });

    it('compares arrays one level deep', () => {
        expect(shallow([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(shallow([1, 2], [1, 2, 3])).toBe(false);
        expect(shallow([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it('compares enumerable symbol keys using the same policy as object spread', () => {
        const key = Symbol('value');
        const other = Symbol('value');
        expect(shallow({ [key]: true }, { [key]: true })).toBe(true);
        expect(shallow({ [key]: true }, { [key]: false })).toBe(false);
        expect(shallow({ [key]: true }, { [other]: true })).toBe(false);
        expect(shallow({ [key]: true }, {})).toBe(false);
        const hidden = Object.defineProperty({}, key, { value: true, enumerable: false });
        expect(shallow(hidden, {})).toBe(true);
        expect(shallow({ [key]: true }, hidden)).toBe(false);
    });

    it('returns false for mismatched types and null vs object', () => {
        expect(shallow([1] as unknown as object, { 0: 1 })).toBe(false);
        expect(shallow(null as unknown as object, { a: 1 })).toBe(false);
        expect(shallow({ a: 1 }, null as unknown as object)).toBe(false);
    });
});
