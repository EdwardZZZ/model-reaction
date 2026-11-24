# model-reaction DevTools

Browser DevTools extension for [`model-reaction`](../model-reaction). Inspect a
model's data tree, its field/action graph with React derived values and observed
selector inputs, and a timeline of committed changes.

See the user-facing guide in
[model-reaction/docs/DEVTOOLS.md](../model-reaction/docs/DEVTOOLS.md)
([中文](../model-reaction/docs/DEVTOOLS_CN.md)).

## Layout

```
devtools/
├── build.mjs              # esbuild bundler (5 extension entry points)
├── public/                # static assets copied verbatim into dist/
│   ├── manifest.json      # MV3 manifest
│   ├── devtools.html      # loads the devtools page (registers the panel)
│   ├── panel.html         # hosts the React panel
│   └── panel.css
├── types/chrome.d.ts      # minimal ambient chrome.* subset (no @types/chrome)
└── src/
    ├── protocol.ts        # wire protocol shared across every layer
    ├── serialize.ts       # bounded value/snapshot serialization (cycles + total budgets)
    ├── page-agent.ts      # MAIN-world hook, derived observations, timeline ring buffer
    ├── page-agent.entry.ts
    ├── content.ts         # ISOLATED-world relay + connection recovery
    ├── background.ts      # MV3 service worker (routes by tab, releases failed ports)
    ├── devtools.ts        # registers the panel
    ├── panel-state.ts     # pure reducer folding AgentMessages → PanelState
    ├── panel-port.ts      # chrome.runtime transport for the panel
    ├── graph-layout.ts   # field dependency layout
    ├── action-graph-layout.ts  # owned/shared action layout
    ├── derived-graph-layout.ts # observed React inputs and terminal nodes
    └── panel/             # React UI (Panel, InstancePicker, ValueTree, …)
```

## Build

From the repository root:

```bash
pnpm --filter model-reaction-devtools run build
```

## Test & typecheck

From the repository root:

```bash
pnpm --filter model-reaction-devtools run test
pnpm --filter model-reaction-devtools run typecheck
pnpm --filter model-reaction-devtools run build
```

The suite includes an in-memory end-to-end integration test
([src/\_\_tests\_\_/e2e.test.ts](src/__tests__/e2e.test.ts)) that wires the real
library's DevTools entry (`model-reaction/devtools`) to the real page agent,
guarding against the independently-declared hook contracts drifting apart. The
mounted [React integration tests](src/__tests__/react-derived-values.test.tsx)
also connect real selector Hooks, the page agent, and the panel to check automatic
edges, equal-result dependency changes, labels, and cleanup.
The `model-reaction` / `model-reaction/devtools` / `model-reaction/react` imports are mapped to the library
**source** (see `jest.config.js` / `tsconfig.json`), so the test needs no build
step and still exercises the real code on both sides.
