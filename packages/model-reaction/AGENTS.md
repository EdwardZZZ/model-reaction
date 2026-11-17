# Coding Agent Guide

Read this before modifying the library. [Documentation](docs/README.md) lists
the owning guides; public contracts live in API, React, and DevTools.

## 1. Mental Model

- `data` holds committed values. Writes validate first; schema defaults are
  seeded directly and bypass validation.
- `dirtyData` holds each field's latest failed model value. Read or clear it
  through `getDirtyData()` / `clearDirtyData()`, not internal state.
- Reactions derive field values from declared dependencies. Construction runs
  an initial reaction pass; await `settled()` to observe its completion.

The model tracks top-level field replacement. Snapshots are stable and
shallow-frozen; nested values are not observed. Replace objects, arrays, and
mutable built-ins such as `Date` through `setField` / `setFields`.

## 2. Writes and Validation

| Need | Public API |
| --- | --- |
| Write one field | `await model.setField(name, value)` |
| Write a batch | `await model.setFields({ a, b })` |
| Read committed state | `model.data` / `model.getField(name)` |
| Revalidate dirty and committed values | `await model.validateAll()` |
| Wait for model work, outside actions and validators | `await model.settled()` |
| Observe a value outside React | `model.subscribe(selector, callback)` |
| Release an owned instance | `model.dispose()` |

Writes return `Promise<boolean>`: validation failure resolves `false`;
exceptional writes reject. Failed values stay out of `data`.
`await setField` covers the field's validation and commit, not the full
downstream chain.
For submission, use `await model.settled(); const valid = await model.validateAll();`.
Full validation checks one candidate snapshot, then waits for all tracked work
and includes remaining dirty values and errors in its result. It does not
repeat cross-field validation after action writeback. Never await the same
model's `settled()` or `validateAll()` inside a validator.

Each field accepts one reaction. Rules run condition/validation in order and
stop at the first error; `strictMode` and `failFast` no longer exist.
Unknown keys emit `field:not-found` and reject before any batch value is read
or transformed. Fields commit independently: `setFields` is not a transaction.
Direct-write validators see a shared transformed candidate snapshot, including
their own new value. `validateAll` does not transform dirty values again.
Put old-value preconditions in the business write entry point.

Import rule builders and error formatting from `model-reaction/validation`.
Field `type` metadata does not perform runtime validation; defaults may be
invalid until explicitly validated. Structural equality remains unchanged.
Migration details: [API.md](docs/API.md#api-simplification-migration-unreleased).

## 3. Reactions and React

`computed` must be synchronous and pure, with all inputs declared in `fields`.
Its output follows the validation/commit path; invalid output enters dirty
data and cannot start actions. `SKIP_REACTION` skips that computation's write
and actions.

`action` is an optional array of no-argument functions reading the model
through a closure. The latest eligible host group starts after calculation
settles; each item checks calculation again. New host versions cancel
unstarted items; running Promises remain tracked. Never await the same model's
`settled()` or `validateAll()` inside an action. Details:
[action groups](docs/API.md#action-groups).

Use `useDraftField` for text inputs and show
`writeError?.message ?? meta.error` under `showError`. Non-text controls can use
`useModelFieldState`. Preserve the distinct subscription policies of
`useModelSelector` and `useModelComputed`.
The owner creates and disposes the model; components unsubscribe in cleanup.
Do not use a route-independent singleton for independently owned editors.
Complete recipes: [React bindings](docs/REACT.md) and [examples](examples/README.md).

## 4. Source Boundaries

[Architecture](docs/ARCHITECTURE.md) owns the module map, write pipeline,
action lifecycle, and retained design decisions.

- `ModelManager` alone owns model data, validation freshness, and errors.
- Reaction code accesses the model through callbacks.
- React consumes public types/events; core does not import React or DevTools.
- DevTools reads public model state and shares dependency parsing.
- Keep internal options/types out of package exports.
- Support own schema keys such as `constructor` and `__proto__`.
- Keep files focused; document complex background in Markdown and use a short
  reference in code. Compose schemas from uniquely named field fragments.

## 5. Deliberate Omissions

Do not add or simulate these core capabilities:

| Omission | Application alternative |
| --- | --- |
| Core `touched` or draft text | UI state; `useDraftField` owns the standard text-input flow |
| `commitDirty` / `resetDirty` | Recreate the model to reset; do not bypass validation |
| Side effects in validators | Pure checks in validators; side effects in actions or business orchestration |
| Synchronous batching across separate setters | Use `setFields` |
| All-or-nothing transactions | Application preflight or a disposable candidate model |
| Plugin / middleware framework | Compose schema fragments and named domain functions |
| `model.describe()` introspection | Iterate the plain schema literal |

## 6. Required Checks

From the repository root, run all three before submitting:

```bash
pnpm --filter model-reaction run lint
pnpm --filter model-reaction run typecheck
pnpm --filter model-reaction run test --silent
```

Typecheck covers source, tests, and checked examples. Then run the React
example SSR smoke check; mounted behavior is covered by the React suite:

```bash
pnpm --filter model-reaction run example:react
```

If the change affects DevTools integration or reaction dependency edges,
also run:

```bash
pnpm --filter model-reaction-devtools run test
```

Keep English and Chinese document pairs in sync. Public type changes require
checking [src/types.ts](src/types.ts), exports, implementation, and public
documentation. [Integration tests](src/__tests__/integration.test.ts) protect
core documentation scenarios; they do not cover every fenced snippet.
