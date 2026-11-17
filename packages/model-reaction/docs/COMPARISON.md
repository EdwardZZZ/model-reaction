# model-reaction, zustand, and Redux Toolkit

[中文版本](COMPARISON_CN.md) | [Documentation](README.md)

`model-reaction` manages a field dependency graph with synchronous writes and
scheduled action groups. Redux Toolkit and zustand provide application state
containers. All three rely on application code or another library for business
validation.

## Capabilities and boundaries

| Concern | Redux Toolkit | zustand | model-reaction |
| --- | --- | --- | --- |
| Modeling | Slices, reducers, actions | Stores with `set`/`get` | Flat field schema |
| Updates | Immer-based reducers | Immutable updates by convention | Synchronous transformed field replacement |
| Derived values | Selectors / `createSelector` | Selectors / application logic | Declared dependencies and committed computed fields |
| Async work | Thunks, middleware, RTK Query | Application actions / integrations | Returned `reaction.action` work |
| Business validation | Application or form library | Application or form library | Application or form library |
| React reads | React Redux selectors | Store selectors | Field bindings and two selector policies |
| Completion | Depends on integrations | Depends on application | `settled()` for calculations and action groups |
| Persistence | Application / integrations | Persist middleware | Application serialization |
| Inspection | Redux DevTools | DevTools middleware | Dedicated extension |

Selectors derive values for readers. Model reactions transform and commit
derived fields and propagate to downstream reactions. `model-reaction` retains
structural field equality and shallow-frozen snapshots, with no deep mutation
tracking. Cycle diagnostics cover declared calculation recursion, not arbitrary
action closure writes.

## Choosing a boundary

Use a model for editor/entity fields with a calculation graph and shared
lifecycle. Use zustand for directly managed UI state; use Redux Toolkit when
reducers, action tracing, middleware, or query integration fit the application.
Keep server caches in a query layer. Independent editors can have independent
models; large schemas can compose focused fragments.

## One field in three styles

The required-name check belongs to application code in every variant.
The complete [comparison snippet](../examples/react-best-practices/7-10-5-cheat-sheet.ts)
shows a reducer, a zustand action, and this domain write entry:

```ts
const userModel = createModel<{ name: string }>({
  name: { type: 'string', default: '' },
});
function setName(value: string): string {
  userModel.setField('name', value);
  return value ? '' : 'Name is required';
}
```

An application can alternatively preflight before writing. Error storage and
display remain explicit. Model ownership and text formatting are specified in
[React bindings](REACT.md).

## Combining a store and a model

The store can own which editor is open; the editor owns its field model.
After business checks and server acceptance, publish the accepted entity to
the application store. Avoid independently editable copies of the same fields.

| Integration | Recipe |
| --- | --- |
| zustand UI state, model editor fields | [zustand](../examples/react-best-practices/7-10-2-with-zustand.tsx) |
| Redux entities, model editing | [Redux](../examples/react-best-practices/7-10-3-with-redux.tsx) |

These are optional integrations; the library installs neither store.

## Measuring performance

With `tsx` and `zustand` available:

```bash
pnpm --filter model-reaction exec tsx benchmarks/model-vs-zustand.ts
```

The exploratory script reports medians for creation, synchronous writes,
application required-field feedback, subscriptions, and derived work.
It is not a universal performance comparison: model reactions and reader
selectors have different semantics. Record runtime, versions, machine, and
schema, and measure the actual application's render and async paths.
