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
 */
import * as React from 'react';
// `React` is required for the JSX runtime even if not directly referenced.
void React;
import { createModel, ValidationRules } from '../src/index';
import {
    Field,
    ModelProvider,
    shallow,
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

const cart = createModel<Cart>({
    qty:    { type: 'number', default: 1 },
    price:  { type: 'number', default: 100 },
    coupon: { type: 'string', default: '' },
    name:   {
        type: 'string',
        default: '',
        validator: [ValidationRules.required],
    },
});

// 2. Component that re-renders only when `name` changes.
function NameInput() {
    const name = useModelField(cart, 'name');
    return (
        <input
            value={name}
            onChange={(e) => cart.setField('name', e.target.value)}
        />
    );
}

// 3. Component that re-renders only when `qty` changes.
function QtyInput() {
    const qty = useModelField(cart, 'qty');
    return (
        <input
            type="number"
            value={qty}
            onChange={(e) => cart.setField('qty', Number(e.target.value))}
        />
    );
}

// 4. Component that re-renders only when total = qty * price changes.
//    Mutating `coupon` or `name` will NOT cause this to re-render.
function Total() {
    const total = useModelSelector(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

// 5. Component subscribed to a structural selector with custom equality.
function CouponBadge() {
    const summary = useModelSelector(
        cart,
        (d) => ({ coupon: d.coupon, hasCoupon: d.coupon.length > 0 }),
        (a, b) => a.coupon === b.coupon && a.hasCoupon === b.hasCoupon
    );
    return summary.hasCoupon ? <span>Coupon: {summary.coupon}</span> : null;
}

// 6. Validation surfacing through a plain selector.
function ValidationSummary() {
    // Re-renders only when the validation error count for `name` changes.
    const errorCount = useModelSelector(
        cart,
        () => cart.validationErrors.name?.length ?? 0
    );
    return errorCount > 0 ? <span style={{ color: 'red' }}>Invalid name</span> : null;
}

// 7. Top-level app — demonstrates that each child re-renders independently.
//    Wrapped in `<ModelProvider>` so `<Field>` / `useModel()` work without
//    prop-drilling.
export function CartApp() {
    return (
        <ModelProvider model={cart}>
            <div>
                <NameInput />
                <QtyInput />
                <Total />
                <CouponBadge />
                <ValidationSummary />
                <Summary />
                <NameField />
            </div>
        </ModelProvider>
    );
}

// 7a. Provider-aware component using `useModel()`.
function Summary() {
    const m = useModel<Cart>();
    // `useModelFields` re-renders only when one of these listed fields changes.
    const { qty, price } = useModelFields(m, ['qty', 'price']);
    return <div>Snapshot: qty={qty} price={price}</div>;
}

// 7b. `<Field>` render-prop variant (consumes the provider context).
function NameField() {
    return (
        <Field<Cart, 'name'> name="name">
            {({ value, setValue, meta, helpers }) => (
                <label>
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onBlur={() => helpers.setTouched()}
                    />
                    {meta.touched && meta.error ? (
                        <span style={{ color: 'red' }}>{meta.error}</span>
                    ) : null}
                </label>
            )}
        </Field>
    );
}

// 7c. `useModelFieldState` example: form-style binding in a single hook.
//     Demonstrates `validating`, `dirty`, `touched`, `error` metadata.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CouponInput() {
    const [coupon, setCoupon, meta] = useModelFieldState(cart, 'coupon');
    return (
        <input
            data-validating={meta.validating}
            data-dirty={meta.dirty}
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
        />
    );
}

// 7d. `shallow` is exported for selectors that build fresh containers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ShallowSelectorDemo() {
    const m = useModel<Cart>();
    const slice = useModelSelector(
        m,
        (d) => ({ qty: d.qty, price: d.price }),
        shallow
    );
    return <span>Slice: {slice.qty * slice.price}</span>;
}

// 8. Schema-inferred types (no explicit interface).
//    `inferred.data` is typed automatically as `{ tax: number; rate: number }`.
interface Tax { tax: number; rate: number }
const inferred = createModel<Tax>({
    tax:  { type: 'number', default: 0 },
    rate: { type: 'number', default: 0.1 },
});
inferred.subscribe(
    (d) => d.tax * d.rate,
    (v) => {
        // eslint-disable-next-line no-console
        console.log('[inferred] tax * rate →', v);
    }
);

// 9. Usage outside React: same model, same subscriptions.
cart.subscribeField('name', (v) => {
    // eslint-disable-next-line no-console
    console.log('[non-React subscriber] name changed →', v);
});
cart.subscribe(
    (d) => d.qty * d.price,
    (total, prev) => {
        // eslint-disable-next-line no-console
        console.log(`[non-React subscriber] total: ${prev} → ${total}`);
    }
);

// -----------------------------------------------------------------------------
// 10. CLI runner — renders the components via `react-dom/server` so this file
//     can be executed with `npm run example:react`. In a real React app you
//     would mount with `react-dom/client`'s `createRoot` instead.
// -----------------------------------------------------------------------------
import { renderToString } from 'react-dom/server';

async function runExample(): Promise<void> {
    console.log('=== React Bindings Example ===');

    console.log('\n[render #1] initial state:');
    console.log(renderToString(<CartApp />));

    console.log('\n→ setField("name", "Zephyr")');
    await cart.setField('name', 'Zephyr');

    console.log('\n→ setField("qty", 3)   // total: 100 → 300');
    await cart.setField('qty', 3);

    console.log('\n→ setField("coupon", "SAVE10")  // does NOT change total');
    await cart.setField('coupon', 'SAVE10');

    console.log('\n[render #2] after mutations:');
    console.log(renderToString(<CartApp />));

    console.log('\n→ inferred.setField("tax", 200)  // tax * rate → 20');
    await inferred.setField('tax', 200);

    cart.dispose();
    inferred.dispose();
}

runExample().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
