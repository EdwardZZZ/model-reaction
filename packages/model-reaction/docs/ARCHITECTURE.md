# Source Architecture

This guide maps the current `src/` modules and their main call paths. Public
behavior is specified by [API.md](API.md), [REACT.md](REACT.md), and the READMEs.

[中文版本](ARCHITECTURE_CN.md) | English

## Module map

```mermaid
flowchart LR
    Consumer[Consumer] --> Entry[src/index.ts]
    Entry --> Manager[core/ModelManager]
    Manager --> Validation[validation/validate-field]
    Manager --> Reaction[reaction/ReactionSystem]
    Manager --> Tasks[core/PendingTasks]
    Reaction --> Graph[reaction/reaction-graph]
    Reaction --> Actions[reaction/ActionExecutor]
    Actions --> Tasks
    ReactEntry[model-reaction/react] --> ReactAdapter[react/*]
    ReactAdapter --> PublicModel[ModelReturn / ModelEvents]
    DevEntry[model-reaction/devtools] --> DevAdapter[devtools/*]
    DevAdapter --> Entry
    DevAdapter --> Graph
```

| Path | Responsibility | Boundary |
| --- | --- | --- |
| `src/index.ts`, `src/types.ts` | Core entry point, public types, and factory | Does not export `ModelManager` or internal pipeline types |
| `src/core/` | Model state, field-write flow, events, and pending tasks | `ModelManager` is the sole owner of data, dirty data, errors, and validation freshness |
| `src/validation/` | Field validation, rule builders, and error formatting | Core calls `validate-field.ts`; rules and formatting have a separate entry |
| `src/reaction/` | Dependency indexing, scheduling, computed writeback, and action lifecycle | Uses `ReactionSystem` callbacks to access the model; owns no model data |
| `src/react/` | Provider, field bindings, draft state, and selector hooks | Uses the public model surface and ships through `model-reaction/react` |
| `src/devtools/` | Optional hook and model-inspection adapter | Reads through the public model API and shares dependency parsing |
| `src/utils/` | General helpers such as default cloning and structural comparison | Does not depend on core, React, or DevTools |
| `src/__tests__/` | Core behavior, React adapter, and integration tests | Integration tests also protect README examples |

`core/internal-types.ts` and `core/write-preparation.ts` are private implementation
modules and must not be added to package exports. React and DevTools also remain
separate package entry points.

## Write path

```text
setField ─┐
         ├─> runBatch
setFields┘    ├─ prepareFieldWrites: resolve the whole batch, then transform once
              ├─ createValidationSnapshot: build one shallow-frozen candidate
              ├─ validatePrepared: start field validations and await all of them
              │    └─ validateAndCommit: validate the latest request, commit or record dirty data
              ├─ trigger one reaction pass for fields that really changed
              └─ release the batch task, so settled() covers the whole operation
```

- `validateAll()` shares the validation/commit path but reads dirty or committed values without transforming them again.
  After `runBatch()` releases its compute task, it awaits `settled()` in a
  `finally` block, including rejection paths. On normal completion it checks
  the pass result plus current dirty values and errors, emits
  `validation:complete`, and returns. It adds no tracked task for this wait.
- `setField()` / `setFields()` return after the batch; downstream work may
  remain. Full validation waits for all tracked work, without repeating the
  pass or implicitly waiting before creating its candidate snapshot.
- Reaction writeback uses `updateField()` and preserves its origin, reaction stack, and initialization context.
- Fields commit independently, so `setFields()` is not an all-or-nothing transaction.
- `ModelManager` keeps request IDs, state updates, events, and commit logic. Extract stateless preparation or calculation helpers; avoid splitting state ownership.

## Action Scheduling

