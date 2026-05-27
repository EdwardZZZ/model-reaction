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
import { useModelField, useModelFieldState } from 'model-reaction/react';

function NameInput() {
  const name = useModelField(user, 'name');
  return <input value={name} onChange={(e) => user.setField('name', e.target.value)} />;
}

function AgeInput() {
  const [age, setAge, meta] = useModelFieldState(user, 'age');
  return (
    <>
      <input type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} />
      {meta.error && <span>{meta.error}</span>}
    </>
  );
}
```

For the full hook list, the `useModelSelector` vs `useModelComputed` decision tree, and performance guidance, see [docs/REACT.md](docs/REACT.md).

## Documentation

| Topic | Link |
| --- | --- |
| API Reference | [docs/API.md](docs/API.md) |
| Advanced patterns (async validation, custom rules, cross-field, `settled()`, type inference) | [docs/ADVANCED.md](docs/ADVANCED.md) |
| React bindings & selector hooks | [docs/REACT.md](docs/REACT.md) |
| Best practices | [docs/BEST_PRACTICES.md](docs/BEST_PRACTICES.md) |
| Comparison with Redux & zustand | [docs/COMPARISON.md](docs/COMPARISON.md) |
| Runnable examples | [`examples/`](examples/) |

## License

[MIT](LICENSE)
