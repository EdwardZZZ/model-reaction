# model-reaction

[中文版本](README_CN.md) | English

A type-safe data model library for TypeScript: validation, dependency reactions, dirty-data tracking, and unified error handling — with optional React bindings.

---

## Why model-reaction

- **Validation** — sync & async rules, custom messages, conditional & cross-field checks.
- **Reactions** — fields auto-update when their dependencies change, with optional debouncing.
- **Dirty data** — failed values are tracked separately and easy to clear.
- **Events & errors** — subscribe to changes, validation, and a unified error pipeline.
- **Type-safe** — the schema fully drives `model.data` typing.
- **Optional React adapter** — fine-grained, selector-level subscriptions; no React in the core.

### AI-Friendly by Design

`model-reaction` keeps the surface area intentionally small: schema literals
define the model, `setField` / `setFields` are the only write paths, failed
values stay in `dirtyData`, and React lifecycles are explicit
(`await setField(...)`, `dispose()` in cleanup). Coding agents can start from
[AGENTS.md](AGENTS.md) for the short ruleset.

## Installation

```bash
npm install model-reaction          # core only
npm install model-reaction react    # + React bindings (peer dep, react >= 18)
```

```ts
import { createModel, ValidationRules } from 'model-reaction';
import { useModelField } from 'model-reaction/react'; // optional
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

Always `await setField(...)` so validation has settled before you read `data`;
always call `dispose()` from your cleanup path when the model's owner unmounts.

## Core Concepts

### Reactions

A field can declare dependencies and a `computed` function. Whenever any dependency changes, the field is recomputed automatically.

```typescript
const m = createModel({
  first: { type: 'string', default: '' },
  last:  { type: 'string', default: '' },
  full:  {
    type: 'string',
    default: '',
    reaction: {
      fields: ['first', 'last'],
      computed: (v) => `${v.first} ${v.last}`,
    },
  },
});
```

### Dirty Data

Values that fail validation are recorded as "dirty" and kept separate from the clean state.

```typescript
user.getDirtyData();   // values that failed validation
user.clearDirtyData(); // reset
```

### Events

```typescript
user.on('validation:error', (e) => console.error(e.field, e.message));
user.on('field:change',     (e) => console.log(e.field, '=', e.value));
```

See [docs/API.md](docs/API.md#events) for the full event list.

## React Bindings

```tsx
import { useEffect, useState } from 'react';
import { createModel, ValidationRules } from 'model-reaction';
import { ModelProvider, useModel, useModelField, useModelFieldState } from 'model-reaction/react';

function NameInput() {
  const user = useModel<User>();
  const name = useModelField(user, 'name');
  return <input value={name} onChange={async (e) => { await user.setField('name', e.target.value); }} />;
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

function UserModelOwner() {
  const [user] = useState(() => createModel<User>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
    age:  { type: 'number', default: 18, validator: [ValidationRules.min(18)] },
  }));
  useEffect(() => () => user.dispose(), [user]);
  return <ModelProvider model={user}><NameInput /><AgeInput /></ModelProvider>;
}
```

For React lifecycles, prefer a **Provider owner** (shared state scoped to a subtree)
or a **per-route model** (fresh instance per route / modal); avoid module-level
singletons. For the full hook list, lifecycle examples, the `useModelSelector` vs
`useModelComputed` decision tree, and performance guidance, see [docs/REACT.md](docs/REACT.md).

### Form Field Bindings — `useModelFieldState`

`useModelFieldState` is the highest-level hook in the React adapter: a single call returns everything you need to wire a controlled input to a model field — value, async setter, and validation / dirty / validating metadata.

```ts
const [value, setValue, meta] = useModelFieldState(model, field);
```

**`FieldSetter<V> = (value: V) => Promise<boolean>`**

The setter wraps `model.setField` and additionally toggles `meta.validating` for the lifetime of the call. The returned `Promise<boolean>` resolves with the validation result (`true` = committed, `false` = rejected and stored as dirty data).

**`FieldMeta`**

| Property | Type | Description |
| --- | --- | --- |
| `errors` | `ValidationError[]` | All validation errors for this field. Empty array if none. |
| `error` | `string \| null` | Convenience: first error message, or `null`. |
| `validating` | `boolean` | `true` while an async `setValue` is in flight from this hook instance. |
| `dirty` | `boolean` | `true` if the field currently has an entry in `model.getDirtyData()` (i.e. its last write failed validation). |

**Recipe — touched / blur / error display:**

`touched` is intentionally not part of `meta` — it is a pure UI concern. Keep it as component-local state and gate the error display on it:

```tsx
function NameField() {
  const [name, setName, meta] = useModelFieldState(user, 'name');
  const [touched, setTouched] = React.useState(false);
  const showError = touched && meta.error;
  return (
    <label>
      <input
        value={name}
        disabled={meta.validating}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={showError ? 'true' : 'false'}
      />
      {showError && <span role="alert">{meta.error}</span>}
    </label>
  );
}
```

> `validating` is component-local (per hook instance); it tracks only setters issued from this hook, not arbitrary `model.setField` calls elsewhere.

## Documentation

| Topic | Link |
| --- | --- |
| API Reference | [docs/API.md](docs/API.md) |
| Advanced patterns (async validation, custom rules, cross-field, `settled()`, type inference) | [docs/ADVANCED.md](docs/ADVANCED.md) |
| React bindings & selector hooks | [docs/REACT.md](docs/REACT.md) |
| Best practices | [docs/BEST_PRACTICES.md](docs/BEST_PRACTICES.md) |
| Comparison with Redux & zustand | [docs/COMPARISON.md](docs/COMPARISON.md) |
| Runnable examples | [`examples/`](examples/) |
| For coding agents / LLMs (high-density quickstart) | [AGENTS.md](AGENTS.md) |

## License

[MIT](LICENSE)
