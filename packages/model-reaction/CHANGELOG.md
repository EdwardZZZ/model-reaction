# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`useDraftField` React hook** (`model-reaction/react`): an optional
  controlled-input binding for fields under strict or async validators, where a
  rejected or in-flight keystroke must not blank the input. It layers a local
  draft, blur-gated error display (`touched` / `onBlur` / `showError`), and a
  `format` option on top of `useModelFieldState`. It is a separate named export,
  not folded into `useModelFieldState` or `meta`, so the core binding stays
  draft-free and consumers who don't import it pay nothing. See
  `docs/REACT.md` / `docs/REACT_CN.md`.
- **DevTools browser extension** for inspecting models at runtime: a live data
  tree (`data` / `dirtyData` / `errors`), the reaction dependency graph, and a
  change timeline. Registration is opt-in via a new `model-reaction/devtools`
  entry — swap `import { createModel } from 'model-reaction'` for
  `'model-reaction/devtools'` and each model registers with the global DevTools
  hook when one is installed (a single property read, no allocation, when it is
  absent). The package root imports none of this, so apps that never opt in
  ship zero DevTools code. The hook is a private dev-time channel — not part of
  the public `ModelReturn` API. See `docs/DEVTOOLS.md` / `docs/DEVTOOLS_CN.md`
  and the `devtools/` sub-package.

### Changed
- **Reactions now run an initial pass at construction.** Previously a derived
  field kept its own `default` until the first change to a dependency, so a
  model built purely from defaults showed stale derived values (e.g. a
  `fullName` reaction stayed empty even though `firstName`/`lastName` had
  defaults). Now, after seeding defaults, the constructor fires one reaction
  pass for the seeded fields, so derived fields start with a correct computed
  value. The pass is tracked by `settled()`. Defaults still **bypass
  validation** (unchanged); only the reaction gap is closed. If you relied on a
  derived field staying at its literal `default` until first interaction, it
  now reflects the computed value from the start.

### Internal
- Extracted `eachReactionEdge` (`src/reaction-graph.ts`) as the single
  definition of how a schema's `reaction.fields` are read as dependency edges.
  Both the runtime reaction index (`ReactionSystem.collectReactions`) and the
  DevTools dependency graph consume it, so they cannot diverge; a lock-in test
  asserts the primitive, the runtime index, and the graph all agree.

### Docs
- Documented that `useModelComputed` requires a structural `isEqual` (e.g.
  `shallow`) when its selector returns a fresh object/array each call;
  otherwise the default `Object.is` never matches and React aborts with
  "Maximum update depth exceeded". Clarified in `docs/REACT.md`,
  `docs/REACT_CN.md`, and the hook's JSDoc.
- Updated the DevTools row in `docs/COMPARISON.md` / `docs/COMPARISON_CN.md`
  from "not yet" to the new browser extension.

### Internal (repo)
- The repository is now a pnpm monorepo. This library moved to
  `packages/model-reaction/` alongside `packages/devtools` (the extension) and
  `packages/demo` (a Vite + React demo). The published package name, version,
  entry points, and `files` are unchanged — the npm tarball contents are
  identical to before the move.

## [1.2.0] - 2026-09-04

### Added
- GitHub Actions CI workflow running lint, typecheck, tests, and build across
  Node 16/18/20/22.

### Changed
- The library no longer writes to `console.error` on validation, reaction, or
  dependency errors. These outcomes are surfaced exclusively through the typed
  event bus (`validation:error`, `reaction:error`, `dependency:error`,
  `field:not-found`); subscribe via `model.on(...)` to observe or log them.
- Reaction failures are now recorded in `validationErrors` under the field the
  reaction computes, instead of the internal `__reactions` key. The
  `__reactions` key is no longer produced.
- `setFields` and `validateAll` now trigger reactions only for fields whose
  committed value actually changed, matching the single-field `setField` path.
  Previously a reaction's `action` side effect could fire for fields that were
  re-submitted unchanged or that failed validation.
- `dirtyData` is now a private field on the model instance. It was never part
  of the `ModelReturn` type, but was reachable on the concrete instance at
  runtime; read/clear it exclusively through `getDirtyData()` /
  `clearDirtyData()`.

### Internal
- Public `ModelManager` methods are now bound arrow-function class fields
  instead of prototype methods bound in the constructor.
- `subscribe` / `subscribeField` route through the public `on(...)` facade
  instead of touching the internal event emitter directly.
- Async validator timeout handling was extracted into a single `raceTimeout`
  helper, collapsing the previously duplicated sync/async error branches in
  `validateField`. No behavior change.
