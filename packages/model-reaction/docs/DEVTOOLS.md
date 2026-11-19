# DevTools

A browser extension for inspecting `model-reaction` models at runtime: the
live data tree, the field dependency graph, and a timeline of changes.

[中文版本](DEVTOOLS_CN.md) | English

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
- [Known limitations](#known-limitations)

---

## What you get

Once the extension is installed and its panel is open, models created through
the opt-in `model-reaction/devtools` entry show up under a **Model Reaction**
tab in the browser DevTools, with three views:

1. **Data Tree** — the three layers of the model, each collapsible:
   - `data` — the committed source of truth (schema defaults are seeded without validation)
   - `dirtyData` — the last input that failed validation, per field
   - `errors` — current validation errors, per field
2. **Dependencies** — the reaction dependency graph. Solid arrows point
   **from a dependency to the field its reaction computes** (read it as
   "`from` feeds `to`"). Actions used by one field appear inside its module,
   connected by dashed arrows. The same function reference renders as one action
   node. When multiple fields share it, the node appears to the right of the field
   modules with a `shared · N fields` label and incoming dashed arrows from each
   declaring field. Same-name functions with different references remain separate.
   Named actions show their function names;
   anonymous actions keep the `r0 · action[index]` label.
   These arrows show ownership and execution after calculation settles, not
   closure read/write dependencies or a requirement that the host value changes.
   Indices express declaration positions; the tooltip lists every declaration.
   Hovering a field highlights its edges; hovering a shared action highlights all
   its declaring fields and incoming dashed arrows.
   Field blocks use blue backgrounds; action nodes use purple backgrounds,
   including on hover, whether drawn inside a field or shared across fields.
   Fields remain ordered vertically by dependency layer, preserving schema order
   and alignment within a layer. Each additional dependency level moves one column
   to the right. Computation arrows connect the source field's right edge to the
   target field's left edge. Field counts grow the diagram vertically, while
   dependency depth increases its width. Shared actions occupy a separate column.
   Each field reserves height only for actions drawn inside it; shared actions
   do not leave empty rows in their declaring field modules.
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

The opt-in wrapper and its internal hook contract live in
[src/devtools.ts](../src/devtools.ts), which exports only `createModel`. The extension
lives under [packages/devtools](../../devtools). The package root
(`model-reaction`) imports none of the integration code.

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

When no extension is installed, the wrapper performs one hook lookup and
returns the model without registering or subscribing. Applications that want
the integration removed from production bundles can alias
`model-reaction/devtools` to `model-reaction` in their production bundler
configuration.

## Building the extension

From the repository root:

```bash
pnpm --filter model-reaction-devtools run build
```

This bundles the four main extension contexts (page agent, content relay,
background worker, React panel) plus the DevTools page that registers the panel
into `packages/devtools/dist/`, alongside the copied static assets
(`manifest.json`, `devtools.html`, `panel.html`, `panel.css`).

## Loading it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `packages/devtools/dist`.
4. Open DevTools on any page that uses `model-reaction` and select the
   **Model Reaction** tab.

> The panel pulls the current state on open, so models created before you
> opened the panel still appear.

The background requests the full `init` state once the panel and content-relay
ports are paired, regardless of connection order. Both sides retry every 250 ms
after disconnects or transient connection failures. Sending to a closed port
also triggers recovery, even before its disconnect callback arrives; the
background releases ports whose sends fail. Closing the panel cancels its
reconnects. Either side reconnecting resynchronizes the current instances,
snapshots, and timeline retained by the page agent, recovering state updates
missed during the disconnect. The background worker does not store or replay
messages. If reloading or updating the extension invalidates the page's
extension context, the content relay stops retrying and removes its listeners.
Refresh the inspected page and reopen DevTools to restore that context.

## Using the panel

- If a page hosts **more than one** model, a row of model buttons appears below
  the panel header. Each shows its instance number, field count, and a preview
  of the first three schema field names; hover to see all field names.
  Click a button to switch directly; the selected model is highlighted and
  the current view stays open. The row scrolls horizontally when needed and
  disappears when only one model remains. Selection belongs to the panel; when
  the selected instance disappears, it falls back to a remaining instance.
- `NaN`, `Infinity`, `-Infinity`, and `-0` use an explicit number marker through
  JSON transport, so the tree preserves their display rather than showing null
  or zero. Ordinary finite numbers keep their primitive representation.
- The **Timeline** is capped by a ring buffer (default 100 entries per
  instance) so a long-lived, chatty page cannot grow memory without bound.
  **Clear** on the right of the Timeline tab row clears the current model's
  retained history. It is disabled when the timeline is empty. Model data and
  other models' histories are unaffected; new changes continue recording with
  increasing sequence numbers. Cleared entries stay cleared after reconnection.
- Rejected input, validation completion, dirty clearing, and reaction errors
  refresh the data tree automatically. Synchronous notifications share one
  queued snapshot; only committed field changes enter the timeline.
- Each snapshot shares a budget across `data`, `dirtyData`, and `errors`:
  2,000 nodes and a conservative 256 KiB UTF-8 JSON cap. Each timeline value
  has its own budget. Defaults also cap depth at 6, entries per container or
  record at 100, and string prefixes at 10,000 characters.
- Traversal stops when a budget is exhausted, with truncation markers and a
  snapshot banner when values, fields, or errors were omitted or clipped.
  Shared objects in sibling branches remain readable; true cycles are marked.

## The DevTools hook contract

The `model-reaction/devtools` entry talks to the extension through a single
global object. It is a **private, dev-time channel** — it is *not* part of the
public `ModelReturn` API and is not re-exported from the package root. See
AGENTS.md §5: the library deliberately exposes no `model.describe()`
introspection method, and this hook does not change that. The wrapper reads a
model only through its public API (`data` / `getDirtyData()` /
`validationErrors` / `on`) plus the schema it was handed — it needs no
privileged access to `ModelManager` internals.

The internal contract (from [src/devtools.ts](../src/devtools.ts)):

```ts
interface ModelReactionDevtoolsHook {
  register(instance: DevtoolsModelInstance): void;
  unregister(id: number): void;
}
```

Each registered instance exposes pull-based reads (`getFields`,
`getDependencyGraph`, `getSnapshot`) plus `subscribe` for committed changes and
optional `subscribeSnapshot` for validation, dirty-data, and error updates.
The agent still refreshes on committed changes for older instances without
`subscribeSnapshot`. Both subscriptions are removed on unregister/disposal.
The extension's page agent implements the hook; the DevTools entry consumes it.

The dependency graph is derived from the schema through a shared primitive,
[`eachReactionEdge`](../src/reaction/reaction-graph.ts), which is the single definition of
how `reaction.fields` is read as edges. The core reaction scheduler
(`collectReactions`) uses the same primitive, and a lock-in test
([reaction-graph.test.ts](../src/__tests__/reaction-graph.test.ts)) asserts the
primitive, the runtime index, and the DevTools graph agree for the covered
schemas. The diagram represents declared calculation dependencies, not
action closure reads/writes or live execution state.
Field metadata is built once per registered model; the graph projects those
same dependency lists. Subsequent reads reuse both structures.
The field-metadata loop also adds optional `actions` metadata:
`{ reactionIndex, actionIndex, name, functionId }[]`, omitted when empty.
`functionId` is assigned by function reference within each registered model and
survives JSON transport. The panel merges declarations with the same ID into one
action node, including repeated references within one field. Older metadata
without an ID keeps each declaration separate rather than guessing by name.
These declarations do not expose candidates, versions, barriers, or execution
status. Action nodes and dashed arrows are a separate view layer; they never
change the computation graph's nodes or edges.

## Zero overhead when absent

If you import from the package root (`model-reaction`), none of this code is
even bundled. If you opt in via `model-reaction/devtools` but no hook is
installed (e.g. production without the extension), `createModel` performs a
constant-time lookup of `globalThis.__MODEL_REACTION_DEVTOOLS_HOOK__` and
returns without building an instance descriptor or adding subscriptions.

## Known limitations

- **Write-back time-travel.** The Timeline is **read-only**. Replaying an old
  value back into the model would re-trigger reactions and could poison
  `dirtyData` (the library intentionally has no `resetDirty` — see AGENTS.md
  §5), so the extension does not offer a restore action.
- **Configurable limits.** The timeline ring-buffer size and the value
  serialization depth / breadth / string / node / byte caps currently use fixed
  defaults. Budgets apply per snapshot or timeline value, not to aggregate
  `init` messages or schema metadata across all model instances.
- **Multi-frame / cross-origin iframes.** The agent is injected into the top
  frame only.
