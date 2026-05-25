# model-reaction vs zustand vs Redux

[中文版本](COMPARISON_CN.md) | English

This document compares `model-reaction` against the two most popular state
solutions in the ecosystem — **Redux (Toolkit)** and **zustand** — to help
you pick the right tool.

> The three libraries operate at **different layers of abstraction**.
> Redux and zustand are "state containers" (where state lives), while
> `model-reaction` is a "model layer" (what rules state must satisfy and
> how fields interact). They are not mutually exclusive — combining them
> often works better than picking one.

---

## 1. One-line Positioning

| Library | Positioning |
|---------|-------------|
| **Redux (Toolkit)** | Single global store + immutable updates + strict unidirectional flow → an **application-level state container** |
| **zustand** | Minimal hook-based **general-purpose state container**, multi-store, mutable updates allowed |
| **model-reaction** | Schema-driven **domain model / form layer** with built-in validation, reactions, dirty-data, and unified error handling |

---

## 2. Feature Matrix

| Dimension | Redux Toolkit | zustand | model-reaction |
|-----------|---------------|---------|----------------|
| Bundle size | ~12KB (full RTK) | ~1KB | ~6KB |
| API surface | Medium (store/reducer/action/slice/selector) | Minimal (`create`/`set`/`get`) | Medium (schema-first, centralized) |
| Modeling style | Imperative reducers | Imperative store | **Declarative schema** |
| Immutability | Enforced (Immer built-in) | Mutable by default | Internal `deepEqual` + replace |
| Scope | Single global | Multi-store / slice | **One model per domain** |
| Validation | ❌ none | ❌ none | ✅ sync / async / conditional / cross-field |
| Derived values | reselect | selectors + middleware | ✅ **schema-level reactions** |
| Side effects | redux-thunk / saga / observable | manual / middleware | ✅ `reaction.action` |
| Dirty data | DIY | DIY | ✅ `getDirtyData()` |
| Async coordination | middleware ecosystem | DIY | ✅ Built-in `settled()` |
| Subscription granularity | whole-store + selectors | store + selectors | ✅ **field-level + selector-level** |
| DevTools | ✅ first-class Redux DevTools | ✅ via middleware | ❌ not yet |
| Persistence | redux-persist | persist middleware | ❌ not yet |
| TypeScript | Heavy RTK inference | Lean | **Schema infers data type** |
| Learning curve | Medium-high | Low | Medium |
| Ecosystem | Huge | Large | Small |

---

## 3. Mental Model

```
Redux:           action -> reducer (pure) -> new state -> view
zustand:         set(state) -> view
model-reaction:  setField -> [transform] -> [validate] -> commit -> [reaction] -> view
```

- **Redux**: every change must go through an action — strong discipline,
  traceable, time-travelable.
- **zustand**: write it however you like, functional or imperative; minimal
  constraints.
- **model-reaction**: every change carries domain semantics — *validate ->
  commit / dirty-data -> trigger dependents*.

---

## 4. Pros & Cons

### 4.1 Redux Toolkit

**Pros**
- Strongest discipline for large teams: every change has an action;
  auditing, replay, and testing are easy.
- Most mature DevTools and plugin ecosystem (time travel, persist, saga,
  observable).
- The default choice for complex cross-page / cross-module state machines.

**Cons**
- Verbose (still more code than zustand even after RTK simplification).
- Awkward for forms: writing an action / reducer per field is a nightmare.
- No validation, no derived values (need reselect), no async (need
  middleware) out of the box.

### 4.2 zustand

**Pros**
- Minimal: `create((set) => ({...}))` and you're done.
- Mature middleware ecosystem (persist / immer / devtools /
  subscribeWithSelector) and natural multi-store / slice patterns.
- Lowest mental overhead and migration cost.

**Cons**
- No constraints → easy to make a mess in large projects.
- No validation, no schema, no dirty-data, no error classification.
- Form / domain-model scenarios require building everything from scratch.

### 4.3 model-reaction

**Pros**
- **Schema-first**: types / validators / defaults / reactions / transforms
  declared together, easy to skim.