This section records internal scheduling invariants. Public behavior and
migration examples remain in [API.md](API.md#action-groups).

| Owner | State and responsibility |
| --- | --- |
| `ReactionSystem` | One `ReactionJob` and at most one pending debounced computation per host; dependency index and runtime path diagnostics |
| `ActionExecutor` | Host versions, one group set, schema field order, and a coalesced microtask flush |
| `PendingTasks` | Separate `compute` / `action` counts, compute-idle notification, and `settled()` completion |
| `ModelManager` | Validation request IDs, committed state, and host-field errors |

1. Scheduling a host reaction advances its action version. A successful direct
   write that changes the host also advances it; reaction writeback does not.
   Internal `origin: 'direct' | 'reaction'` distinguishes these paths.
   Validation request IDs remain separate because they protect commits, not
   action eligibility.
2. Capture the version when scheduling, including in the debounce closure.
   Never read the latest version when an older computation finishes. On
   debounce replacement, acquire the new task before releasing the old one;
   on timer fire, remove the waiting record before running user code.
3. After a computed value validates and commits, register a group only if its
   captured version is current. The group acquires one action task immediately
   and keeps it across readiness, item execution, and inter-item waits. No
   separate pending-candidate map or collection handoff is needed.
   Each group stores its unstarted functions in an `actions` queue. Registration
   keeps the last occurrence of each reference and removes it from older queues.
4. Compute idle schedules a microtask flush. Each flush takes a ready snapshot
   in schema field order. Immediately before every item, check disposal,
   version, and compute idle synchronously, then call it without an intervening
   `await`. A previous item may have started fresh calculations, so the check
   is required for every item.
5. Groups await their own returned Promises independently. A newer version
   cancels unstarted items; an already running item remains observed and may
   overlap a newer group. Failure stops only its group, but an old item's late
   failure can still update the host's errors under existing error handling.
6. Task release is idempotent. Disposal removes waiting groups and releases
   pending settlement immediately; started Promise rejections remain observed,
   with post-disposal model error reporting suppressed.

The compute count covers input preparation, validation, debounce waits,
computed writeback, reaction registration, and batch release. The
action count covers whole groups. Reactions never await actions;
`settled()` waits for both counts, and `validateAll()` reuses that global wait
after releasing its batch. Neither method may be awaited by an action or
validator on the same model. The full-validation completion event runs after
settlement; listener updates are subsequent work.

Cycle and missing-dependency diagnostics follow the declared calculation
graph and runtime reaction paths. Closure reads and writes inside actions
cannot be inferred; there is no complete construction-time check for
side-effect writeback cycles.

## Retained Design Decisions

- **Structural equality:** keep `deepEqual`; equal-content replacement objects
  do not become changes solely because their references differ. Switching to
  `Object.is` would alter downstream validation, reactions, and action
  cancellation as well as `Date`, `NaN`, and signed-zero behavior.
- **Two selector Hooks:** `useModelSelector` filters model notifications and
  resubscribes when its selector/comparator changes; `useModelComputed`
  subscribes by model and compares snapshots. Shared render-local caching
  protects concurrent renders; merging the Hooks would change a subscription
  policy. The public choice is documented in [REACT.md](REACT.md#usemodelselector-vs-usemodelcomputed).
- **One reaction per field:** identify jobs by host, retain trigger-pass
  deduplication, and keep separate jobs when hosts reuse a reaction object.
- **One validation policy:** rules execute condition/validation in order and
  stop at the first error. Batch keys are prechecked before input values are
  read or transformed; fields then validate and commit independently.
- **Safe field dictionaries:** only own schema keys count as fields. Storage
  and snapshots must support names such as `constructor` and `__proto__`
  without inherited reads or prototype setters.
- **UI boundaries:** local editing text and write exceptions belong in draft
  bindings; core dirty data contains failed model values. React and DevTools
  remain optional entry points, with no UI policy added to core state.

## Dependency rules

1. `core` coordinates state and lifecycle; `validation`, `reaction`, and `utils` provide focused capabilities.
2. `reaction` requests model reads and writes through callbacks; it does not mutate `ModelManager` state directly.
3. `react` consumes `ModelReturn` and model events; it does not import `core/` or `reaction/` implementations.
4. `devtools` reads through the public model surface. Shared `eachReactionEdge` keeps dependency graph interpretation consistent.
5. `types.ts` describes public contracts. Internal options and intermediate types stay in their owning modules and are not re-exported from the package entry.
6. `eslint.config.mjs` enforces the main reverse-dependency boundaries; DevTools' dependency on the shared reaction graph is intentional.

## Where to start

| Change | Read first |
| --- | --- |
| Writes, dirty data, events, lifecycle | `core/model-manager.ts`, `core/write-preparation.ts` |
| Validation order, timeout, and errors | `validation/validate-field.ts` |
| Dependency edges or reaction scheduling | `reaction/reaction-graph.ts`, `reaction/reaction-system.ts` |
| Action eligibility and execution | `reaction/action-executor.ts`, `reaction/reaction-job.ts` |
| React field state and subscriptions | `react/field-state.ts`, `react/draft-field.ts`, `react/selectors.ts` |
| DevTools hook, graph, and snapshots | `devtools/devtools-hook.ts`, `devtools/index.ts` |

For public contract changes, check `src/index.ts`, both READMEs, and integration
tests. For dependency graph changes, check both Reaction and DevTools consumers of
`eachReactionEdge`.
