# Model Reaction Library Best Practices Guide

[中文版本](BEST_PRACTICES_CN.md) | English

## 1. Performance Optimization

### Large Form Handling
- Use `debounceReactions` when rapid writes would repeatedly run expensive
  derived work.
- Keep unrelated forms in separate models so their subscriptions and
  lifecycles remain independent.

### Asynchronous Validation Optimization
- Cache remote validation results at the service boundary when requests are
  safe to reuse.
- Set `asyncValidationTimeout` to a value appropriate for the backing service.
- Debounce input before calling `setField` when a remote validator should not
  run on every keystroke.

## 2. Error Handling

### Global Error Handling
```typescript
const unsubscribe = model.on('reaction:error', (error) => {
  console.error('Error occurred:', error);
  // Display global error notification
});
// cleanup
unsubscribe();
```

### Field-Level Error Handling
- Read field errors from `validationErrors[field]`.
- Use `formatValidationErrors(model.validationErrors)` for a submission
  summary.

## 3. Complex Business Rules

### Reaction System Design
- Keep `computed` functions pure and put side effects in `action`.
- Declare every value read by `computed` in `reaction.fields`.
- Prefer one reaction with all required dependencies over competing reactions
  that write the same target.

### Conditional Validation
- Use `Rule.when(...)` for conditional rules.
- Read other fields through the validator's `data` parameter.
- Extract shared domain checks into named rules or validation services.

## 4. Testing Strategy

### Unit Testing
- Test rule boundaries, transforms, and custom messages.
- Test reaction chains, cycles, and rejected computed values.
- Test that invalid writes update `dirtyData` without changing `data`.

### Integration Testing
- Test complete submission flows with `validateAll()` and `settled()`.
- Test stale async validation results and debounced reactions.
- Test field-level React updates and owner cleanup.

## 5. Code Organization

### Large Application Structure
- Keep each domain model in its own module.
- Compose large schemas from focused fragments.
- Extract reusable validation rules into dedicated modules.

### Maintainability Recommendations
- Keep model definitions declarative and move orchestration into named domain
  functions.
- Comment non-obvious invariants and trade-offs, not field names already
  expressed by the schema.

## 6. Type Safety

### Define Interfaces
- Use `createModel<Interface>(...)` when a domain already has an explicit
  contract; use schema inference for smaller local models.
- TypeScript checks schema keys and setter values at compile time.
- `FieldSchema.type` does not validate runtime input. Add built-in or custom
  validators for values that cross an untyped boundary.

### Strict Schema Matching
- With an inline schema, TypeScript reports missing required fields and excess
  fields when using `createModel<Interface>(...)`.
- Keep runtime validation separate from this compile-time contract.

## 7. React Integration

The `model-reaction/react` entry point exposes a small set of hooks and
components built on `useSyncExternalStore`. The guidelines below help you
get the most out of them.

### 7.1 Pick the right hook

| Need | Use |
| --- | --- |
| Display one field | `useModelField` |
| Controlled field with value / errors / pending state | `useModelFieldState` |
| Text input with strict or async validation | `useDraftField` |
| Stable derived selector | `useModelSelector` |
| Selector that closes over current props | `useModelComputed` |
| Several fields together | `useModelFields(model, ['a', 'b'])` |

