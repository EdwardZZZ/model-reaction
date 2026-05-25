# Model Reaction Library Best Practices Guide

[中文版本](BEST_PRACTICES_CN.md) | English

## 1. Performance Optimization

### Large Form Handling
- Use the `debounceReactions` option to reduce frequently triggered reactions
- Consider using virtual scrolling for large list data

### Asynchronous Validation Optimization
- Implement validation result caching to avoid re-validating the same values
- Use `asyncValidationTimeout` to control validation timeouts
- Apply debouncing to user input to reduce the number of validation requests

## 2. Error Handling

### Global Error Handling
```typescript
const errorHandler = new ErrorHandler();
errorHandler.onError(ErrorType.UNKNOWN, (error) => {
  console.error('Error occurred:', error);
  // Display global error notification
});
```

### Field-Level Error Handling
- Use the `validationErrors` object to get errors for specific fields
- Display error messages for each field in the UI
- Use `getValidationSummary()` to get an error summary

## 3. Complex Business Rules

### Reaction System Design
- Keep `computed` functions pure, only for calculating values
- Handle side effects in `action`
- Use dependency graphs to optimize complex reaction chains

### Conditional Validation
- Implement complex conditional validation using custom `Rule`
- Access other field values using the validator's `data` parameter
- For complex logic, consider encapsulating it as a separate validation service

## 4. Testing Strategy

### Unit Testing
- Test validation rules for each field
- Test the correctness of the reaction system
- Test error handling flow

### Integration Testing
- Test complete form submission flow
- Test asynchronous validation integration
- Test interaction with UI components

## 5. Code Organization

### Large Application Structure
- Organize model definitions by functional modules
- Extract common validation rules into shared libraries
- Use composition instead of inheritance to extend model functionality

### Maintainability Recommendations
- Add clear documentation comments for each model
- Keep model definitions concise, avoiding excessive complexity
- Regularly refactor and optimize the reaction system

## 6. Type Safety

### Define Interfaces
- Always define a TypeScript interface for your data model.
- Use `createModel<Interface>(...)` to enforce schema validation.
- This prevents runtime errors caused by missing fields or incorrect types.

### Strict Schema Matching
- The library enforces that your Schema matches your Interface exactly.
- All required fields in the Interface must be present in the Schema.
- Extra fields not in the Interface are not allowed in the Schema.

## 7. React Integration

The `model-reaction/react` entry point exposes a small set of hooks and
components built on `useSyncExternalStore`. The guidelines below help you
get the most out of them.

### 7.1 Pick the right hook

| Need | Use |
| --- | --- |
| One field, controlled input | `useModelField` or `useModelFieldState` |
| Derived value (sum, formatting, etc.) | `useModelSelector` |
| Several fields together | `useModelFields(['a', 'b'])` |
| Form-style binding with error / dirty / validating | `useModelFieldState` |

Prefer the most specific hook. `useModelField` is cheaper than
`useModelSelector`, and `useModelFields` is cheaper than a hand-written
selector that returns a fresh object every render.

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

If the selector returns a fresh container, pair it with `shallow`:

```tsx
const slice = useModelSelector(
    cart,
    (d) => ({ qty: d.qty, price: d.price }),
    shallow,
);
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
<Field<User, 'name'> name="name">
    {({ value, setValue, meta, helpers }) => (
        <label>
            <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => helpers.setTouched()}
                aria-invalid={!!meta.error}
            />
            {meta.touched && meta.error && <span>{meta.error}</span>}
        </label>
    )}
</Field>
```

### 7.5 Touched semantics

`useModelFieldState` does not auto-flip `touched`. Wire it on `onBlur` so
errors only appear after the user leaves the field:

```tsx
<input onBlur={() => helpers.setTouched()} />
```

Use `helpers.reset()` after a successful submit to clear local hook state.

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

If reactions or async validators are debounced, `settled()` is what
guarantees a quiet model before reading `model.data`.

### 7.7 One model per logical form

Each `createModel(...)` call is independent. Recommended layout:

- Page-level UI state → `zustand` / `useState` / context.
- Domain entities and forms → one `model-reaction` model each.
- Cross-form state (wizard step, draft id) → outer container.

Don't try to stuff multiple unrelated forms into a single model just to
reuse a provider; nest providers instead.

### 7.8 Lifecycle and cleanup

`createModel` keeps internal listeners; in long-lived SPAs, dispose models
when their owning route unmounts:

```tsx
useEffect(() => {
    return () => model.dispose();
}, [model]);
```

Do not dispose a model that still has mounted subscribers — they will
throw on next read.

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

// Domain form — model-reaction
const userModel = createModel<User>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
    email: { type: 'string', default: '', validator: [ValidationRules.email] },
});

function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return (
        <ModelProvider model={userModel}>
            <UserForm />
        </ModelProvider>
    );
}
```

Rule of thumb: zustand owns *application* state (open / closed, current
user id, theme); `model-reaction` owns *entity* state (the user record
being edited, including its rules).

#### 7.10.3 Combine with Redux Toolkit

In Redux apps, keep RTK as the application skeleton and drop a
`model-reaction` model wherever you would otherwise spawn a slice purely
for an editor / wizard / form:

```tsx
function EditUserPage() {
    const userId = useSelector(selectCurrentUserId);
    const dispatch = useDispatch();
    const model = useMemo(() => createModel<User>(userSchema), []);

    useEffect(() => () => model.dispose(), [model]);

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
