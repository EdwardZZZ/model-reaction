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
- Keep `computed` functions synchronous and pure; never return a Promise. Put
  asynchronous work and other side effects in `action`.
- Declare every value read by `computed` in `reaction.fields`.
- Prefer one reaction with all required dependencies over competing reactions
  that write the same target.

### Conditional Validation
- Import rule builders and formatting helpers from `model-reaction/validation`.
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

[REACT.md](REACT.md) owns the React contract and complete recipes. The links
below preserve the existing section anchors; application-store guidance remains here.

### 7.1 Pick the right hook

See [Hooks & Components](REACT.md#hooks--components).

### 7.2 Stable selector references

See [`useModelSelector` vs `useModelComputed`](REACT.md#usemodelselector-vs-usemodelcomputed).

### 7.2bis Inline selectors with `useModelComputed`

See [`useModelSelector` vs `useModelComputed`](REACT.md#usemodelselector-vs-usemodelcomputed).

### 7.3 Avoid prop drilling with `<ModelProvider>`

See [Basic Example](REACT.md#basic-example).

### 7.4 `<Field>` for committed-value controls

See [Basic Example](REACT.md#basic-example).

### 7.5 Touched semantics

See [Controlled Inputs](REACT.md#controlled-inputs-under-strict--async-validation).

### 7.6 Submission flow

See [Submission Flow](REACT.md#submission-flow).

### 7.7 One model per logical form

Keep unrelated forms in separate owners. See [Model Lifecycle](REACT.md#model-lifecycle-in-react).

### 7.8 Lifecycle and cleanup

See [Model Lifecycle](REACT.md#model-lifecycle-in-react).

### 7.9 SSR and concurrent rendering

See [SSR and Concurrent Rendering](REACT.md#ssr-and-concurrent-rendering).

### 7.10 Choosing between model-reaction, zustand and Redux

`model-reaction` is a **model layer**, while zustand and Redux are
**state containers**. They can be used together; see [COMPARISON.md](COMPARISON.md)
for the full matrix.

| Need | Recommended |
| --- | --- |
| Form / domain entity with validation, reactions, dirty-data | **model-reaction** |
| App-wide UI state, routing flags, theme, draft id | **zustand** (or Redux) |
| Strict auditing, time-travel, complex global state machine | **Redux Toolkit** |
| Form-heavy app | **model-reaction** alone with `<ModelProvider>` |

#### 7.10.1 Don't reach for `useState` for form fields

For coupled fields with validation, derived totals, or async checks,
`model-reaction` handles the domain state. Keep editing text and UI flags in
React; [Controlled Inputs](REACT.md#controlled-inputs-under-strict--async-validation)
explains that boundary.

#### 7.10.2 Combine with zustand for global state

```tsx
const useUI = create<{ drawerOpen: boolean; toggle: () => void }>((set) => ({
    drawerOpen: false,
    toggle: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));

function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return <UserRoute><UserForm /></UserRoute>;
}
```

zustand owns application state; `model-reaction` owns the edited entity and
its rules. `UserRoute` follows the [owner lifecycle](REACT.md#model-lifecycle-in-react).
See the [integration snippet](../examples/react-best-practices/7-10-2-with-zustand.tsx).

#### 7.10.3 Combine with Redux Toolkit

Keep RTK as the application store and use a model for an editor, wizard, or
form. Create an owner per edited entity; after the
[submission checks](REACT.md#submission-flow), dispatch the model's committed
data to the application store. This avoids an action and reducer for every
form field.

See the [integration snippet](../examples/react-best-practices/7-10-3-with-redux.tsx).

#### 7.10.4 Things to migrate **off** of `model-reaction`

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

See the [comparison snippet](../examples/react-best-practices/7-10-5-cheat-sheet.ts).
These store integrations require optional third-party dependencies; the library
does not install them.
