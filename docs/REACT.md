# React Bindings

The package ships a React adapter at `model-reaction/react`. It exposes a
small set of hooks and components designed so each subscriber re-renders
only when its watched slice actually changes.

[← Back to README](../README.md)

---

## Table of Contents

- [Hooks & Components](#hooks--components)
- [Basic Example](#basic-example)
- [`useModelSelector` vs `useModelComputed`](#usemodelselector-vs-usemodelcomputed)
- [Decision Tree](#decision-tree)
- [Performance Hot-spots](#performance-hot-spots)

---

## Hooks & Components

| Export | Kind | Purpose |
| --- | --- | --- |
| `useModelField(model, field)` | hook | Subscribe to a single field. |
| `useModelSelector(model, selector, isEqual?)` | hook | Subscribe to a derived value (selector reference is **part of the subscription** — wrap it in `useCallback`). |
| `useModelComputed(model, selector, isEqual?)` | hook | Same shape as `useModelSelector`, but selector / `isEqual` are stored in refs and refreshed every render — inline arrows and per-render closure variables (`id`, `index`, …) work without `useCallback`. |
| `useModelFields(model, fields)` | hook | Subscribe to several fields at once (shallow-compared). |
| `useModelFieldState(model, field)` | hook | `[value, setValue, meta, helpers]` form-style binding with `error / dirty / touched / validating`. |
| `shallow` | function | Shallow equality helper for object/array selectors. |
| `<ModelProvider model>` | component | Provide a model via context. |
| `useModel<T>()` | hook | Read the model from the nearest provider. |
| `<Field name>` | component | Render-prop binding to a single field; consumes `<ModelProvider>` automatically. |

`react` is declared as an optional peer dependency (`>=18.0.0`); install
it in your app if you use this entry point.

## Basic Example

```tsx
import { createModel, ValidationRules } from 'model-reaction';
import {
    Field,
    ModelProvider,
    shallow,
    useModel,
    useModelField,
    useModelFields,
    useModelFieldState,
    useModelSelector,
} from 'model-reaction/react';

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
    name:   { type: 'string', default: '', validator: [ValidationRules.required] },
});

// 1. Single-field hook.
function NameInput() {
    const name = useModelField(cart, 'name');
    return <input value={name} onChange={(e) => cart.setField('name', e.target.value)} />;
}

// 2. Selector hook.
function Total() {
    const total = useModelSelector(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

// 3. Multi-field hook (shallow-compared).
function PriceLine() {
    const { qty, price } = useModelFields(cart, ['qty', 'price']);
    return <span>{qty} x {price}</span>;
}

// 4. All-in-one form binding.
function CouponInput() {
    const [coupon, setCoupon, meta, helpers] = useModelFieldState(cart, 'coupon');
    return (
        <label>
            <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                onBlur={() => helpers.setTouched()}
                disabled={meta.validating}
            />
            {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
        </label>
    );
}

// 5. Provider + render-prop Field — no prop drilling.
function CartApp() {
    return (
        <ModelProvider model={cart}>
            <Field<Cart, 'name'> name="name">
                {({ value, setValue, meta }) => (
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        aria-invalid={!!meta.error}
                    />
                )}
            </Field>
            <Total />
            <PriceLine />
            <CouponInput />
        </ModelProvider>
    );
}

// 6. Custom selectors that build fresh containers — pair with `shallow`.
function Snapshot() {
    const m = useModel<Cart>();
    const slice = useModelSelector(
        m,
        (d) => ({ qty: d.qty, price: d.price }),
        shallow
    );
    return <span>{slice.qty * slice.price}</span>;
}
```

A complete sample lives at [`examples/react-bindings.tsx`](../examples/react-bindings.tsx).

## `useModelSelector` vs `useModelComputed`

Both hooks return a derived value with custom equality, but they treat
the `selector` reference very differently:

| Aspect | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| Selector identity | Captured in the `subscribe` deps. A new reference triggers **unsubscribe + resubscribe + extra render**. | Stored in a ref refreshed every render. Reference changes are **free**. |
| Recommended pattern | Wrap the selector in `useCallback` (or hoist it to module scope). | Inline arrow functions are fine. |
| Per-render closure variables | Need to be added to `useCallback` deps (otherwise stale). | Always reflect the latest render automatically. |
| Equality check site | Inside the model subscription — model can dedupe before reaching React. | Inside `getSnapshot` — model fans out every change, hook caches/dedupes per render. |
| Selector cost | Runs once per **commit**. | Runs once per **render** (because `getSnapshot` is called on every render). |
| Best for | Stable, hot-path derived values where the selector body is fixed. | Selectors that depend on per-render variables (`id`, `index`, paging cursor, …) or short-lived components where ceremony matters more than per-render selector cost. |

```tsx
// useModelSelector — selector must be stable.
const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
const total = useModelSelector(cart, selectTotal);

// useModelComputed — inline arrow is fine, and `id` stays fresh.
function Row({ id }: { id: string }) {
    const item = useModelComputed(cart, (d) => d.items[id]);
    return <span>{item?.name}</span>;
}
```

Rule of thumb: prefer `useModelSelector` for "global" derivations, switch
to `useModelComputed` whenever the selector closes over a value that
changes between renders.

## Decision Tree

```
1. Does the selector close over a value that changes between renders
   (e.g. `id`, `index`, paging cursor, search keyword)?
   ├── Yes → useModelComputed
   │         (correctness: avoids stale closures without useCallback)
   └── No  → continue ↓

2. Is the selector body expensive
   (deep map / aggregate / serialise / per-row diff)?
   ├── Yes → useModelSelector + stable reference
   │         (selector runs once per commit, not once per render)
   └── No  → continue ↓

3. Are you on a hot update path
   (high-frequency field, large fan-out: many subscribers,
    parent re-renders unrelated to this model)?
   ├── Yes → useModelSelector + stable reference
   │         (model-level isEqual prevents the change from entering
   │          React scheduling at all)
   └── No  → continue ↓

4. Will the selector be reused across components, or do you want it
   observable by middleware / devtools?
   ├── Yes → useModelSelector
   │         (selector identity lives at the model layer and can be
   │          instrumented; useModelComputed selectors only exist
   │          inside React render and cannot be observed)
   └── No  → continue ↓

5. Are you willing to wrap the selector in useCallback?
   ├── Yes → useModelSelector
   └── No  → useModelComputed
             (convenience: ref-locked semantics, no useCallback needed)
```

## Performance Hot-spots

| Scenario | Why it matters | Pick |
| --- | --- | --- |
| 100+ list rows each subscribing to a derived value | `useModelComputed`'s selector runs **on every parent render** for every row | `useModelSelector` |
| Expensive selector body (deep map / clone / aggregate) | `getSnapshot` is invoked every render and twice under concurrent / strict mode | `useModelSelector` |
| High-frequency field (animation, mouse, debounce) feeding unrelated subscribers | Model-level `isEqual` keeps unrelated changes out of React scheduling | `useModelSelector` |
| Selector closes over `id` / `index` / per-render variables | `useModelSelector` would either go stale or resubscribe every render | `useModelComputed` |
| One-off prototype / short-lived component, light selector | The ceremony of `useCallback` outweighs the per-render `getSnapshot` cost | `useModelComputed` |
| Selector must stay observable by middleware / devtools | Identity must live at the model layer | `useModelSelector` |
| Selector with side effects or impurity (`console.log`, counters, dev-only logs) | `useSyncExternalStore` requires `getSnapshot` to be pure | `useModelSelector` |

> One-liner: `useModelSelector` is the performance ceiling
> (model-layer dedup, runs per **commit**); `useModelComputed` is the
> convenience floor (render-layer dedup, runs per **render**). They are
> **not** interchangeable — keep both.
