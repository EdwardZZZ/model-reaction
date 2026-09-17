# model-reaction monorepo

A [pnpm workspace](https://pnpm.io/workspaces) containing the `model-reaction`
library, its browser DevTools extension, and a demo app.

## Packages

| Package | Path | Description |
| --- | --- | --- |
| `model-reaction` | [packages/model-reaction](packages/model-reaction) | The core library: schema-driven model with validation, reactions, and batch operations. Published to npm. |
| `model-reaction-devtools` | [packages/devtools](packages/devtools) | Browser DevTools extension: inspect the data tree, dependency graph, and change timeline. Not published. |
| `model-reaction-demo` | [packages/demo](packages/demo) | Vite + React app demonstrating the library and the extension. Not published. |

Start with the library's own README — [English](packages/model-reaction/README.md)
/ [中文](packages/model-reaction/README_CN.md) — for API and usage.

## Getting started

```bash
# Requires Node >=18 and pnpm.
pnpm install

# Run everything (recursive across packages):
pnpm -r run test
pnpm -r run build

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
├── tsconfig.base.json    # shared compiler options (each package extends it)
└── docs/
    └── MONOREPO_MIGRATION.md   # how this repo became a monorepo
```

## License

ISC — see [packages/model-reaction/LICENSE](packages/model-reaction/LICENSE).
