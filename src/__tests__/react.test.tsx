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
import {
    Field,
    ModelProvider,
    shallow,
    useModel,
    useModelComputed,
    useModelField,
    useModelFields,
    useModelFieldState,
    useModelSelector,
} from '../react';
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

// ---------------------------------------------------------------------------
// Provider-owned model lifecycle (AGENTS.md §3 pitfall #5)
//
// Verifies that wrapping `createModel(...)` in a Context Provider with a
// `useEffect` cleanup actually triggers `dispose()` exactly once when the
// owner unmounts — and that consumer hooks stop receiving updates afterwards.
// ---------------------------------------------------------------------------

describe('Provider-owned model dispose lifecycle', () => {
    interface UserData {
        name: string;
        email: string;
    }

    function makeUserModel() {
        return createModel<UserData>({
            name: { type: 'string', default: '' },
            email: { type: 'string', default: '' },
        });
    }

    it('dispose() is called exactly once when the Provider unmounts', () => {
        const model = makeUserModel();
        const disposeSpy = jest.spyOn(model, 'dispose');

        const Ctx = React.createContext<ModelReturn<UserData> | null>(null);

        function UserModelProvider({
            children,
            value,
        }: {
            children: React.ReactNode;
            value: ModelReturn<UserData>;
        }) {
            React.useEffect(() => {
                return () => {
                    value.dispose();
                };
            }, [value]);
            return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
        }

        function Consumer() {
            const m = React.useContext(Ctx)!;
            const name = useModelSelector(m, (d) => d.name);
            return <span data-testid="name">{name}</span>;
        }

        const { unmount } = render(
            <UserModelProvider value={model}>
                <Consumer />
            </UserModelProvider>
        );

        // Owner is alive — dispose should NOT have been called yet.
        expect(disposeSpy).not.toHaveBeenCalled();

        // Tear the tree down.
        act(() => {
            unmount();
        });

        // Cleanup of the Provider's effect must have triggered dispose exactly once.
        expect(disposeSpy).toHaveBeenCalledTimes(1);

        disposeSpy.mockRestore();
    });

    it('shared consumers stay in sync while the Provider is mounted, and the model is disposed afterwards', async () => {
        const model = makeUserModel();
        const disposeSpy = jest.spyOn(model, 'dispose');

        const Ctx = React.createContext<ModelReturn<UserData> | null>(null);

        function UserModelProvider({
            children,
            value,
        }: {
            children: React.ReactNode;
            value: ModelReturn<UserData>;
        }) {
            React.useEffect(() => () => value.dispose(), [value]);
            return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
        }

        function Profile() {
            const m = React.useContext(Ctx)!;
            const name = useModelSelector(m, (d) => d.name);
            return <span data-testid="profile-name">{name}</span>;
        }

        function Settings() {
            const m = React.useContext(Ctx)!;
            const email = useModelSelector(m, (d) => d.email);
            return <span data-testid="settings-email">{email}</span>;
        }

        const { getByTestId, unmount } = render(
            <UserModelProvider value={model}>
                <Profile />
                <Settings />
            </UserModelProvider>
        );

        // Both consumers see the same model instance.
        expect(getByTestId('profile-name').textContent).toBe('');
        expect(getByTestId('settings-email').textContent).toBe('');

        await act(async () => {
            await model.setField('name', 'Ada');
            await model.setField('email', 'ada@example.com');
        });

        expect(getByTestId('profile-name').textContent).toBe('Ada');
        expect(getByTestId('settings-email').textContent).toBe(
            'ada@example.com'
        );
        expect(disposeSpy).not.toHaveBeenCalled();

        // Unmount the whole tree → Provider effect cleanup runs → dispose().
        act(() => {
            unmount();
        });

        expect(disposeSpy).toHaveBeenCalledTimes(1);

        disposeSpy.mockRestore();
    });

    it('remounting the Provider with a fresh model does not re-dispose the old one', () => {
        const modelA = makeUserModel();
        const modelB = makeUserModel();
        const spyA = jest.spyOn(modelA, 'dispose');
        const spyB = jest.spyOn(modelB, 'dispose');

        const Ctx = React.createContext<ModelReturn<UserData> | null>(null);

        function UserModelProvider({
            children,
            value,
        }: {
            children: React.ReactNode;
            value: ModelReturn<UserData>;
        }) {
            React.useEffect(() => () => value.dispose(), [value]);
            return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
        }

        function Probe() {
            const m = React.useContext(Ctx)!;
            const name = useModelSelector(m, (d) => d.name);
            return <span>{name}</span>;
        }

        const { rerender, unmount } = render(
            <UserModelProvider value={modelA}>
                <Probe />
            </UserModelProvider>
        );

        // Swap in a different model — effect cleanup must fire for the old one.
        rerender(
            <UserModelProvider value={modelB}>
                <Probe />
            </UserModelProvider>
        );

        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).not.toHaveBeenCalled();

        unmount();

        // Final unmount tears down the live model (B).
        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).toHaveBeenCalledTimes(1);

        spyA.mockRestore();
        spyB.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// useModelField — single-field subscription
// ---------------------------------------------------------------------------

describe('useModelField', () => {
    it('returns the current value and re-renders only when that field changes', async () => {
        const cart = makeCart();
        let renderCount = 0;
        let lastQty = 0;

        function Qty() {
            renderCount++;
            lastQty = useModelField(cart, 'qty');
            return <span>{lastQty}</span>;
        }

        render(<Qty />);
        const initial = renderCount;
        expect(lastQty).toBe(1);

        // Unrelated field → no re-render.
        await act(async () => {
            await cart.setField('coupon', 'SAVE10');
        });
        expect(renderCount).toBe(initial);
        expect(lastQty).toBe(1);

        // The subscribed field → exactly one re-render.
        await act(async () => {
            await cart.setField('qty', 7);
        });
        expect(lastQty).toBe(7);
        expect(renderCount).toBe(initial + 1);

        cart.dispose();
    });

    it('does not re-render when a failed set leaves the value unchanged', async () => {
        const model = makeOrderModel();
        let renderCount = 0;

        function Note() {
            renderCount++;
            const note = useModelField(model, 'note');
            return <span>{note}</span>;
        }

        render(<Note />);
        const initial = renderCount;

        // `note` only accepts strings; a number fails validation and is
        // diverted to dirtyData, so the committed value never changes.
        await act(async () => {
            await model.setField('note', 123 as unknown as string);
        });
        expect(renderCount).toBe(initial);

        model.dispose();
    });
});

// ---------------------------------------------------------------------------
// useModelFields — multi-field subscription
// ---------------------------------------------------------------------------

describe('useModelFields', () => {
    it('returns the picked fields and re-renders only on shallow change', async () => {
        const cart = makeCart();
        let renderCount = 0;
        let last: { qty: number; price: number } = { qty: 0, price: 0 };

        function Picked() {
            renderCount++;
            last = useModelFields(cart, ['qty', 'price']);
            return <span>{last.qty * last.price}</span>;
        }

        render(<Picked />);
        const initial = renderCount;
        expect(last).toEqual({ qty: 1, price: 100 });

        // A field outside the picked set → no re-render.
        await act(async () => {
            await cart.setField('coupon', 'SAVE10');
        });
        expect(renderCount).toBe(initial);

        // A picked field changes → one re-render.
        await act(async () => {
            await cart.setField('price', 250);
        });
        expect(last).toEqual({ qty: 1, price: 250 });
        expect(renderCount).toBe(initial + 1);

        cart.dispose();
    });

    it('rebuilds the snapshot when the list of fields changes', async () => {
        const cart = makeCart();
        let setFieldsList: (f: Array<'qty' | 'price' | 'coupon'>) => void =
            () => undefined;
        let last: Record<string, unknown> = {};

        function Picked() {
            const [fields, setFields] = useState<
                Array<'qty' | 'price' | 'coupon'>
            >(['qty']);
            setFieldsList = setFields;
            last = useModelFields(cart, fields);
            return <span>{Object.keys(last).join(',')}</span>;
        }

        render(<Picked />);
        expect(last).toEqual({ qty: 1 });

        // Change the requested field list → snapshot rebuilds to the new shape.
        await act(async () => {
            setFieldsList(['qty', 'coupon']);
        });
        expect(last).toEqual({ qty: 1, coupon: '' });

        cart.dispose();
    });
});

// ---------------------------------------------------------------------------
// useModelFieldState — value + setter + meta
// ---------------------------------------------------------------------------

describe('useModelFieldState', () => {
    interface Signup {
        email: string;
    }

    function makeSignupModel() {
        return createModel<Signup>({
            email: {
                type: 'string',
                default: '',
                validator: [ValidationRules.required, ValidationRules.email],
            },
        });
    }

    it('commits a valid value and exposes clean meta', async () => {
        const model = makeSignupModel();
        const { result } = renderHook(() =>
            useModelFieldState(model, 'email')
        );

        expect(result.current[0]).toBe('');
        expect(result.current[2].error).toBeNull();
        expect(result.current[2].dirty).toBe(false);

        await act(async () => {
            const ok = await result.current[1]('user@example.com');
            expect(ok).toBe(true);
        });

        expect(result.current[0]).toBe('user@example.com');
        expect(result.current[2].error).toBeNull();
        expect(result.current[2].errors).toHaveLength(0);
        expect(result.current[2].dirty).toBe(false);

        model.dispose();
    });

    it('surfaces error + dirty meta when the set fails validation', async () => {
        const model = makeSignupModel();
        const { result } = renderHook(() =>
            useModelFieldState(model, 'email')
        );

        await act(async () => {
            const ok = await result.current[1]('not-an-email');
            expect(ok).toBe(false);
        });

        // Committed value stays at the default; the failed input is dirty.
        expect(result.current[0]).toBe('');
        expect(result.current[2].error).toBe('Invalid email format');
        expect(result.current[2].errors.length).toBeGreaterThan(0);
        expect(result.current[2].dirty).toBe(true);

        // Correcting it clears both error and dirty state.
        await act(async () => {
            await result.current[1]('user@example.com');
        });
        expect(result.current[2].error).toBeNull();
        expect(result.current[2].dirty).toBe(false);

        model.dispose();
    });
});

// ---------------------------------------------------------------------------
// useModel — Provider consumption
// ---------------------------------------------------------------------------

describe('useModel', () => {
    interface UserData {
        name: string;
    }

    it('reads the model from the nearest ModelProvider', () => {
        const model = createModel<UserData>({
            name: { type: 'string', default: 'Ada' },
        });

        function Consumer() {
            const m = useModel<UserData>();
            const name = useModelField(m, 'name');
            return <span data-testid="name">{name}</span>;
        }

        const { getByTestId } = render(
            <ModelProvider model={model}>
                <Consumer />
            </ModelProvider>
        );

        expect(getByTestId('name').textContent).toBe('Ada');
        model.dispose();
    });

    it('throws when used without a surrounding ModelProvider', () => {
        function Orphan() {
            useModel();
            return null;
        }
        // Silence the expected React error boundary logging.
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<Orphan />)).toThrow(/must be used inside/);
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// Field — render-prop binding
// ---------------------------------------------------------------------------

describe('Field', () => {
    interface FormData {
        email: string;
    }

    function makeFormModel() {
        return createModel<FormData>({
            email: {
                type: 'string',
                default: '',
                validator: [ValidationRules.email],
            },
        });
    }

    it('binds a render-prop to a field via the surrounding provider', async () => {
        const model = makeFormModel();

        const { getByTestId } = render(
            <ModelProvider model={model}>
                <Field<FormData, 'email'> name="email">
                    {({ value, setValue, meta }) => (
                        <div>
                            <span data-testid="value">{value}</span>
                            <span data-testid="error">{meta.error ?? ''}</span>
                            <button
                                data-testid="set"
                                onClick={() => setValue('me@example.com')}
                            >
                                set
                            </button>
                        </div>
                    )}
                </Field>
            </ModelProvider>
        );

        expect(getByTestId('value').textContent).toBe('');

        await act(async () => {
            await model.setField('email', 'me@example.com');
        });
        expect(getByTestId('value').textContent).toBe('me@example.com');

        model.dispose();
    });

    it('accepts an explicit model prop instead of a provider', () => {
        const model = makeFormModel();

        const { getByTestId } = render(
            <Field<FormData, 'email'> name="email" model={model}>
                {({ value }) => <span data-testid="v">{value}</span>}
            </Field>
        );
        expect(getByTestId('v').textContent).toBe('');
        model.dispose();
    });

    it('throws when neither a model prop nor a provider is available', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(() =>
            render(
                <Field name={'email' as never}>
                    {() => null}
                </Field>
            )
        ).toThrow(/requires either a `model` prop or a surrounding/);
        spy.mockRestore();
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

    it('returns false for mismatched types and null vs object', () => {
        expect(shallow([1] as unknown as object, { 0: 1 })).toBe(false);
        expect(shallow(null as unknown as object, { a: 1 })).toBe(false);
        expect(shallow({ a: 1 }, null as unknown as object)).toBe(false);
    });
});
