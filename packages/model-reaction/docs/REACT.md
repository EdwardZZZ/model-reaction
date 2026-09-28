# React Bindings

The package ships a React adapter at `model-reaction/react`. It exposes a
small set of hooks and components designed so each subscriber re-renders
only when its watched slice actually changes.

[← Back to README](../README.md)

---

## Table of Contents

- [Hooks & Components](#hooks--components)
- [Basic Example](#basic-example)
- [Controlled Inputs Under Strict / Async Validation](#controlled-inputs-under-strict--async-validation)
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
| `useModelComputed(model, selector, isEqual?)` | hook | Same shape as `useModelSelector`, but the subscription does not depend on selector identity. The current render's selector can close over `id`, `index`, and other props without `useCallback`. |
| `useModelFields(model, fields)` | hook | Subscribe to several fields at once (shallow-compared). |
| `useModelFieldState(model, field)` | hook | `[value, setValue, meta]` form-style binding with `error / dirty / validating`. |
| `useDraftField(model, field, options?)` | hook | **Optional** controlled-input binding: local draft + `touched`/error gating on top of `useModelFieldState`. For strict/async validators. |
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

// 5. Provider owner — create after commit; cleanup disposes the same instance.
function CartModelOwner({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<ReturnType<typeof createCartModel> | null>(null);
    useEffect(() => {
        const owned = createCartModel();
        setCart(owned);
        return () => owned.dispose();
    }, []);
    if (!cart) return null;
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

## Controlled Inputs Under Strict / Async Validation

The examples above bind an input's `value` straight to the committed field
(`value={name}` + `onChange={setField}`). That works when the validator is
loose and synchronous — e.g. `required` accepts every non-empty keystroke, so
each edit commits immediately and reads back cleanly.

It stops working the moment validation can **reject** an intermediate keystroke
or resolve **asynchronously**, because of the library's verify-then-commit
contract (see [AGENTS.md §1](../AGENTS.md)):

- **Rejected intermediates snap back.** Under `minLength(3)` or `email`, typing
  `"a"` fails validation, so it lands in `dirtyData` and never reaches `data`.
  An input reading committed data would blank out on every transient-invalid
  keystroke — the field feels impossible to type in.
- **Async commits lag, and superseded ones vanish.** An async validator only
  commits *after* its round-trip resolves, so the input would sit blank during
  the in-flight window. Worse, a keystroke whose validation is superseded by a
  newer one is dropped (the race guard returns early) and never even reaches
  `dirtyData`.

The fix is a **local draft**: hold "the text being edited" in component state so
it updates on every keystroke, fire `setField` to validate/commit in the
background, and surface errors separately via `meta`. This is the same rationale
the library gives for leaving `touched` out of the model — "text being edited"
is UI lifecycle state, not model truth (see [AGENTS.md §5](../AGENTS.md)).

The adapter ships this pattern as an **optional** hook, `useDraftField`, built
on top of `useModelFieldState`. Import it only if you want it — the core binding
(`useModelFieldState`, `[value, setValue, meta]`) does not depend on it:

```tsx
import { useDraftField } from 'model-reaction/react';
import type { ModelReturn } from 'model-reaction';

function UsernameInput({ model }: { model: ModelReturn<{ username: string }> }) {
    const { draft, setDraft, onBlur, showError, meta } = useDraftField(model, 'username');
    return (
        <label>
            <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
                aria-invalid={showError}
            />
            {meta.validating && <span>validating…</span>}
            {showError && <span role="alert">{meta.error}</span>}
        </label>
    );
}
```

`useDraftField(model, field, options?)` returns `{ draft, setDraft, meta,
touched, onBlur, showError, committed }`:

- `draft` / `setDraft` — the local editing text and its updater; wire them to
  the input's `value` / `onChange`.
- `touched` / `onBlur` / `showError` — the blur-gated error display, so you
  don't re-implement it per input.
- `meta` / `committed` — the underlying `useModelFieldState` metadata and the
  last committed value.
- `options.format` — how a committed/pending value renders as text on reseed
  (defaults to `String`); see the field-type contract below.

> It bakes in UI policy `useModelFieldState` deliberately leaves open — when
> `touched` flips, seeding, the value→text direction — so it's a **separate,
> opt-in** export rather than folded into `meta`. Reach for the plain
> `useModelFieldState` when you want to make those calls yourself. A runnable
> integration lives in the demo app (`packages/demo/src/TextField.tsx`).

### Field-type contract

The draft models "the text in a controlled `<input>`", so it is always a
`string`. That constrains which fields the hook fits:

- **string fields** — the natural case; no extra work.
- **number (or other non-string) fields** — must declare a schema `transform`
  (e.g. `transform: Number`) so the string draft is coerced back to the real
  type on commit. Without one, the string is written straight into `data` as a
  silent type lie.
- **boolean / enum / date fields** bound to checkboxes, selects or pickers —
  **not** a fit; their control `value` isn't a string. Use a plain
  `useModelFieldState` binding instead.

Two edge cases on the value→text (reseed) direction, which `useDraftField`
handles internally (nullish/non-finite collapse) plus the optional `format`:

- **Unparseable numbers.** A number field that stashed `"12a"` holds `NaN`;
  rendering `String(NaN)` would surface the literal text `"NaN"`. Collapse
  non-finite numbers (and nullish) to `''` so the input shows blank.
- **Lost display format.** The model stores only the committed value, so a
  field that commits cents as an integer loses `"3.50"` on reseed. Pass a
  `format` (e.g. `(cents) => (cents / 100).toFixed(2)`) to restore it; the
  parse direction stays with the schema `transform`.

## Model Lifecycle in React

A `model` instance owns reaction timers, subscriptions, and pending validation
work. `dispose()` cancels or releases those resources deterministically. In
React, the common ownership bug is a **module-level model shared across routes
or tests with no matching cleanup**.

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
- Multiple mounted editors unexpectedly share state.
- Pending debounced work outlives the view that scheduled it.

### Fix A: Provider with owner-managed dispose

Create the model in an effect owned by the component, dispose that same
instance in the cleanup, and pass it down through context. This also handles
StrictMode's extra development setup/cleanup cycle: each setup gets a fresh
model, and its matching cleanup disposes it.
This owner pattern is for client-rendered UI; for SSR, use a request-scoped
model as described in [SSR and concurrent rendering](#79-ssr-and-concurrent-rendering),
because effects do not run during server rendering.

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { ModelProvider } from 'model-reaction/react';
import { createModel, type ModelReturn } from 'model-reaction';

interface User {
    name: string;
}

function UserModelOwner({ children }: { children: ReactNode }) {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    useEffect(() => {
        const owned = createModel<User>({ /* ... */ });
        setModel(owned);
        return () => owned.dispose();
    }, []);
    if (!model) return null;
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
- Model creation happens after React commits the owner, so a render React
  abandons cannot leak a model.
- Each effect setup creates one model and its cleanup disposes that same
  instance. Children mount only after the model is ready.
- See [`src/__tests__/react.test.tsx`](../src/__tests__/react.test.tsx)
  → "Provider-owned model dispose lifecycle" for the unit tests that
  pin this behaviour.

### Fix B: per-route instance

When the model's data is scoped to a single route (edit form, wizard,
modal), create it inside the route component itself.

```tsx
function EditUserRoute({ userId }: { userId: string }) {
    // A new route identity gets a new owner and model lifetime.
    return <UserModelOwner key={userId}><EditForm userId={userId} /></UserModelOwner>;
}
```

Keying the owner by `userId` gives each route identity a fresh model
lifecycle and disposes the previous one on exit. Load route data from the
form after the provider mounts. Two tabs editing different users therefore
own different models.

### Pattern comparison

| Aspect | Module singleton (bad) | Fix A: Provider + owner | Fix B: per-route |
| --- | --- | --- | --- |
| Cross-route sharing | Yes (accidentally) | Yes (intentional, scoped to subtree) | No |
| `dispose()` trigger | Never | Owner unmount | Route unmount |
| Test isolation | Broken | OK (re-mount per test) | OK (re-mount per test) |
| Concurrent editors | Share one instance | Share only within the owner subtree | Own separate instances |
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
| Selector returning a **new reference each call** (default `Object.is`) | Safe — the snapshot only updates on model events, so `getSnapshot` returns a stable reference between commits. | ⚠️ **Infinite re-render.** `getSnapshot` recomputes a fresh reference every render and `Object.is` never matches → React aborts with *"Maximum update depth exceeded"*. You **must** pass a structural `isEqual` (e.g. the exported `shallow`). |
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

> ⚠️ **`useModelComputed` needs a stable snapshot.** If its selector returns a
> fresh object/array on every call (`(d) => d.items.map(...)`, `(d) => ({...})`),
> you **must** supply an `isEqual` — the exported `shallow` helper is the
> usual choice. Without it, each render produces a new reference, the per-render
> cache never hits, and React tears the component down with *"Maximum update
> depth exceeded"*. Selectors returning a primitive or an already-stable
> reference are unaffected. `useModelSelector` does **not** have this pitfall,
> because its snapshot only changes when the model emits a `field:change`.

<details>
<summary><strong>Why isn't <code>isEqual</code> defaulted to <code>shallow</code>?</strong></summary>

Making `shallow` the default would only paper over part of the trap and is
deliberately avoided:

- **It fixes only flat selectors.** `shallow` compares one level deep, so
  `(d) => ({ rows: d.items.map(...) })` still returns a fresh nested `rows`
  reference each render and would keep looping. A default `shallow` turns a
  reliable crash into an intermittent one — harder to diagnose than the
  explicit requirement.
- **It breaks symmetry.** `useModelSelector`, `useModelComputed`,
  `model.subscribe`, and `subscribeField` all default to `Object.is`. Changing
  one hook's default makes "same signature, different default" — less
  predictable, not more.
- **It diverges from the ecosystem.** react-redux `useSelector` and zustand
  selectors default to reference equality; shallow comparison is always
  opt-in (e.g. zustand's `useShallow`).

The chosen trade-off is to keep `Object.is` and make the failure **visible**
(this warning + the hook's JSDoc) rather than hide it behind a partial default.
</details>

Rule of thumb: prefer `useModelSelector` for "global" derivations, switch
to `useModelComputed` whenever the selector closes over a value that
changes between renders.

## Decision Tree

```
1. Does the selector close over a value that changes between renders
   (e.g. `id`, `index`, paging cursor, search keyword)?
   ├── Yes → useModelComputed
   │         (correctness: avoids stale closures without useCallback)
   │         ⚠ if it also returns a fresh object/array, pass `isEqual`
   │            (e.g. `shallow`) or it will loop on "Maximum update depth"
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

4. Will the selector be reused across components?
   ├── Yes → useModelSelector
   │         (hoist a stable selector and share it)
   └── No  → continue ↓

5. Are you willing to wrap the selector in useCallback?
   ├── Yes → useModelSelector
   └── No  → useModelComputed
             (convenience: stable subscription, no useCallback needed)
```

## Performance Hot-spots

| Scenario | Why it matters | Pick |
| --- | --- | --- |
| 100+ list rows each subscribing to a derived value | `useModelComputed`'s selector runs **on every parent render** for every row | `useModelSelector` |
| Expensive selector body (deep map / clone / aggregate) | `getSnapshot` is invoked every render and twice under concurrent / strict mode | `useModelSelector` |
| High-frequency field (animation, mouse, debounce) feeding unrelated subscribers | Model-level `isEqual` keeps unrelated changes out of React scheduling | `useModelSelector` |
| Selector closes over `id` / `index` / per-render variables | `useModelSelector` would either go stale or resubscribe every render | `useModelComputed` |
| One-off prototype / short-lived component, light selector | The ceremony of `useCallback` outweighs the per-render `getSnapshot` cost | `useModelComputed` |
| Selector reused across components | A hoisted selector avoids repeated closures and keeps one definition | `useModelSelector` |

> One-liner: `useModelSelector` is the performance ceiling
> (model-layer dedup, runs per **commit**); `useModelComputed` is the
> convenience floor (render-layer dedup, runs per **render**). They are
> **not** interchangeable. Selectors passed to either hook must remain pure.
