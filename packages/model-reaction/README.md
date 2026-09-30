# model-reaction

[中文版本](README_CN.md) | English

A type-safe data model library for TypeScript: validation, dependency reactions, dirty-data tracking, and typed events — with optional React bindings.

---

## Why model-reaction

- **Validation** — sync & async rules, custom messages, conditional & cross-field checks.
- **Reactions** — fields auto-update when their dependencies change, with optional debouncing.
- **Dirty data** — failed values are tracked separately and easy to clear.
- **Typed events** — subscribe to field changes, validation, and reaction errors.
- **Type-safe** — schema literals infer field values; fields without defaults include `undefined`.
- **Optional React adapter** — fine-grained, selector-level subscriptions; no React in the core.

### AI-Friendly by Design

`model-reaction` keeps the surface area intentionally small: schema literals
define the model, `setField` / `setFields` are the only write paths, failed
values stay in `dirtyData`, and React lifecycles are explicit
(`await setField(...)`, `dispose()` in cleanup). Coding agents can start from
[AGENTS.md](AGENTS.md) for the short ruleset.

## Installation

Requires Node.js 18 or later.

```bash
npm install model-reaction          # core only
npm install model-reaction react    # + React bindings (peer dep, react >= 18)
```

```ts
import { createModel, ValidationRules } from 'model-reaction';
import { useDraftField } from 'model-reaction/react'; // optional
```

> The default entry has zero React dependency. Only `model-reaction/react` imports React.

## Quick Start

```typescript
import { createModel, ValidationRules } from 'model-reaction';

interface User {
  name: string;
  age: number;
}

const user = createModel<User>({
  name: {
    type: 'string',
    validator: [ValidationRules.required],
    default: '',
  },
  age: {
    type: 'number',
    validator: [ValidationRules.required, ValidationRules.min(18)],
    default: 18,
  },
});

await user.setField('name', 'John');
await user.setField('age', 30);

const ok = await user.validateAll();
console.log(ok, user.data); // true { name: 'John', age: 30 }
```

The first argument to `createModel` is one flat schema object: each top-level
property represents one model field. Large schemas may be split into focused
fragments and merged with object spread before being passed in. Object and
array field values may still contain nested data, but the model tracks changes
only at the top level.

Always `await setField(...)` so validation has settled before you read `data`;
always call `dispose()` from your cleanup path when the model's owner unmounts.
The model supports shallow data and tracks changes at the field level. `data` and `getDirtyData()` return
stable, shallow-frozen snapshots; `getField()` returns the field value. For an
object, array, or mutable built-in field value such as `Date`, replace the whole
value with `setField()` or `setFields()`: mutating it in place is not observed
and does not run validation or reactions.

## Core Concepts

### Reactions

A field can declare dependencies and a `computed` function. Whenever any dependency changes, the field is recomputed automatically.
`computed` must run synchronously, purely derive the target field's next value
from the dependencies declared in `fields`, and never return a Promise. Do not
make requests, log, or mutate external state inside it; put asynchronous work
and other side effects in `action`.
Return `SKIP_REACTION` to conditionally skip the current reaction. The target
field is not validated or written, and neither `action` nor downstream
reactions run.

```typescript
import { createModel, SKIP_REACTION } from 'model-reaction';

const m = createModel({
  first: { type: 'string', default: '' },
  last:  { type: 'string', default: '' },
  full:  {
    type: 'string',
    default: '',
    reaction: {
      fields: ['first', 'last'],
      computed: (v) =>
        v.first || v.last ? `${v.first} ${v.last}`.trim() : SKIP_REACTION,
    },
  },
});
```

### Dirty Data

Values that fail validation are recorded as "dirty" and kept separate from the
committed state.

```typescript
user.getDirtyData();   // values that failed validation
user.clearDirtyData(); // reset
```

### Events

