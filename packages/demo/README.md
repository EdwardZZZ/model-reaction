# model-reaction demo

A small Vite + React app demonstrating [`model-reaction`](../model-reaction) and
its [DevTools extension](../devtools) across three scenarios:

- **Reaction chain** — `firstName`/`lastName` → `fullName` → `greeting`
  (two derivation layers in the dependency graph).
- **Async action** — username edits commit immediately; a returned request
  checks availability, with application revisions ignoring stale responses.
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

## How it resolves the library

`vite.config.ts` (and `tsconfig.json` `paths`) alias `model-reaction`,
`model-reaction/react`, and `model-reaction/devtools` to the library **source**
under `../model-reaction/src`. Editing the library is reflected instantly in
`dev`, and the demo build never depends on the library being built first —
mirroring the source-mapping used by the devtools package's tests.

## Model lifecycle under StrictMode

The app runs inside `<StrictMode>`. Each scenario creates its model in an
effect and disposes that exact instance in the effect cleanup via
[`useOwnedModel`](src/useOwnedModel.ts). The UI mounts after the model is ready;
this also lets StrictMode's extra development setup/cleanup cycle dispose its
first instance before creating the active one.

Each ready model is mounted at the scenario's form boundary with
`ModelProvider`. Descendants, including the shared `TextField`, read it through
`useModel<T>()` instead of receiving it through props. The multi-instance
scenario lets each line-item card create, provide, and dispose its own model, so
the two model contexts and lifecycles remain isolated.

[`TextField`](src/TextField.tsx) binds directly with `useModelFieldState`.
Numeric controls parse their text with `Number` before writing, so empty text
becomes `0` and intermediate spellings such as `2.` are not retained.
Applications can add local text/IME handling when their input policy requires it.
Business checks and request status belong to application code.
