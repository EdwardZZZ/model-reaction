# model-reaction, zustand, and Redux Toolkit

[中文版本](COMPARISON_CN.md) | English | [Documentation](README.md)

`model-reaction` provides field validation, derived values, and rejected-input
tracking for a domain entity. Redux Toolkit and zustand provide application
state containers. Choose by the state being managed; a form model can coexist
with an application store.

## Capabilities and Boundaries

| Concern | Redux Toolkit | zustand | model-reaction |
| --- | --- | --- | --- |
| Modeling | Slices, reducers, actions | Stores with `set` / `get` | Flat field schema |
| Updates | Immutable reducer updates with Immer | Immutable updates by convention; Immer optional | Validated field replacement, shallow-frozen snapshots |
| Derived values | Selectors; `createSelector` available | Selectors or application logic | Declared `reaction.fields` with pure `computed`; React selector Hooks |
| Async work | Thunks, listener middleware, RTK Query | Application actions or integrations | Async validators and `reaction.action` functions |
| Field validation and dirty data | Application or form-library logic | Application or form-library logic | Built-in validators, `validationErrors`, `getDirtyData()` |
| React subscription | React Redux selectors | Store selectors | Field bindings and selector Hooks |
| Completion | Depends on the async integration | Depends on application actions | `settled()` covers model validation, calculation, and actions |
| Persistence | Application logic or integrations | Persist middleware | Application-owned serialization and recovery |
| Inspection | Redux DevTools integration | DevTools middleware | [Dedicated extension](DEVTOOLS.md) |

Selectors derive values for readers; a model reaction validates and commits a
derived field, which can trigger further reactions. Those operations have
different semantics and costs. Cycle diagnostics concern declared calculation
dependencies, not arbitrary action closure writes.

## Choosing a Boundary

- Use a model for an edited entity whose fields need validation, dirty input,
  or a managed calculation graph.
- Use zustand for directly managed application state such as drawer visibility,
  theme, or the currently selected entity.
- Use Redux Toolkit when an application benefits from reducer-based updates,
  action tracing, and its middleware/query integrations.
- Keep server caches in a query layer, such as RTK Query or TanStack Query.

A large form can remain one model composed from schema fragments. Use
independent models when their owners have independent lifecycles. Coordinating
those models requires application code.

## One Field in Three Styles

These excerpts show where a required-name rule lives. The Redux and zustand
examples below store rejected text in `name`; the model keeps it in `dirtyData`
and `useDraftField` displays the editing text. They are not equivalent form
implementations. Imports and application setup are omitted.

### Redux Toolkit

```ts
const userSlice = createSlice({
  name: 'user',
  initialState: { name: '', errors: {} as Record<string, string> },
  reducers: {
    setName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
      if (!action.payload) state.errors.name = 'required';
      else delete state.errors.name;
    },
  },
});

const name = useSelector((state: RootState) => state.user.name);
const error = useSelector((state: RootState) => state.user.errors.name);
dispatch(userSlice.actions.setName(value));
```

### zustand

```ts
const useUser = create<{
  name: string;
  error: string | undefined;
  setName: (value: string) => void;
}>((set) => ({
  name: '',
  error: undefined,
  setName: (value) => set({ name: value, error: value ? undefined : 'required' }),
}));

const name = useUser((state) => state.name);
const error = useUser((state) => state.error);
useUser.getState().setName(value);
```

### model-reaction

```ts
const userModel = createModel<{ name: string }>({
  name: { type: 'string', default: '', validator: [ValidationRules.required] },
});

const { draft, setDraft, meta, writeError, onBlur, showError } =
  useDraftField(userModel, 'name');
// Bind draft/setDraft; display writeError?.message ?? meta.error under showError.
```

The complete [comparison snippet](../examples/react-best-practices/7-10-5-cheat-sheet.ts)
requires optional Redux and zustand dependencies. Model ownership and input
binding are specified in [React bindings](REACT.md).

## Combining a Store and a Model

The application store can own which editor is open. The editor owner creates
and disposes its model. After [submission checks](REACT.md#submission-flow) and
server acceptance, publish the accepted entity to the store.

| Integration | Reference |
| --- | --- |
| zustand owns global UI state; a model owns editor fields | [zustand snippet](../examples/react-best-practices/7-10-2-with-zustand.tsx) |
| Redux Toolkit owns application entities; a model handles form editing | [Redux snippet](../examples/react-best-practices/7-10-3-with-redux.tsx) |

Avoid maintaining two independently editable copies of the same form fields.
Keep editing text and UI flags local where appropriate; see
[controlled inputs](REACT.md#controlled-inputs-under-strict--async-validation).
These integrations are optional; the library does not install either store.

## Measuring Performance

The repository includes an exploratory
[model-vs-zustand benchmark](../benchmarks/model-vs-zustand.ts). From the
repository root, with `tsx` and `zustand` available:

```bash
pnpm --filter model-reaction exec tsx benchmarks/model-vs-zustand.ts
```

The script reports median timings for creation, writes, subscriptions, and
derived work. It does not implement equivalent validation, dirty-data, or
reaction-completion behavior on both sides. Record the runtime, dependency
versions, machine, and schema with any reported timings.
Measure the application's actual schema, async work, and render path before
making performance decisions; keep high-frequency raw data outside a form
model when it does not need model semantics.
