# model-reaction DevTools

Browser DevTools extension for [`model-reaction`](../model-reaction). Inspect a
model's data tree, its field dependency graph, and a timeline of committed
changes.

See the user-facing guide in
[model-reaction/docs/DEVTOOLS.md](../model-reaction/docs/DEVTOOLS.md)
([中文](../model-reaction/docs/DEVTOOLS_CN.md)).

## Layout

```
devtools/
├── build.mjs              # esbuild bundler (4 extension entry points)
├── public/                # static assets copied verbatim into dist/
│   ├── manifest.json      # MV3 manifest
│   ├── devtools.html      # loads the devtools page (registers the panel)
│   ├── panel.html         # hosts the React panel
│   └── panel.css
├── types/chrome.d.ts      # minimal ambient chrome.* subset (no @types/chrome)
└── src/
    ├── protocol.ts        # wire protocol shared across every layer
    ├── serialize.ts       # value → transport-safe tree (cycle/depth/breadth safe)
    ├── page-agent.ts      # MAIN-world hook impl + timeline ring buffer
    ├── page-agent.entry.ts
    ├── content.ts         # ISOLATED-world relay
    ├── background.ts      # MV3 service worker (routes by tab)
    ├── devtools.ts        # registers the panel
    ├── panel-state.ts     # pure reducer folding AgentMessages → PanelState
    ├── panel-port.ts      # chrome.runtime transport for the panel
    └── panel/             # React UI (Panel, ValueTree, DataTreeView, …)
```

## Build

```bash
node build.mjs          # → dist/  (load unpacked in chrome://extensions)
```

## Test & typecheck

Run via pnpm workspace filters (from anywhere in the repo):

```bash
pnpm --filter model-reaction-devtools run test
pnpm --filter model-reaction-devtools run typecheck
pnpm --filter model-reaction-devtools run build
```

The suite includes a true end-to-end test
([src/\_\_tests\_\_/e2e.test.ts](src/__tests__/e2e.test.ts)) that wires the real
library's DevTools entry (`model-reaction/devtools`) to the real page agent,
guarding against the independently-declared hook contracts drifting apart. The
`model-reaction` / `model-reaction/devtools` imports are mapped to the library
**source** (see `jest.config.js` / `tsconfig.json`), so the test needs no build
step and still exercises the real code on both sides.
