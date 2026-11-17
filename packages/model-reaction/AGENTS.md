# Coding Agent Guide

Read before changing the library. [Documentation](docs/README.md) lists
the owning guides; public contracts live in API, React, and DevTools.

## 1. Mental model

`data` holds committed field values. Direct writes and computed results pass
through synchronous transforms and commit without built-in validation.
Defaults are cloned and seeded directly. Construction triggers computations
reachable from seeded non-reaction fields; initial actions start later.

The model tracks top-level replacement with structural equality. Snapshots
are stable and shallow-frozen, not deeply immutable. Replace objects, arrays,
and mutable built-ins such as `Date` through setters.

## 2. Writes and business checks

| Need | Public API/application |
| --- | --- |
| Write one field | `model.setField(name, value)` |
| Write related fields | `model.setFields({ a, b })` |
| Read committed state | `model.data` / `model.getField(name)` |
| Wait for calculation/action work, outside actions | `await model.settled()` |
| Observe selected values outside React | `model.subscribe(selector, callback)` |
| Release an owned instance | `model.dispose()` |
| Check business data | Application preflight or submission check |

Setters return `void` synchronously. Unknown keys emit `field:not-found` and
throw before any batch value is read/transformed. All inputs are transformed
before any commits; commits and field events are individual and reentrant.
Calculation cascades finish before return. Actions run later.

There are no construction options, reaction timers, `validator`, validation entry, dirty data,
`validationErrors`, or `validateAll`. Type/enum metadata does not validate.
Do not recreate the old framework through transform or new core APIs.
Breaking migration: [API](docs/API.md#removing-validation-migration-unreleased).

## 3. Reactions and React

Each field has one reaction: `fields`, synchronous pure `computed`, optional
no-argument `action` array. Computed output uses the host transform/commit.
`SKIP_REACTION` skips write/actions/downstream propagation.

Groups capture host scheduling versions and start after calculations settle.
Each item rechecks the barrier. New host versions cancel unstarted items;
running Promises remain tracked. Groups wait independently in schema start
order; shared functions belong to their last pending registration.
Never await the same model's `settled()` within an action. Application code
owns stale-response, timeout, and disposal protection.

Use `useModelFieldState` for `[value, syncSetter]`. Input parsing, text
formatting, composition policy, and business errors/status belong to the
application. Preserve the different subscription policies of
`useModelSelector` and `useModelComputed`.
The owner creates/disposes the model; subscribers clean up their subscriptions.
[React](docs/REACT.md) and [examples](examples/README.md) own full recipes.

## 4. Source boundaries

[Architecture](docs/ARCHITECTURE.md) owns the module map and internal invariants.

- ModelManager alone owns committed data and snapshots.
- Reaction code accesses model state through focused callbacks.
- React consumes public types/events; core does not import React or DevTools.
- DevTools reads public state and shares dependency parsing.
- Keep internal types out of exports.
- Support own schema keys such as `constructor` and `__proto__`.
- Keep one responsibility per file; complex context belongs in Markdown with
  a short source reference. Compose schema fragments with unique field names.

## 5. Deliberate omissions

| Omission | Application alternative |
| --- | --- |
| Built-in validation/field-error storage | Independent checks and UI errors |
| Draft text and blur/error policy | Application controls |
| Deep mutation tracking | Whole-field replacement |
| All-or-nothing transactions | Domain preflight or isolated candidate model |
| Batching across separate setters | `setFields` for related writes |
| Automatic request cancellation | Service revisions/AbortController |
| Plugin/middleware framework | Schema fragments and named domain functions |
| `model.describe()` introspection | Iterate the plain schema |

## 6. Required checks

From the repository root:

```bash
pnpm --filter model-reaction run lint
pnpm --filter model-reaction run typecheck
pnpm --filter model-reaction run test --silent
pnpm --filter model-reaction run example:react
```

Typecheck covers source, tests, and checked examples; mounted React behavior
is covered by the test suite. For DevTools integration/dependency changes:

```bash
pnpm --filter model-reaction-devtools run test
```

For changes across packages/exports, also run workspace typecheck/build and
`pnpm --filter model-reaction run verify:exports`.
Keep English/Chinese documents in sync. Check types, exports, implementation,
and public docs together. Integration tests cover documentation scenarios,
not every fenced snippet.