- Removed unreachable defensive defaults: the private `revalidateField` and
  `commitValid` methods no longer declare `= {}` option defaults (every call
  site already passes options), and `raceTimeout` drops its `if (timeoutId)`
  guard since the id is assigned synchronously. No behavior change.

### Performance
- Reaction dependency collection is now single-pass (O(n)) instead of building
  intermediate objects per dependency.


## [1.1.1] - 2026-08-03

### Changed
- Included `AGENTS.md`, `docs/`, and `examples/` in the npm package so coding
  agents and consumers receive the documentation referenced by the README.

## [1.1.0] - 2026-07-17

### Added
- `Rule.when(predicate)` chainable helper for conditional validation rules.
- Typed `ModelEventMap<T>` payloads and standalone `formatValidationErrors`.
- Built-in rules: `integer`, `boolean`, `string`, `min`/`max` with type guards,
  `minLength`, `maxLength`, `pattern`.
- `ModelEvents.DEPENDENCY_ERROR` for reaction dependency failures.
- `LICENSE` (ISC) and `CHANGELOG.md` files.
- `prepublishOnly` script (lint + test + build) and `engines.node >= 16`,
  `sideEffects: false`, explicit `files` whitelist in `package.json`.
- `clearMocks` / `restoreMocks` and `testMatch` defaults in `jest.config.js`.
- ESLint flat config now lints `src/__tests__/**` and `examples/**` with
  test/example-friendly rule overrides.
- Public type exports: `Validator`, `Reaction`, `FieldSchema`, `ValidationError`,
  `ModelError`, `ModelErrorCode`, `ModelEventMap`, `ModelEvents`.
- Expanded test coverage across the existing suites for the high-severity and
  hardening fixes: `strictMode`, dispose-after-use guards, typed event
  isolation, `EventEmitter` robustness, and `settled()` with in-flight async
  validation (see `model-manager.test.ts`, `event-emitter.test.ts`,
  `reaction-system.test.ts`, and `integration.test.ts`).

### Changed
- **Breaking:** model errors now flow only through typed `model.on(...)` events.
  Removed `ErrorHandler`, `ErrorType`, `ModelOptions.errorHandler`, and the
  duplicate internal error bus.
- **Breaking:** removed `model.off(...)`; `model.on(...)` returns the sole
  unsubscribe function.
- **Breaking:** replaced `getValidationSummary()` and
  `ModelOptions.errorFormatter` with standalone `formatValidationErrors`.
- **Breaking:** stopped exporting the internal `ValidateFieldOptions` type.
- Reworked the ad-creation technical solution document to align with the current
  `model-reaction` API guidance, and moved it from the repository root to
  `docs/TECHNICAL_SOLUTION.md`.
- `settled()` now waits for both pending reaction timeouts AND in-flight async
  reactions/validations, instead of resolving on a fixed timer.
- `validateAll()` suppresses per-field reactions and triggers a single batched
  `triggerReactionsForFields` at the end.
- `Rule.validate` signature now accepts an optional second `data` argument,
  matching the `Validator` interface for cross-field validation.
- `Rule` constructor accepts an optional `condition`; `withMessage` preserves it.
- Built-in `min`, `max`, `number` rules now reject coercion from strings, arrays,
  `null`, `undefined`, and `NaN`.
- Reaction dependency-missing detection now uses schema membership instead of
  runtime value, so a legitimate `undefined` no longer triggers
  `DEPENDENCY_ERROR`.
- `validator.condition` guard semantics fixed: validators are now skipped when
  `condition(data)` returns `false`, regardless of whether `data` is falsy.
- Stale async validator results no longer pollute current `validationErrors`
  after a newer request supersedes them.
- `EventEmitter.emit` snapshots its listener array, surfaces listener errors via
  `console.error`, and isolates one listener's exception from the others.
- `tsconfig.json` switched to `module: esnext` + `moduleResolution: bundler`.
- Replaced deprecated `rollup-plugin-terser` with `@rollup/plugin-terser`.
- `examples/complex-form.ts`:
  - Removed reaction `action` that re-called `setField` (computed return value
    is the new value).
  - Replaced closure-based "skip credit-card validation when paymentMethod is
    not creditCard" with new `condition` + cross-field `data` API via
    `Rule.when(...)`.
  - Added `await model.settled()` before `validateAll()`.

### Fixed
- `(quantity || null)` typo in `examples/complex-form.ts` total-amount
  computation that produced `0` instead of the actual subtotal.
- `.npmignore` referenced the removed `.eslintrc.js`; updated to ignore the new
  flat config and add `coverage`, `.github`, `.prettierrc`, `CHANGELOG.md`.
