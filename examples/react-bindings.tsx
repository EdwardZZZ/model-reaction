/**
 * React Bindings Example
 *
 * This file demonstrates how to wire `model-reaction` into a React app using
 * the `model-reaction/react` adapter. It is a standalone .tsx snippet — not
 * runnable from the CLI, but copy-paste-ready into any React 18+ project.
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
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
// `React` is required for the JSX runtime even if not directly referenced.
void React;
import { createModel, ValidationRules } from '../src/index';
import {
    Field,
    ModelProvider,
    useModel,
    useModelField,
    useModelFields,
    useModelFieldState,
    useModelSelector,
} from '../src/react';

// 1. Define the model. Use an explicit interface for the cleanest types.
interface Cart {
    qty: number;
    price: number;
    coupon: string;
    name: string;
}

function createCartModel() {
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

// 2. Component that re-renders only when `name` changes.
function NameInput() {
    const cart = useModel<Cart>();
    const name = useModelField(cart, 'name');
    return (
        <input
            value={name}
            onChange={async (e) => {
                await cart.setField('name', e.target.value);
            }}
        />
    );
}

// 3. Component that re-renders only when `qty` changes.
function QtyInput() {
    const cart = useModel<Cart>();
    const qty = useModelField(cart, 'qty');
    return (
        <input
            type="number"
            value={qty}
            onChange={async (e) => {
                await cart.setField('qty', Number(e.target.value));
            }}
        />
    );
}

// 4. Component that re-renders only when total = qty * price changes.
//    Mutating `coupon` or `name` will NOT cause this to re-render.
function Total() {
    const cart = useModel<Cart>();
    // `useModelSelector` captures the selector at subscribe time, so wrap
    // inline arrows in `useCallback` to avoid resubscribing every render.
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

// 6. Validation surfacing through a plain selector.
function ValidationSummary() {
    const cart = useModel<Cart>();
    // Re-renders only when the validation error count for `name` changes.
    const selectErrorCount = useCallback(
        () => cart.validationErrors.name?.length ?? 0,
        [cart]
    );
    const errorCount = useModelSelector(cart, selectErrorCount);
    return errorCount > 0 ? <span style={{ color: 'red' }}>Invalid name</span> : null;
}

// 7. Top-level app — the owner creates exactly one model per mount and
//    disposes it from cleanup. Use this pattern for app-wide / feature-wide
//    React state instead of exporting a module-level singleton.
function CartModelOwner({ children }: { children: React.ReactNode }) {
    const [cart] = useState(createCartModel);
    useEffect(() => () => cart.dispose(), [cart]);
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
function CartContents() {
    return (
        <div>
            <NameInput />
            <QtyInput />
            <Total />
            <CouponBadge />
            <ValidationSummary />
            <Summary />
            <NameField />
            <CouponInput />
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

// 7c. `<Field>` render-prop variant (consumes the provider context).
//     `touched` is a pure UI concern — keep it as local component state.
function NameField() {
    const [touched, setTouched] = useState(false);
    return (
        <Field<Cart, 'name'> name="name">
            {({ value, setValue, meta }) => (
                <label>
                    <input
                        value={value}
                        onChange={async (e) => {
                            await setValue(e.target.value);
                        }}
                        onBlur={() => setTouched(true)}
                    />
                    {touched && meta.error ? (
                        <span style={{ color: 'red' }}>{meta.error}</span>
                    ) : null}
                </label>
            )}
        </Field>
    );
}

// 7d. `useModelFieldState` example: form-style binding in a single hook.
//     Demonstrates `validating`, `dirty`, `error` metadata.
function CouponInput() {
    const cart = useModel<Cart>();
    const [coupon, setCoupon, meta] = useModelFieldState(cart, 'coupon');
    return (
        <input
            data-validating={meta.validating}
            data-dirty={meta.dirty}
            value={coupon}
            onChange={async (e) => {
                await setCoupon(e.target.value);
            }}
        />
    );
}

// 7e. Real-world controlled input with touched / blur / error display.
//     `touched` is intentionally NOT in `meta` — it is component-local UI
//     state, owned here via `useState`. The hook gives us:
//       - `meta.error` for the message,
//       - `meta.validating` to disable the input while the async setter is
//         in flight (prevents duplicate submissions),
//       - `meta.dirty` if you want to flag rejected writes.
function NameFieldWithBlur() {
    const cart = useModel<Cart>();
    const [name, setName, meta] = useModelFieldState(cart, 'name');
    const [touched, setTouched] = useState(false);
    const showError = touched && meta.error;
    return (
        <label style={{ display: 'block' }}>
            <span>Name</span>
            <input
                value={name}
                disabled={meta.validating}
                onChange={async (e) => {
                    await setName(e.target.value);
                }}
                onBlur={() => setTouched(true)}
                aria-invalid={showError ? 'true' : 'false'}
                style={{
                    borderColor: showError ? 'red' : undefined,
                }}
            />
            {showError ? (
                <span role="alert" style={{ color: 'red' }}>
                    {meta.error}
                </span>
            ) : null}
            <button type="button" onClick={() => setTouched(false)}>
                Reset
            </button>
        </label>
    );
}

// 8. Schema-inferred types (no explicit interface).
//    `inferred.data` is typed automatically as `{ tax: number; rate: number }`.
interface Tax { tax: number; rate: number }
function createTaxModel() {
    return createModel<Tax>({
        tax:  { type: 'number', default: 0 },
        rate: { type: 'number', default: 0.1 },
    });
}

// -----------------------------------------------------------------------------
// 10. CLI runner — renders the components via `react-dom/server` so this file
//     can be executed with `npm run example:react`. In a real React app you
//     would mount with `react-dom/client`'s `createRoot` instead.
// -----------------------------------------------------------------------------
import { renderToString } from 'react-dom/server';

async function runExample(): Promise<void> {
    const cart = createCartModel();
    const inferred = createTaxModel();

    /* eslint-disable no-console */
    inferred.subscribe(
        (d) => d.tax * d.rate,
        (v) => {
            console.log('[inferred] tax * rate →', v);
        }
    );
    cart.subscribeField('name', (v) => {
        console.log('[non-React subscriber] name changed →', v);
    });
    cart.subscribe(
        (d) => d.qty * d.price,
        (total, prev) => {
            console.log(`[non-React subscriber] total: ${prev} → ${total}`);
        }
    );

    console.log('=== React Bindings Example ===');

    console.log('\n[render #1] initial state:');
    console.log(renderToString(<ModelProvider model={cart}><CartContents /></ModelProvider>));

    console.log('\n→ setField("name", "Zephyr")');
    await cart.setField('name', 'Zephyr');

    console.log('\n→ setField("qty", 3)   // total: 100 → 300');
    await cart.setField('qty', 3);

    console.log('\n→ setField("coupon", "SAVE10")  // does NOT change total');
    await cart.setField('coupon', 'SAVE10');

    console.log('\n[render #2] after mutations:');
    console.log(renderToString(<ModelProvider model={cart}><CartContents /></ModelProvider>));

    console.log('\n→ inferred.setField("tax", 200)  // tax * rate → 20');
    await inferred.setField('tax', 200);

    cart.dispose();
    inferred.dispose();
}

runExample().catch((err) => {
    console.error(err);
    process.exit(1);
});
/* eslint-enable no-console */
