# DevTools

A browser extension for inspecting `model-reaction` models at runtime: the
live data tree, the field dependency graph, and a timeline of changes.

[← Back to README](../README.md)

---

## Table of contents

- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Enabling it in your app](#enabling-it-in-your-app)
- [Building the extension](#building-the-extension)
- [Loading it in Chrome](#loading-it-in-chrome)
- [Using the panel](#using-the-panel)
- [The DevTools hook contract](#the-devtools-hook-contract)
- [Zero overhead when absent](#zero-overhead-when-absent)
- [Limitations (TBD)](#limitations-tbd)

---

## What you get

Once the extension is installed and its panel is open, any page that creates a
model with `createModel(...)` shows up under a **Model Reaction** tab in the
browser DevTools, with three views:

1. **Data Tree** — the three layers of the model, each collapsible:
   - `data` — the validated source of truth
   - `dirtyData` — the last input that failed validation, per field
   - `errors` — current validation errors, per field
2. **Dependencies** — the reaction dependency graph. Each node is a field;
   each arrow points **from a dependency to the field its reaction computes**
   (read it as "`from` feeds `to`"). Hovering a node highlights its edges.
3. **Timeline** — a reverse-chronological list of committed field changes.
   Selecting an entry shows the field's value at that point next to its
   previous value.

## How it works

The extension follows the same architecture as React / Redux / Vue DevTools: a
global hook is installed before the app boots, and a model registers itself
against it if — and only if — it is present. Registration is **opt-in**: you
enable it by importing `createModel` from `model-reaction/devtools` instead of
the package root (see [Enabling it in your app](#enabling-it-in-your-app)).

```
[your app]
   │  import { createModel } from 'model-reaction/devtools'
   │  createModel() detects the hook → registers (schema / graph / snapshot / subscribe)
   ▼
window.__MODEL_REACTION_DEVTOOLS_HOOK__     ← the DevTools entry's only touch-point
   │  init / change / dispose
   ▼
page-agent.js   (injected into the page MAIN world)
   │  window.postMessage  (+ ring buffer for the change timeline)
   ▼
content.js      (ISOLATED world relay)
   │  chrome.runtime port
   ▼
background.js   (MV3 service worker, routes by tab)
   ▼
panel           (React UI: data tree · dependency graph · timeline)
```

The opt-in wrapper lives in [src/devtools.ts](../src/devtools.ts) and the hook
contract it uses in [src/devtools-hook.ts](../src/devtools-hook.ts); the
extension lives entirely under [devtools/](../../devtools). The package root
(`model-reaction`) imports **none** of this, so apps that never opt in ship zero
DevTools code.

## Enabling it in your app

Swap the import — nothing else changes. `createModel` from
`model-reaction/devtools` has the exact same signature and behaviour as the one
from the package root; it just also registers with the DevTools hook when one is
present.

```ts
// import { createModel } from 'model-reaction';
import { createModel } from 'model-reaction/devtools';

const model = createModel(schema); // now visible in the panel
```

When no extension is installed, the wrapper does a single property read and
hands back the untouched model — no registration, no subscriptions. It is common
to gate the swap on your build so production never uses it:

```ts
import { createModel } from
  process.env.NODE_ENV === 'development' ? 'model-reaction/devtools' : 'model-reaction';
```

## Building the extension

The extension is a self-contained sub-package under `devtools/`; it does not
affect the library's own build.

```bash
cd devtools
node build.mjs
```

This bundles all four extension contexts (page agent, content relay, background
worker, React panel) into `devtools/dist/`, alongside the copied static assets
(`manifest.json`, `devtools.html`, `panel.html`, `panel.css`).

## Loading it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `devtools/dist` directory.
4. Open DevTools on any page that uses `model-reaction` and select the
   **Model Reaction** tab.

> The panel pulls the current state on open, so models created before you
> opened the panel still appear.

## Using the panel

- If a page hosts **more than one** model, an instance picker appears in the
  panel header; pick which one to inspect.
- The **Timeline** is capped by a ring buffer (default 100 entries per
  instance) so a long-lived, chatty page cannot grow memory without bound.
- Large values in the data tree are truncated defensively (depth, breadth, and
  string length) so a huge blob cannot lock up the panel.

## The DevTools hook contract

The `model-reaction/devtools` entry talks to the extension through a single
global object. It is a **private, dev-time channel** — it is *not* part of the
public `ModelReturn` API and is not re-exported from the package root. See
AGENTS.md §5: the library deliberately exposes no `model.describe()`
introspection method, and this hook does not change that. The wrapper reads a
model only through its public API (`data` / `getDirtyData()` /
`validationErrors` / `on`) plus the schema it was handed — it needs no
privileged access to `ModelManager` internals.

The contract (from [src/devtools-hook.ts](../src/devtools-hook.ts)):

```ts
interface ModelReactionDevtoolsHook {
  register(instance: DevtoolsModelInstance): void;
  unregister(id: number): void;
}
```

Each registered instance exposes pull-based reads (`getFields`,
`getDependencyGraph`, `getSnapshot`) plus a push-based `subscribe` for the
change timeline. The extension's page agent implements this hook; the DevTools
entry only ever *consumes* it.

The dependency graph is derived from the schema through a shared primitive,
[`eachReactionEdge`](../src/reaction-graph.ts), which is the single definition of
how `reaction.fields` is read as edges. The core reaction scheduler
(`collectReactions`) uses the same primitive, and a lock-in test
([reaction-graph.test.ts](../src/__tests__/reaction-graph.test.ts)) asserts the
primitive, the runtime index, and the DevTools graph all agree — so the panel
can never show a dependency graph that disagrees with runtime behaviour.

## Zero overhead when absent

If you import from the package root (`model-reaction`), none of this code is
even bundled. If you opt in via `model-reaction/devtools` but no hook is
installed (e.g. production without the extension), `createModel` performs a
single property read (`globalThis.__MODEL_REACTION_DEVTOOLS_HOOK__`), finds
nothing, and hands back the untouched model — no instance object, no
subscriptions. The DevTools integration is effectively free unless you are
actively debugging.

## Limitations (TBD)

These are intentionally deferred and marked TBD:

- **Write-back time-travel.** The Timeline is **read-only**. Replaying an old
  value back into the model would re-trigger reactions and could poison
  `dirtyData` (the library intentionally has no `resetDirty` — see AGENTS.md
  §5), so "restore this value" is not implemented yet.
- **Configurable limits.** The timeline ring-buffer size and the value
  serialization depth / breadth / string caps use fixed defaults; exposing them
  as user settings is deferred.
- **Multi-frame / cross-origin iframes.** The agent is injected into the top
  frame only.
