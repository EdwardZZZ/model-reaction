/**
 * React Bindings Example
 *
 * This file demonstrates how to wire `model-reaction` into a React app using
 * the `model-reaction/react` adapter. The separate react-bindings-runner.tsx
 * performs the CLI SSR smoke check (`pnpm run example:react`).
 *
 * Required peer deps in your app:
 *   npm install model-reaction react react-dom
 *
 * Highlights:
 *   - Field-level subscriptions: components re-render only when the watched
 *     field actually changes.
 *   - Selector-level subscriptions: components re-render only when the
 *     derived value changes (with structural equality support).
 *   - Either explicit `createModel<T>(schema)` or schema-inferred types.
 *   - Provider-owned model lifecycle: whoever creates a model also disposes it.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createModel, type ModelReturn } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';
import {
    Field,
    ModelProvider,
    useModel,
    useModelField,
    useModelFields,
    useModelFieldState,
    useModelSelector,
    useDraftField,
} from 'model-reaction/react';

// 1. Define the model. Use an explicit interface for the cleanest types.
interface Cart {
    qty: number;
    price: number;
    coupon: string;
    name: string;
}

export function createCartModel() {
    return createModel<Cart>({
        qty:    { type: 'number', default: 1 },
        price:  { type: 'number', default: 100 },
        coupon: { type: 'string', default: '' },
        name:   {
            type: 'string',
            default: '',
            validator: [ValidationRules.required],
        },
    });
}

// 2. Recommended controlled text input; the local draft prevents rejected
//    intermediate values from snapping back to the last committed value.
function NameInput() {
    const cart = useModel<Cart>();
    const { draft, setDraft } = useDraftField(cart, 'name');
    return (
        <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
        />
    );
}

// 3. Component that re-renders only when `qty` changes.
function QtyValue() {
    const cart = useModel<Cart>();
    const qty = useModelField(cart, 'qty');
    return <output>{qty}</output>;
}

// 4. Component that re-renders only when total = qty * price changes.
//    Mutating `coupon` or `name` will NOT cause this to re-render.
function Total() {
    const cart = useModel<Cart>();
    // Keep selector identity stable to avoid rebuilding the model subscription.
    // Use useModelComputed for inline selectors that close over current props.
    const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
    const total = useModelSelector(cart, selectTotal);
    return <span>Total: {total}</span>;
}

// 5. Component subscribed to a structural selector with custom equality.
function CouponBadge() {
    const cart = useModel<Cart>();
    const selectSummary = useCallback(
        (d: Cart) => ({ coupon: d.coupon, hasCoupon: d.coupon.length > 0 }),
        []
    );
    const isEqualSummary = useCallback(
        (a: { coupon: string; hasCoupon: boolean }, b: { coupon: string; hasCoupon: boolean }) =>
            a.coupon === b.coupon && a.hasCoupon === b.hasCoupon,
        []
    );
    const summary = useModelSelector(cart, selectSummary, isEqualSummary);
    return summary.hasCoupon ? <span>Coupon: {summary.coupon}</span> : null;
}

// 6. Validation metadata has its own event subscriptions.
function ValidationSummary() {
    const cart = useModel<Cart>();
    const [, , meta] = useModelFieldState(cart, 'name');
    return meta.error ? <span style={{ color: 'red' }}>Invalid name</span> : null;
}

// 7. Top-level app — create after commit and dispose that instance in cleanup.
function CartModelOwner({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<ModelReturn<Cart> | null>(null);
    useEffect(() => {
        const owned = createCartModel();
        setCart(owned);
        return () => owned.dispose();
    }, []);
    if (!cart) return null;
    return <ModelProvider model={cart}>{children}</ModelProvider>;
}

export function CartApp() {
    return (
        <CartModelOwner>
            <CartContents />
        </CartModelOwner>
    );
}

// 7a. Components rendered under a provider demonstrate independent updates.
export function CartContents() {
    return (
        <div>
            <NameInput />
            <QtyValue />
            <Total />
            <CouponBadge />
            <ValidationSummary />
            <Summary />
            <CouponField />
            <QtyControl />
            <NameFieldWithBlur />
        </div>
    );
}

// 7b. Provider-aware component using `useModel()`.
function Summary() {
    const m = useModel<Cart>();
    // `useModelFields` re-renders only when one of these listed fields changes.
    const { qty, price } = useModelFields(m, ['qty', 'price']);
    return <div>Snapshot: qty={qty} price={price}</div>;
}

// 7c. `<Field>` render-prop variant for a control that can bind directly to
//     committed data (consumes the provider context).
function CouponField() {
    return (
        <Field<Cart, 'coupon'> name="coupon">
            {({ value, setValue, meta }) => (
                <label>
                    <select
                        value={value}
                        onChange={(e) => void setValue(e.target.value)}
                    >
                        <option value="">No coupon</option>
                        <option value="SAVE10">SAVE10</option>
                    </select>
                    {meta.error ? (
                        <span style={{ color: 'red' }}>{meta.error}</span>
                    ) : null}
                </label>
            )}
        </Field>
    );
}

// 7d. `useModelFieldState` example for a non-text control.
//     Demonstrates `validating`, `dirty`, `error` metadata.
function QtyControl() {
    const cart = useModel<Cart>();
    const [qty, setQty, meta] = useModelFieldState(cart, 'qty');
    return (
        <input
            type="range"
            min={1}
            max={10}
            data-validating={meta.validating}
            data-dirty={meta.dirty}
            value={qty}
            onChange={(e) => void setQty(Number(e.target.value))}
        />
    );
}

// 7e. Real-world controlled text input with touched / blur / error display.
//     `useDraftField` owns the local draft and standard edit-lifecycle state:
//       - `meta.error` for the message,
//       - `meta.validating` to disable the input while the async setter is
//         in flight (prevents duplicate submissions),
//       - `meta.dirty` if you want to flag rejected writes.
function NameFieldWithBlur() {
    const cart = useModel<Cart>();
    const { draft, setDraft, meta, onBlur, showError } =
        useDraftField(cart, 'name');
    return (
        <label style={{ display: 'block' }}>
            <span>Name</span>
            <input
                value={draft}
                disabled={meta.validating}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
                aria-invalid={showError}
                style={{
                    borderColor: showError ? 'red' : undefined,
                }}
            />
            {showError ? (
                <span role="alert" style={{ color: 'red' }}>
                    {meta.error}
                </span>
            ) : null}
        </label>
    );
}

// 8. Schema-inferred types (no explicit interface).
//    `inferred.data` is typed automatically as `{ tax: number; rate: number }`.
export function createTaxModel() {
    return createModel({
        tax:  { type: 'number', default: 0 },
        rate: { type: 'number', default: 0.1 },
    });
}
