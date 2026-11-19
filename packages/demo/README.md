# model-reaction demo

A small Vite + React app demonstrating [`model-reaction`](../model-reaction) and
its [DevTools extension](../devtools) across three scenarios:

- **Reaction chain** — `firstName`/`lastName` → `fullName` → `greeting`
  (two derivation layers in the dependency graph), with three named actions
  including a shared function, visible writeback results, and an app-wide model
  that preserves state when switching scenarios.
- **Async validation** — an async "username available?" check showing
  `validating` state and `dirtyData` on rejection.
- **Multiple instances** — two independent models on one page, exercising the
  DevTools panel's instance picker.

Every scenario opts into DevTools by importing `createModel` from
`model-reaction/devtools`.

## Run

```bash
pnpm --filter model-reaction-demo run dev      # start the dev server
pnpm --filter model-reaction-demo run build    # typecheck + production build
```

Then install the DevTools extension (see
[../devtools](../devtools)), open your browser DevTools, and select the
**Model Reaction** panel.

In **Reaction chain**, `fullName` declares `countNameAction` and
`captureFullName`; `greeting` declares the same `captureFullName` function and
`captureGreeting`. [`nameModel`](src/scenarios/reaction-chain-model.ts) is a
module-level singleton. `captureFullName` is defined at module scope and both
action arrays reference it directly. It reads and writes the shared model
when the action runs, after model construction. Initialization actions are
queued in a microtask, so the singleton is assigned before they execute.
The shared function reads `nameModel.getField('fullName')`, so
it always captures the name regardless of the context field. Queued calls are
deduplicated by function reference. The actions update
`nameActionRuns`, `capturedFullName`, and `capturedGreeting` after computation
settles, including initialization. Edit either name to watch these results
change. The **Dependencies** view shows `countNameAction` inside `fullName`
and `captureGreeting` inside `greeting`. One shared `captureFullName` node
appears to their right, with dashed arrows from both fields. Its `shared · 2 fields`
label and hover highlight make the shared function reference visible. Function
identity, rather than its name, determines whether nodes are merged.
Dependent fields shift to the right, with arrows from source blocks' right
edges to target blocks' left edges.
Writebacks appear in **Data Tree** and **Timeline**. The graph does not infer
writeback dependencies from action closures.

## How it resolves the library

`vite.config.ts` (and `tsconfig.json` `paths`) alias `model-reaction`,
`model-reaction/react`, and `model-reaction/devtools` to the library **source**
under `../model-reaction/src`. Editing the library is reflected instantly in
`dev`, and the demo build never depends on the library being built first —
mirroring the source-mapping used by the devtools package's tests.

## Model lifecycle under StrictMode

The app runs inside `<StrictMode>`. **Reaction chain** uses the shared
`nameModel`, created once when its module loads. Switching scenarios and
StrictMode's extra development setup/cleanup cycle keep that instance alive.
It remains registered in DevTools while other scenarios are active, so their
models appear alongside it in the instance picker.

[`main.tsx`](src/main.tsx) unmounts the React root and disposes `nameModel` on
`pagehide` when the page is leaving without entering the back/forward cache.
A cached page keeps the root and model alive for restoration. During Vite hot
updates, the model module disposes the instance it replaces. The entry module
only removes its page listener and unmounts its root, allowing an updated entry
to reuse a model module that has not changed.

**Async validation** and **Multiple instances** create their models in an
effect and dispose that exact instance in the effect cleanup via
[`useOwnedModel`](src/useOwnedModel.ts). Their UI mounts after the model is ready;
StrictMode's extra development setup/cleanup cycle disposes the first instance
before creating the active one.

Each model is mounted at the scenario's form boundary with
`ModelProvider`. Descendants, including the shared `TextField`, read it through
`useModel<T>()` instead of receiving it through props. The multi-instance
scenario lets each line-item card create, provide, and dispose its own model, so
the two model contexts and lifecycles remain isolated.

Text inputs keep their draft in local component state (see
[`TextField`](src/TextField.tsx), which uses `useDraftField` from
`model-reaction/react`) rather than reading `getField`, because the
library uses verify-then-commit: a transiently invalid value never lands in
`data`, so a value-from-`data` controlled input would snap back to empty while
typing. This matches the library's guidance that edit-in-progress text is a
local UI concern, not model state.