- **Validation built-in**: sync / async / conditional / cross-field, plus
  `dirtyData` + `validationErrors` + `getValidationSummary`.
- **Reactions built-in**: `fields → computed → action`, with automatic
  dependency tracking and circular-dependency detection.
- **Field-level subscriptions**: `subscribeField` / `useModelField` are
  more precise than selectors + memoization.
- **Async coordination**: `settled()` waits for *all* pending reactions
  and validations in one line.
- **Error classification**: `ErrorType` enum + `ErrorHandler` — cleaner
  than try/catch inside reducers.

**Cons**
- **Not a general-purpose store**: not designed for UI / routing / global
  shared state.
- **Thin ecosystem**: no DevTools, no persist, no middleware story yet.
- **Weak multi-store coordination**: cross-model orchestration is manual.
- **Writes must be awaited**: `setField` returns a Promise (validation is
  async).
- **React integration is now solid (`ModelProvider` / `<Field>` /
  `useModelFieldState`)** but community resources lag far behind RTK and
  zustand.

---

## 5. Same Feature, Three Implementations

Requirement: a `name` field with required validation and inline error
rendering.

### 5.1 Redux Toolkit

```ts
// slice
const userSlice = createSlice({
  name: 'user',
  initialState: { name: '', errors: {} as Record<string, string> },
  reducers: {
    setName: (s, a: PayloadAction<string>) => {
      s.name = a.payload;
      if (!a.payload) s.errors.name = 'required';
      else delete s.errors.name;
    },
  },
});

// component
const name = useSelector((s: RootState) => s.user.name);
const error = useSelector((s: RootState) => s.user.errors.name);
dispatch(setName(value));
```

### 5.2 zustand

```ts
const useUser = create<{
  name: string;
  errors: Record<string, string | undefined>;
  setName: (v: string) => void;
}>((set) => ({
  name: '',
  errors: {},
  setName: (v) =>
    set((s) => ({
      name: v,
      errors: v
        ? { ...s.errors, name: undefined }
        : { ...s.errors, name: 'required' },
    })),
}));

// component
const name = useUser((s) => s.name);
const error = useUser((s) => s.errors.name);
useUser.getState().setName(value);
```

### 5.3 model-reaction

```ts
const userModel = createModel<{ name: string }>({
  name: { type: 'string', default: '', validator: [ValidationRules.required] },
});

// component
const [name, setName, meta] = useModelFieldState(userModel, 'name');
// meta.error is derived from validators automatically.
```

Validation logic, error state, and field subscriptions are all built-in,
and types are inferred end-to-end.

---

## 6. Decision Tree

```
Is it a form / domain entity / has cross-field validation?
├─ Yes → model-reaction
│        └─ Also need global UI state? Combine: model-reaction + zustand
│
└─ No (general state) →
    ├─ Big team / strict auditing / complex state machine → Redux Toolkit
    ├─ Small / mid project, minimalism preferred       → zustand
    └─ Existing Redux project, just adding forms       → drop model-reaction next to Redux
```

---

## 7. They Are Not Mutually Exclusive

Real projects often combine them:

| Project Type | Recommended Stack |
|--------------|-------------------|
| Mid-size SPA + complex forms | **zustand** (global) + **model-reaction** (per form / domain object) |
| Large enterprise app | **Redux Toolkit** (app skeleton) + **model-reaction** (business form layer) |
| Form-heavy app | **model-reaction** alone, with `ModelProvider` |
| Tiny demo / internal tool | **zustand** alone |

---

## 8. TL;DR

- **Want discipline and ecosystem?** → Redux
- **Want lightweight and fast?** → zustand
- **Want schema, validation, reactions, dirty-data out of the box?** →
  model-reaction

They live at **different abstraction levels**: Redux / zustand are state
containers; `model-reaction` is a model layer. The former answers "where
does state live?", the latter answers "what rules must state satisfy and
how do fields interact?". Composing them is usually more pleasant than
picking one and forcing it everywhere.
