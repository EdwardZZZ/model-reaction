# model-reaction monorepo

A [pnpm workspace](https://pnpm.io/workspaces) containing the `model-reaction`
library, its browser DevTools extension, and a demo app.

For installation and a quick start, see the library README:
[English](packages/model-reaction/README.md) |
[中文](packages/model-reaction/README_CN.md).
The documentation index covers API contracts, React, architecture, and examples:
[English](packages/model-reaction/docs/README.md) |
[中文](packages/model-reaction/docs/README_CN.md).

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

Library contribution rules and required checks: [AGENTS.md](packages/model-reaction/AGENTS.md).

## License

ISC — see [packages/model-reaction/LICENSE](packages/model-reaction/LICENSE).
