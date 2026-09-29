# model-reaction monorepo

A [pnpm workspace](https://pnpm.io/workspaces) containing the `model-reaction`
library, its browser DevTools extension, and a demo app.

## model-reaction

`model-reaction` is a type-safe data model library for TypeScript. It keeps
validated data as the committed source of truth, preserves rejected input
separately as dirty data, and recomputes derived fields through explicit
dependency reactions. Optional React bindings provide fine-grained
subscriptions without adding React to the core package.

- **Validation** — synchronous and asynchronous rules, including conditional
  and cross-field validation.
- **Reactions** — automatically recompute derived fields when declared
  dependencies change.
- **Dirty-data tracking** — retain invalid user input without replacing the
  last committed value.
- **Typed events and React bindings** — observe model changes through typed
  subscriptions or optional React hooks.

### Installation

```bash
npm install model-reaction

# Optional React bindings (React >=18)
npm install model-reaction react
```

### Quick start

```ts
import { createModel, ValidationRules } from 'model-reaction';

const user = createModel({
  firstName: {
    type: 'string',
    default: '',
    validator: [ValidationRules.required],
  },
  lastName: { type: 'string', default: '' },
  fullName: {
    type: 'string',
    default: '',
    reaction: {
      fields: ['firstName', 'lastName'],
      computed: ({ firstName, lastName }) =>
        `${firstName} ${lastName}`.trim(),
    },
  },
});

await user.setFields({ firstName: 'Ada', lastName: 'Lovelace' });
await user.settled();
console.log(user.data.fullName); // Ada Lovelace

user.dispose();
```

See the library documentation for the complete API and usage guidance:
[English](packages/model-reaction/README.md) |
[中文](packages/model-reaction/README_CN.md).

## Packages

| Package | Path | Description |
| --- | --- | --- |
| `model-reaction` | [packages/model-reaction](packages/model-reaction) | The core library: schema-driven model with validation, reactions, and batch operations. Published to npm. |
| `model-reaction-devtools` | [packages/devtools](packages/devtools) | Browser DevTools extension: inspect the data tree, dependency graph, and change timeline. Not published. |
| `model-reaction-demo` | [packages/demo](packages/demo) | Vite + React app demonstrating the library and the extension. Not published. |

## Repository development

```bash
# Requires Node >=18 and pnpm.
pnpm install

# Run repository checks:
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build

# Or target one package:
pnpm --filter model-reaction run test        # library
pnpm --filter model-reaction-devtools run build
pnpm --filter model-reaction-demo run dev     # demo dev server
```

## Layout

```
.
├── packages/
│   ├── model-reaction/   # library (src, docs, examples, benchmarks)
│   ├── devtools/         # browser extension
│   └── demo/             # Vite + React demo
├── pnpm-workspace.yaml
└── tsconfig.base.json    # shared compiler options (each package extends it)
```

## License

ISC — see [packages/model-reaction/LICENSE](packages/model-reaction/LICENSE).