Prefer the most specific hook. `useModelField` is cheaper than
`useModelSelector`, and `useModelFields` is cheaper than a hand-written
selector that returns a fresh object every render. See
[REACT.md](REACT.md#controlled-inputs-under-strict--async-validation) before
binding a text input with validation directly to committed model data.

### 7.2 Stable selector references

`useModelSelector` captures the `selector` and `isEqual` arguments at
subscription time. Passing a fresh function each render means a fresh
subscription and an extra render:

```tsx
// ❌ Re-subscribes every render.
const total = useModelSelector(cart, (d) => d.qty * d.price);

// ✅ Stable reference.
const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
const total = useModelSelector(cart, selectTotal);
```

If the selector returns a fresh container, pair it with `shallow` —
the selector still needs a stable reference:

```tsx
const selectSlice = useCallback(
    (d: Cart) => ({ qty: d.qty, price: d.price }),
    [],
);
const slice = useModelSelector(cart, selectSlice, shallow);
```

### 7.3 Avoid prop drilling with `<ModelProvider>`

Wrap the form root once and let descendants pull the model out:

```tsx
<ModelProvider model={userModel}>
    <NameField />
    <AddressFields />
    <SubmitButton />
</ModelProvider>
```

Inside any descendant:

```tsx
const model = useModel<User>();
const [name, setName, meta] = useModelFieldState(model, 'name');
```

### 7.4 `<Field>` for declarative inputs

When a leaf component is purely a controlled input plus its error, prefer
the `<Field>` render-prop form. It hides the `model` reference and makes
the binding obvious:

```tsx
function NameField() {
    const [touched, setTouched] = useState(false);
    return (
        <Field<User, 'name'> name="name">
            {({ value, setValue, meta }) => (
                <label>
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onBlur={() => setTouched(true)}
                        aria-invalid={!!meta.error}
                    />
                    {touched && meta.error && <span>{meta.error}</span>}
                </label>
            )}
        </Field>
    );
}
```

### 7.5 Touched semantics

`useModelFieldState` deliberately does not track `touched` — it is a pure
UI concern with no place on the model. Keep it as component-local state
and gate the error display on it so messages only appear after the user
leaves the field:

```tsx
const [touched, setTouched] = useState(false);
<input onBlur={() => setTouched(true)} />
{touched && meta.error && <span>{meta.error}</span>}
```

Reset it back to `false` after a successful submit if you re-use the form.

### 7.6 Submission flow

Validation is async, so submit handlers should always `await
validateAll()`:

```tsx
async function onSubmit() {
    const ok = await model.validateAll();
    if (!ok) return;
    await model.settled();      // wait for any pending reactions
    await api.save(model.data);
}
```

If reactions are debounced or async work cascades from validation,
`settled()` guarantees a quiet model before reading `model.data`.

### 7.7 One model per logical form

Each `createModel(...)` call is independent. Recommended layout:

- Page-level UI state → `zustand` / `useState` / context.
- Domain entities and forms → one `model-reaction` model each.
- Cross-form state (wizard step, draft id) → outer container.

Don't try to stuff multiple unrelated forms into a single model just to
reuse a provider; nest providers instead.

### 7.8 Lifecycle and cleanup

`createModel` keeps internal listeners; in long-lived SPAs, create a model
inside the owning effect and dispose that same instance when the route unmounts:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { ModelProvider } from 'model-reaction/react';
import { createModel, type ModelReturn } from 'model-reaction';

interface User {
    name: string;
}

function createUserModel() {
    return createModel<User>({ name: { type: 'string', default: '' } });
}

function UserRoute({ children }: { children: ReactNode }) {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    useEffect(() => {
        const owned = createUserModel();
        setModel(owned);
        return () => owned.dispose();
    }, []);
    if (!model) return null;
    return <ModelProvider model={model}>{children}</ModelProvider>;
}
```

Dispose the model from the same owner that unmounts its subscribers. Mutating a
disposed model throws, while its internal state and listeners have already been
cleared.

### 7.9 SSR and concurrent rendering

The hooks rely on `useSyncExternalStore`, so they are concurrent-safe.
For SSR, treat the model as request-scoped: create it inside the request
handler, render with `renderToString`, then `dispose()`. Do not share a
single model instance across requests.

### 7.10 Choosing between model-reaction, zustand and Redux

`model-reaction` is a **model layer**, while zustand and Redux are
**state containers**. They live at different abstraction levels and are
not mutually exclusive — see [COMPARISON.md](COMPARISON.md) for the full
matrix. Quick guidance for React projects:

| Need | Recommended |
| --- | --- |
| Form / domain entity with validation, reactions, dirty-data | **model-reaction** |
| App-wide UI state, routing flags, theme, draft id | **zustand** (or Redux) |
| Strict auditing, time-travel, complex global state machine | **Redux Toolkit** |
| Form-heavy app | **model-reaction** alone with `<ModelProvider>` |

#### 7.10.1 Don't reach for `useState` for form fields

If a form has more than two coupled fields (e.g. validation, derived
totals, async checks), prefer `model-reaction` over `useState` chains —
you'll otherwise re-implement validation, dirty-data and effects by hand.

#### 7.10.2 Combine with zustand for global state

```tsx
// Global UI store — zustand
const useUI = create<{ drawerOpen: boolean; toggle: () => void }>((set) => ({
    drawerOpen: false,
    toggle: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));

function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return (
        <UserRoute>
            <UserForm />
        </UserRoute>
    );
}
```

Rule of thumb: zustand owns *application* state (open / closed, current
user id, theme); `model-reaction` owns *entity* state (the user record
being edited, including its rules). `UserRoute` follows the lifecycle
pattern from §7.8 and disposes the model when the drawer closes.

#### 7.10.3 Combine with Redux Toolkit

In Redux apps, keep RTK as the application skeleton and drop a
`model-reaction` model wherever you would otherwise spawn a slice purely
for an editor / wizard / form:

```tsx
import { useEffect, useState } from 'react';
import { createModel, type ModelReturn } from 'model-reaction';

interface User {
    id: string;
    name: string;
}

function EditUserPage() {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    const userId = useSelector(selectCurrentUserId);
    const dispatch = useDispatch();
    useEffect(() => {
        const owned = createModel<User>(userSchema);
        setModel(owned);
        return () => owned.dispose();
    }, [userId]);

    if (!model) return null;

    async function onSave() {
        if (!(await model.validateAll())) return;
        await model.settled();
        dispatch(saveUser(model.data));
    }

    return (
        <ModelProvider model={model}>
            <UserForm onSubmit={onSave} />
        </ModelProvider>
    );
}
```

This avoids the "action / reducer per field" problem while keeping the
rest of the app on Redux.

#### 7.10.4 Things to migrate **off** of `model-reaction`

`model-reaction` deliberately stays at the model layer. Don't try to use
it for:

- Global UI flags (modals, theme, locale) → use zustand / Redux.
- Cross-route caches / query results → use TanStack Query / RTK Query.
- Multi-store orchestration (saga-like flows) → use Redux middleware.

#### 7.10.5 Code-style cheat sheet

The same `name: required` requirement, three styles:

```ts
// Redux Toolkit
createSlice({ /* setName reducer + manual errors */ });
// zustand
create((set) => ({ name: '', errors: {}, setName: (v) => /* manual */ }));
// model-reaction
createModel<{ name: string }>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
});
```

With `model-reaction`, validators, error state, dirty tracking and field
subscriptions are built-in; with the other two, you'd implement each
piece by hand.
