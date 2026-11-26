# React Bindings

The package ships a React adapter at `model-reaction/react`. It exposes a
small set of hooks and components designed so each subscriber re-renders
only when its watched slice actually changes.
This page is the canonical React contract; README and examples link here.

[中文版本](REACT_CN.md) | English

[← Back to README](../README.md)

---

## Table of Contents

- [Hooks & Components](#hooks--components)
- [Basic Example](#basic-example)
- [Field UI state](#field-ui-state)
- [Controlled Inputs Under Strict / Async Validation](#controlled-inputs-under-strict--async-validation)
- [Model Lifecycle in React](#model-lifecycle-in-react)
- [`useModelSelector` vs `useModelComputed`](#usemodelselector-vs-usemodelcomputed)
- [Side effects from derived values](#side-effects-from-derived-values)
- [DevTools derived values](#devtools-derived-values)
- [Submission Flow](#submission-flow)
- [SSR and Concurrent Rendering](#ssr-and-concurrent-rendering)

---

## Hooks & Components

| Export | Kind | Purpose |
| --- | --- | --- |
| `useModelField(model, field)` | hook | Subscribe to a single field. |
| `useModelSelector(model, selector, isEqual?)` | hook | Subscribe to a derived value (selector reference is **part of the subscription** — wrap it in `useCallback`). |
| `useModelComputed(model, selector, isEqual?)` | hook | Same shape as `useModelSelector`, but the subscription does not depend on selector identity. The current render's selector can close over `id`, `index`, and other props without `useCallback`. |
| `useModelFields(model, fields)` | hook | Subscribe to several fields at once (shallow-compared). |
| `useDraftField(model, field, options?)` | hook | **Recommended text-input binding** with a local draft, `touched`, error gating, and model validation. |
| `useModelFieldState(model, field)` | hook | Lower-level committed-value binding with `[value, setValue, meta]`; use for non-text controls or custom policies. |
| `shallow` | function | Shallow equality helper for object/array selectors. |
| `<ModelProvider model>` | component | Provide a model via context. |
| `useModel<T>()` | hook | Read the model from the nearest provider. |
| `<Field name>` | component | Render-prop binding to a single field; consumes `<ModelProvider>` automatically. |

`react` is declared as an optional peer dependency (`>=18.0.0`); install
it in your app if you use this entry point.

## Basic Example

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createModel } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';
import {
    Field,
    ModelProvider,
    shallow,
    useModel,
    useModelField,
    useModelFields,
    useModelSelector,
    useDraftField,
} from 'model-reaction/react';

interface Cart {
    qty: number;
    price: number;
    coupon: string;
    name: string;
    items: Record<string, { name: string }>;
}

function createCartModel() {
    return createModel<Cart>({
        qty:    { type: 'number', default: 1 },
        price:  { type: 'number', default: 100 },
        coupon: { type: 'string', default: '' },
        name:   { type: 'string', default: '', validator: [ValidationRules.required] },
        items:  { type: 'object', default: {} },
    });
}

// 1. Single-field display hook.
function NameValue() {
    const cart = useModel<Cart>();
    const name = useModelField(cart, 'name');
    return <span>{name}</span>;
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

// 4. Recommended text-input binding.
function CouponInput() {
    const cart = useModel<Cart>();
    const { draft, setDraft, meta, writeError, onBlur, showError } =
        useDraftField(cart, 'coupon');
    return (
        <label>
            <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
                aria-busy={meta.validating}
            />
            {showError && <span style={{ color: 'red' }}>{writeError?.message ?? meta.errors[0]?.message}</span>}
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
            <Field<Cart, 'coupon'> name="coupon">
                {({ value, setValue, meta }) => (
                    <select
                        value={value}
                        onChange={(e) => void setValue(e.target.value)}
                        aria-invalid={meta.errors.length > 0}
                    >
                        <option value="">No coupon</option>
                        <option value="SAVE10">SAVE10</option>
                    </select>
                )}
            </Field>
            <NameValue />
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

## Field UI state

`useModelFieldState`, `useDraftField`, and `<Field>` expose the same `FieldMeta`:
`errors`, `validating`, and `dirty`. Read the first error message with
`meta.errors[0]?.message`.

Keep business properties such as `show`, `disabled`, and `placeholder` in a
separate `ui` object in the component or field module. Derive them from
committed data with `useModelComputed`, and use React state for manual
overrides:

```tsx
import { useState } from 'react';
import { shallow, useModelComputed, useModelFieldState } from 'model-reaction/react';

// Inside the field component:
const [value, setValue, meta] = useModelFieldState(model, 'address');
const [disabledOverride, setDisabledOverride] = useState<boolean>();
const ui = useModelComputed(model, (data) => ({
    show: data.deliveryRequired,
    disabled: disabledOverride ?? data.readonly,
    placeholder: 'Delivery address',
}), shallow);
```

Call `setDisabledOverride(true)` in an event handler, or pass the setter to a
business function as in [the delivery example](../examples/react-field-ui.tsx).
UI state follows its owner: lift it to a common parent when several fields
share it, or change the owner's React `key` if switching model or field should
reset it. These properties are UI state; they do not change model writes,
validation, or reactions.

If you used `options.meta`, the `<Field meta>` prop, or `setMeta`, move the
selector and overrides into the field component as shown above, and read
`ui.disabled` in place of `meta.disabled`. Use the first three tuple items with
`useModelFieldState` and remove extension-specific type arguments.

`validating` tracks this binding's outstanding `setValue` calls. Overlapping
calls keep it true until all finish; writes through the model or another
binding are not counted.
Switching model or field starts a new validation session, including A→B→A
switches, so old calls cannot change the new session's count.

## Controlled Inputs Under Strict / Async Validation

Binding an input's `value` straight to a committed field
(`value={name}` + `onChange={setField}`) works only when validation cannot
reject an intermediate edit and never resolves asynchronously.

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

The adapter ships this pattern as `useDraftField`, the **default recommendation
for controlled text inputs**. It is built on top of `useModelFieldState`, so the
core model still contains only committed and rejected domain values:

```tsx
import { useDraftField } from 'model-reaction/react';
import type { ModelReturn } from 'model-reaction';

function UsernameInput({ model }: { model: ModelReturn<{ username: string }> }) {
    const { draft, setDraft, onBlur, showError, meta, writeError } = useDraftField(model, 'username');
    return (
        <label>
            <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
                aria-invalid={showError}
            />
            {meta.validating && <span>validating…</span>}
            {showError && <span role="alert">{writeError?.message ?? meta.errors[0]?.message}</span>}
        </label>
    );
}
```

`useDraftField(model, field, options?)` returns `{ draft, setDraft, meta, writeError,
touched, onBlur, showError, committed }`:

- `draft` / `setDraft` — the local editing text and its updater; wire them to
  the input's `value` / `onChange`.
- `touched` / `onBlur` / `showError` — the blur-gated error display, so you
  don't re-implement it per input.
- `meta` / `committed` — the underlying `useModelFieldState` metadata and the
  last committed value.
- `writeError: Error | null` — the latest edit's setter or cleanup exception.
  It is local to this editing session, separate from model validation errors.
- `options.format` — how a committed/pending value renders as text on reseed
  (defaults to `String`); see the field-type contract below.

With `useModelFieldState`, keep custom `touched` state in the component and
reset it after successful submission when reusing a form. Validation metadata
requires this hook's event subscriptions; a selector of `model.data` does not
refresh errors when a write fails without changing committed data.

An edit's own successful commit preserves its original text, including `"2."`,
`"002"`, and `"3.50"` after a numeric transform. Outside commits use `format`
when updating the draft. If local validations are still in flight, outside
updates are reconciled when those calls finish. Older calls cannot overwrite a
newer edit or a new model/field session.

Field bindings support numeric schema keys such as `useDraftField(model, 0)`;
event filtering uses their string representation. Reentrant edits from a
`field:change` listener preserve their own text too. `setDraft` updates local
text and starts the model write immediately; its completion listener registers
in a microtask after the current dispatch, before the new write resumes from
validation. This avoids claiming the previous write's completion and keeps
`validating` and immediate `model.settled()` calls tied to the started write.

`setDraft` returns `void` and handles setter rejections and errors in their
cleanup chain. Failed text remains visible; only the latest edit in the active
session may publish `writeError`. New edits and model/field switches clear it.
Thrown `Error` instances are preserved; other thrown values become an `Error`
with a corresponding message. These exceptions do not become model errors or
dirty data. Ordinary validation failures are available through `meta.errors`.

`showError` means `touched && (writeError || meta.errors.length > 0)`. Prefer
`writeError?.message ?? meta.errors[0]?.message` when displaying it. Consumers manually
constructing `DraftField` must add the new required `writeError` member.

`FieldMeta.error` has been removed. Migrate message reads to
`meta.errors[0]?.message` and error-presence checks to `meta.errors.length > 0`.

Only committed renders publish `format` to asynchronous callbacks, so abandoned
Suspense renders cannot change the active input's formatter. A format-only
change preserves current text; later outside commits use the latest committed
format. The hook is SSR-compatible. IME composition handling remains a separate
concern; this hook does not currently coordinate composition events.

> Use the lower-level `useModelFieldState` when you need committed-value
> semantics or are binding a non-text control. A runnable integration lives in
> the demo app (`packages/demo/src/TextField.tsx`).

### Field-type contract

The draft models "the text in a controlled `<input>`", so it is always a
`string`. That constrains which fields the hook fits:

- **string fields** — the natural case; no extra work.
- **number (or other non-string) fields** — must declare a schema `transform`
  (e.g. `transform: Number`) so the string draft is coerced back to the real
  type on commit. Without one, the string is written straight into `data` as a
  silent type lie.
- **Checkboxes, selects, and date pickers** — prefer `useModelFieldState` when
  the control chooses a committed value without intermediate editing text.
  HTML select values are strings, and a text-based picker may use a draft with
  an appropriate transform; choose by the control's editing behavior.

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
model as described in [SSR and concurrent rendering](#ssr-and-concurrent-rendering),
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
- See [`react-provider.test.tsx`](../src/__tests__/react-provider.test.tsx)
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
`dispose()`**. Component-owned models use matching effect cleanup. An intentionally
app-wide singleton can instead have an application owner that disposes it on
shutdown and hot replacement; keep it separate from route-scoped editors and SSR requests.

## `useModelSelector` vs `useModelComputed`

Deriving something from `model.data`? Pick by how the selector is written:

```
Reading model.data
│
├─ One field only ............ useModelField(model, 'field')
├─ A fixed set of fields ...... useModelFields(model, ['a', 'b'])
│
└─ A computed / derived value
   │
   └─ Does the selector close over values that change between
      renders (props or state such as id, index, query)?
      │
      ├─ YES → useModelComputed(model, (d) => d.items[id])
      │        Subscribes by model identity only, so the inline
      │        selector always sees the current render's props —
      │        no useCallback needed.
      │
      └─ NO  → useModelSelector(model, selectStable)
               Hoist the selector or wrap it in useCallback; the
               selector becomes part of the subscription, so the
               model filters changes before notifying React
               (better for reusable selectors / high-frequency
               updates).

Selector returns a fresh object or array?
→ pass `shallow` (or a custom isEqual) as the third argument,
  in either branch, so equivalent results keep their reference.
```

Both hooks select from committed `model.data`, default to `Object.is`, and
cache snapshots. Their subscriptions handle selector identity differently:

| Aspect | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| Subscription dependencies | Model, selector, and equality function; changing any of them resubscribes. | Model only; changing the selector does not resubscribe. |
| Recommended selector | Hoisted function or `useCallback` with complete dependencies. | Inline function, including closures over props such as `id` or `index`. |
| Change filtering | Model subscription filters by equality; the snapshot getter also retains equivalent results. | Every field change notifies the hook; the snapshot getter filters by equality. |
| Typical use | Reusable selectors or frequent updates where model-side filtering helps. | Selectors that depend on render values without managing `useCallback` dependencies. |

```tsx
// Keep the selector stable to avoid resubscribing.
const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
const total = useModelSelector(cart, selectTotal);

// The current render supplies `id`; no useCallback is needed.
function Row({ id }: { id: string }) {
    const item = useModelComputed(cart, (d) => d.items[id]);
    return <span>{item?.name}</span>;
}
```

Returning a new object or array does not itself cause an infinite render loop:
both hooks cache the result for the same data snapshot and selector. Use
`shallow` or a suitable custom equality function when equivalent results should
keep the same reference after the model or selector changes:

```tsx
const summary = useModelComputed(
    cart,
    (d) => ({ total: d.qty * d.price, count: Object.keys(d.items).length }),
    shallow,
);
```

`shallow` compares one level; nested objects are compared by reference.
Equality is opt-in and does not avoid computing the next result. Neither hook
guarantees exactly one selector call per commit or render: subscriptions and
snapshot reads can both evaluate it. Keep selectors pure, and measure expensive
derivations before adding memoization.

## Side effects from derived values

`useModelSelector` and `useModelComputed` return component values; they do not
create schema fields or accept `reaction.action`. Keep their selectors pure.
For a component-owned side effect, observe the returned value in `useEffect`:

```tsx
import { useEffect } from 'react';
import type { ModelReturn } from 'model-reaction';
import { useModelComputed } from 'model-reaction/react';

function PreviewReporter({ model, uppercase, onPreviewChange }: {
    model: ModelReturn<{ greeting: string }>;
    uppercase: boolean;
    onPreviewChange: (value: string) => void;
}) {
    const preview = useModelComputed(
        model,
        (data) => uppercase ? data.greeting.toUpperCase() : data.greeting
    );
    useEffect(() => {
        onPreviewChange(preview);
    }, [preview, onPreviewChange]);
    return <output>{preview}</output>;
}
```

The effect runs after the initial commit and when either dependency changes.
Keep the callback stable with a module-level function or `useCallback` when
only value changes should rerun it. StrictMode can repeat mount effects in
development; make effects repeatable and clean up subscriptions or requests.
Effect callbacks and their async work are not model actions, are not covered
by `model.settled()`, and do not appear as action nodes in DevTools.

For model-owned business work, define the derived value and its changing inputs
as schema fields and configure `reaction.action`. That queue runs after successful
computed-value validation/commit and calculation settlement; initialization and
equal computed results can also queue actions. See the [action contract](API.md#action-queue).

## DevTools derived values

When a model is created through `model-reaction/devtools` with the extension hook
already installed, these two Hooks appear as terminal nodes in **Dependencies**,
with committed values listed below the graph. Dependencies are collected automatically
from top-level reads during normal selector evaluation; no debug argument is needed:

```tsx
const selectTotal = (data: Readonly<Cart>) => data.qty * data.price;
const total = useModelSelector(cart, selectTotal);
const item = useModelComputed(cart, (data) => data.items[id]);
```

Here the arrows are `qty/price → selectTotal` and `items → (data) => data.items[id]`.
The display name comes from `selector.name`, then the anonymous selector's source
via `Function.prototype.toString.call(selector)`, then Hook kind and number if source
is unavailable (for example, native code). Graph labels show a single-line summary
of up to 28 characters; value rows allow 64. Hover to read the original source,
subject to snapshot serialization limits. Hook kind and instance number remain visible.
Bundlers may rename functions or transform source; closure values are not expanded.
Labels do not identify Hook instances.
Both Hooks accept only `(model, selector, isEqual?)`.

Collection covers own top-level property reads, `in`, property descriptors, and
enumeration (`Object.keys`, spread). Nested reads such as `data.items[id].name`
record `items`; nested values keep their original identity. Directly returning
`data` records all fields. Conditional branches record only the inputs used on the
current evaluation. Equal-result dependency changes update arrows without forcing
a React render, and keep the result reference retained by `isEqual`.
The edges are debugging observations, not subscription filters or a static dependency
analysis: props, reads through `getField`, reads on other models, and deferred reads
inside returned callbacks/getters are not collected. Reads hidden by a cache populated
outside this Hook are also unavailable; repeated evaluations of the same selector and
snapshot within the Hook retain their observed inputs. Returning a container that
embeds `data` does not recursively inspect that container for dependencies.
No observed reads means no arrows; an older integration without collection marks
dependencies as unavailable.

Each mounted Hook gets its own node and value row showing its name, Hook kind, instance number,
and the result adopted by its latest committed React render. Identical names or shared selectors never merge rows.
Reporting runs in a post-commit effect, so props/state-only changes also refresh
the list. SSR and abandoned renders create no rows. Switching models moves the
observation; unmounting or disposing the model clears it. StrictMode effect
cleanup and recreation are supported. Numbers identify the current observation
registration; remounting or recreating effects can assign a new number.

DevTools reuses the Hook's returned result, including references retained by
`isEqual`, without evaluating the selector again. These are read-only debugging
observations: they never enter `data`, validation, the scheduler's reaction graph,
or the field-commit timeline. The panel overlays their observed edges on the schema
graph; hovering highlights source fields and their arrows. Only these two derived Hooks
populate the list; field bindings such as `useModelFields` do not.
Collection does not alter either Hook's subscription policy. Models without DevTools create no observation
registrations or additional model subscriptions; the React adapter only reports
committed results, equivalent-result dependency updates, and unmounts, and the page agent ignores unregistered models.
See [DevTools](DEVTOOLS.md) for serialization limits.

## Submission Flow

Pause editing while submission runs. Wait for current validations and reactions,
then validate all fields, including unvalidated defaults and rejected input.
`validateAll()` also waits for work started by dirty promotion and checks the
remaining model errors and dirty values before returning:

```tsx
async function onSubmit() {
    await model.settled();
    const ok = await model.validateAll();
    if (!ok) return;
    await api.save(model.data);
}
```

`settled()` waits for tracked model work, including Promises returned by
actions. It does not lock out new edits or wait for fire-and-forget network
work. The submitting UI must prevent concurrent edits and duplicate submissions.
Before this flow, reject submission if an input has `useDraftField.writeError`
or unreplayed text; those belong to the input layer and are outside model checks.
Full validation runs once, so finish related cross-field corrections before it.
See the [validation contract](API.md#validation) for failure and lifecycle details.

See [the submission recipe](../examples/react-best-practices/7-6-submission-flow.tsx).

## SSR and Concurrent Rendering

The hooks use `useSyncExternalStore`. In SSR, create one model per request,
await its setup and `settled()`, render the subtree under `ModelProvider`,
and call `dispose()` in `finally`. Do not share a model between requests.
The client owner above initially renders nothing because effects do not run
on the server.

React state tracks pending writes for the current binding. Switching the model
or field resets the count. If a switch suspends and is abandoned, the committed
binding stays active. Selector hooks cache the selector from their own
render, so an abandoned render cannot replace the committed selector.

The [CLI runner](../examples/react-bindings-runner.tsx) performs an SSR smoke
check; mounted subscription and StrictMode behavior are covered in
[provider tests](../src/__tests__/react-provider.test.tsx) and
[selector tests](../src/__tests__/react-selectors.test.tsx).
