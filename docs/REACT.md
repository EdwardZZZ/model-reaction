# React Bindings

The package ships a React adapter at `model-reaction/react`. It exposes a
small set of hooks and components designed so each subscriber re-renders
only when its watched slice actually changes.

[← Back to README](../README.md)

---

## Table of Contents

- [Hooks & Components](#hooks--components)
- [Basic Example](#basic-example)
- [Model Lifecycle in React](#model-lifecycle-in-react)
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
| `useModelFieldState(model, field)` | hook | `[value, setValue, meta]` form-style binding with `error / dirty / validating`. |
| `shallow` | function | Shallow equality helper for object/array selectors. |
| `<ModelProvider model>` | component | Provide a model via context. |
| `useModel<T>()` | hook | Read the model from the nearest provider. |
| `<Field name>` | component | Render-prop binding to a single field; consumes `<ModelProvider>` automatically. |

`react` is declared as an optional peer dependency (`>=18.0.0`); install
it in your app if you use this entry point.

## Basic Example

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react';
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

function createCartModel() {
    return createModel<Cart>({
        qty:    { type: 'number', default: 1 },
        price:  { type: 'number', default: 100 },
        coupon: { type: 'string', default: '' },
        name:   { type: 'string', default: '', validator: [ValidationRules.required] },
    });
}

// 1. Single-field hook.
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

// 2. Selector hook — selector identity is part of the subscription, so
// stabilize it with `useCallback` (or hoist to module scope).
function Total() {
    const cart = useModel<Cart>();
    const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
    const total = useModelSelector(cart, selectTotal);
    return <span>Total: {total}</span>;
}

// 3. Multi-field hook (shallow-compared).
function PriceLine() {
    const cart = useModel<Cart>();
    const { qty, price } = useModelFields(cart, ['qty', 'price']);
    return <span>{qty} x {price}</span>;
}

// 4. All-in-one form binding. `touched` is component-local UI state.
function CouponInput() {
    const cart = useModel<Cart>();
    const [coupon, setCoupon, meta] = useModelFieldState(cart, 'coupon');
    const [touched, setTouched] = useState(false);
    return (
        <label>
            <input
                value={coupon}
                onChange={async (e) => {
                    await setCoupon(e.target.value);
                }}
                onBlur={() => setTouched(true)}
                disabled={meta.validating}
            />
            {touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
        </label>
    );
}

// 5. Provider owner — children share one model; cleanup disposes it.
function CartModelOwner({ children }: { children: ReactNode }) {
    const [cart] = useState(createCartModel);
    useEffect(() => () => cart.dispose(), [cart]);
    return <ModelProvider model={cart}>{children}</ModelProvider>;
}

// 6. Provider + render-prop Field — no prop drilling.
function CartApp() {
    return (
        <CartModelOwner>
            <Field<Cart, 'name'> name="name">
                {({ value, setValue, meta }) => (
                    <input
                        value={value}
                        onChange={async (e) => {
                            await setValue(e.target.value);
                        }}
                        aria-invalid={!!meta.error}
                    />
                )}
            </Field>
            <Total />
            <PriceLine />
            <CouponInput />
        </CartModelOwner>
    );
}

// 7. Custom selectors that build fresh containers — pair with `shallow`.
function Snapshot() {
    const m = useModel<Cart>();
    const selectSlice = useCallback((d: Cart) => ({ qty: d.qty, price: d.price }), []);
    const slice = useModelSelector(m, selectSlice, shallow);
    return <span>{slice.qty * slice.price}</span>;
}
```

A complete sample lives at [`examples/react-bindings.tsx`](../examples/react-bindings.tsx).

## Model Lifecycle in React

A `model` instance owns reactions, internal event listeners and pending
validation timers. None of those are tracked by the JavaScript GC, so a
forgotten `dispose()` keeps the model — and every value it holds in
closures — alive forever. In React, the bug usually shows up as **a
module-level model that is shared across routes / tests / browser tabs
and never gets cleaned up**.

### Bad: module-level singleton

```tsx
// model.ts
import { createModel } from 'model-reaction';
export const userModel = createModel({ /* ... */ });
// dispose() is never called — every route that imports `userModel`
// shares the same instance, leaking reactions across navigations and
// breaking test isolation.
```

Symptoms:
- Tests bleed state into each other (jest workers see stale `data`).
- Hot-reload doubles up reaction handlers.
- Multi-tab apps observe ghost updates from previously closed views.

### Fix A: Provider with owner-managed dispose

Hold the model in the component that *owns* its lifetime, dispose it
from a `useEffect` cleanup, and pass it down through context.

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { ModelProvider } from 'model-reaction/react';
import { createModel } from 'model-reaction';

function UserModelOwner({ children }: { children: ReactNode }) {
    const [model] = useState(() => createModel({ /* ... */ }));
    useEffect(() => () => model.dispose(), [model]);
    return <ModelProvider model={model}>{children}</ModelProvider>;
}

// Mount once near the top of the subtree that needs the model.
function App() {
    return (
        <UserModelOwner>
            <ProfilePage />
            <SettingsPage />
        </UserModelOwner>
    );
}
```

Why this works:
- `useState(() => createModel(...))` runs the factory **exactly once**
  per owner mount, so children that read via `useModel()` share the
  same instance.
- The `useEffect` cleanup fires on unmount (and on owner remount during
  hot-reload), guaranteeing `dispose()` runs once per lifetime.
- See [`src/__tests__/react.test.tsx`](../src/__tests__/react.test.tsx)
  → "Provider-owned model dispose lifecycle" for the unit tests that
  pin this behaviour.

### Fix B: per-route instance

When the model's data is scoped to a single route (edit form, wizard,
modal), create it inside the route component itself.

```tsx
function EditUserRoute({ userId }: { userId: string }) {
    const [model] = useState(() => createModel({ /* ... */ }));

    useEffect(() => {
        // Optional: hydrate from the server on mount.
        model.setFields(loadUser(userId));
        return () => model.dispose();
    }, [model, userId]);

    return (
        <ModelProvider model={model}>
            <EditForm />
        </ModelProvider>
    );
}
```

Each navigation to `/users/:id/edit` builds a fresh model and tears it
down on exit, so two tabs editing different users never collide.

### Pattern comparison

| Aspect | Module singleton (bad) | Fix A: Provider + owner | Fix B: per-route |
| --- | --- | --- | --- |
| Cross-route sharing | Yes (accidentally) | Yes (intentional, scoped to subtree) | No |
| `dispose()` trigger | Never | Owner unmount | Route unmount |
| Test isolation | Broken | OK (re-mount per test) | OK (re-mount per test) |
| Multi-tab safety | Leaks across tabs in dev | Each tab owns its tree | Each tab owns its tree |
| Complexity | Lowest | Low | Low |
| Best for | — (avoid) | App-wide / feature-wide state | Route- or modal-scoped state |

Rule of thumb: **whoever calls `createModel` is responsible for calling
`dispose()`**. In React, that responsibility belongs to a component
with a `useEffect` cleanup — never to a module's top-level scope.

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