```typescript
user.on('validation:error', (e) => console.error(e.field, e.message));

// `on` returns an unsubscribe function (like `subscribe` / `subscribeField`):
const off = user.on('field:change', (e) => console.log(e.field, '=', e.value));
off(); // stop listening
```

`field:validation-complete` reports the result of each field validation,
including batch operations and reactions, even when the committed value did not
change. `dirty-data:cleared` reports fields removed by `clearDirtyData()`.

See [docs/API.md](docs/API.md#events) for the full event list.

## React Bindings

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { createModel, ValidationRules, type ModelReturn } from 'model-reaction';
import { ModelProvider, useModel, useModelFieldState, useDraftField } from 'model-reaction/react';

function NameInput() {
  const user = useModel<User>();
  const { draft, setDraft, meta, onBlur, showError } = useDraftField(user, 'name');
  return (
    <label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        aria-invalid={showError}
      />
      {meta.validating && <span>Validating...</span>}
      {showError && <span role="alert">{meta.error}</span>}
    </label>
  );
}

function AgeInput() {
  const user = useModel<User>();
  const [age, setAge, meta] = useModelFieldState(user, 'age');
  return (
    <>
      <input type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} />
      {meta.error && <span>{meta.error}</span>}
    </>
  );
}

function UserModelOwner({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ModelReturn<User> | null>(null);
  useEffect(() => {
    const owned = createModel<User>({
      name: { type: 'string', default: '', validator: [ValidationRules.required] },
      age:  { type: 'number', default: 18, validator: [ValidationRules.min(18)] },
    });
    setUser(owned);
    return () => owned.dispose();
  }, []);
  if (!user) return null;
  return <ModelProvider model={user}>{children}</ModelProvider>;
}

function App() {
  return <UserModelOwner><NameInput /><AgeInput /></UserModelOwner>;
}
```

For React lifecycles, prefer a **Provider owner** (shared state scoped to a subtree)
or a **per-route model** (fresh instance per route / modal); avoid module-level
singletons. For the full hook list, lifecycle examples, the `useModelSelector` vs
`useModelComputed` decision tree, and performance guidance, see [docs/REACT.md](docs/REACT.md).

### Text Form Fields — `useDraftField`

`useDraftField` is the recommended binding for controlled text inputs. It keeps
the edit-in-progress text local, validates through the model, and exposes
validation, dirty, touched, and pending state without requiring a separate
`useState`.

```tsx
function NameField() {
  const { draft, setDraft, meta, onBlur, showError } =
    useDraftField(user, 'name');
  return (
    <label>
      <input
        value={draft}
        disabled={meta.validating}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        aria-invalid={showError}
      />
      {showError && <span role="alert">{meta.error}</span>}
    </label>
  );
}
```

Rejected or in-flight values remain visible in `draft` while `data` keeps the
last committed value. Use the lower-level `useModelFieldState` for non-text
controls such as checkboxes, selects, and date pickers, or when committed-value
semantics are explicitly required. See
[docs/REACT.md](docs/REACT.md#controlled-inputs-under-strict--async-validation).

## Documentation

| Topic | Link |
| --- | --- |
| API Reference | [docs/API.md](docs/API.md) |
| Advanced patterns (async validation, custom rules, cross-field, `settled()`, type inference) | [docs/ADVANCED.md](docs/ADVANCED.md) |
| React bindings & selector hooks | [docs/REACT.md](docs/REACT.md) |
| Best practices | [docs/BEST_PRACTICES.md](docs/BEST_PRACTICES.md) |
| Comparison with Redux & zustand | [docs/COMPARISON.md](docs/COMPARISON.md) |
| DevTools browser extension | [docs/DEVTOOLS.md](docs/DEVTOOLS.md) |
| Scenario-based technical solution (Chinese) | [docs/TECHNICAL_SOLUTION.md](docs/TECHNICAL_SOLUTION.md) |
| Runnable examples | [`examples/`](examples/) |
| For coding agents / LLMs (high-density quickstart) | [AGENTS.md](AGENTS.md) |

## License

[ISC](LICENSE)
