# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

These breaking changes require a major release. The package version remains
unchanged until release.

### Added

- `SKIP_REACTION` skips a computation's host transform/commit, actions, and
  downstream propagation.
- Optional `model-reaction/react` field/selector bindings with synchronous
  setters and explicit model ownership.
- Optional `model-reaction/devtools` entry and browser extension with committed
  data, declared field/action graph, and a read-only change timeline.
- Application preflight, submission, and async-action examples with
  stale-response/disposal protection.

### Changed

- **Breaking:** `setField` and `setFields` synchronously transform/commit and
  return `void`. Unknown keys/getter/transform errors throw synchronously;
  computed values no longer pass through asynchronous validation.
- **Breaking:** each field accepts one `reaction`. `computed` must be pure
  and synchronous, with return types checked against the host type tag.
  Reaction arrays and Promise-like computed results are unsupported.
- **Breaking:** `reaction.action` is a no-argument function array. Versioned
  groups start after calculation settles, check the barrier per item, and
  track returned Promises independently. Pending shared function references
  retain their last registration.
- Construction initializes reactions reachable from seeded non-reaction inputs.
  Initial actions are deferred; defaults remain cloned and untransformed.
- Batch writes preflight all keys and transform all candidates before
  individual commits/events and dependency propagation.
- `settled()` waits for batches, calculation cascades, and
  action groups. It performs no validation and resolves even after reported
  reaction/action failures.
- **React migration:** `useModelFieldState` returns `[value, setter]`;
  `Field` render props contain `{ value, setValue }`. Input formatting and
  edit feedback belong to application controls.
- **Private DevTools protocol migration:** snapshots contain only `{ data }`;
  field metadata has no validator count, and only committed changes are
  subscribed. Update the extension together with the library.
- Retained structural field equality and two selector Hook policies.
  Node.js 18+ is required.

### Removed

- Schema validators, validation execution, rules/formatters, `Validator`,
  `ValidationError`, `ValidationErrorFormatter`, and the
  `model-reaction/validation` entry/build.
- `asyncValidationTimeout`, `validateAll`, `validationErrors`, `getDirtyData`,
  `clearDirtyData`, validation/dirty-data events, and React `FieldMeta`/`meta`.
- `debounceReactions`, `ModelOptions`, and the `createModel` options argument.
  Calculation cascades now always finish synchronously before a setter returns;
  application code owns input/request rate limiting.
- `useDraftField`, `DraftField`, `UseDraftFieldOptions`, and the adapter's
  draft/touched/write-exception state and formatter synchronization.
  Use `useModelFieldState` for direct bindings and implement text/IME policy
  in application controls.
- Old `strictMode`, `failFast`, and `subscribeField` APIs remain removed.

Business checks, errors, rejected text, request timeouts, and remote acceptance
belong to application code. Previously rejected field values now commit after
transformation; type/enum metadata does not perform runtime checks.
Migration: [English](docs/API.md#removing-validation-migration-unreleased) /
[中文](docs/API_CN.md#移除校验的迁移说明未发布).

### Fixed and internal

- Own keys such as `constructor`, `toString`, and `__proto__` work across model,
  reaction, React, and DevTools storage.
- Selector caches retain their concurrent-render protections.
- DevTools selection falls back when an instance disappears. Exceptional
  numbers retain explicit markers through JSON transport.
- ESM builds use `.mjs`; CommonJS exports remain supported.
- Removed validation freshness, timeout, dirty/error state, and subscriptions.
  ModelManager owns only committed data and lifecycle; shared edge parsing
  keeps runtime and DevTools dependency graphs aligned.
- Repository is a pnpm monorepo; English/Chinese documentation and examples
  are synchronized with the current public contract.

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
- Reworked the ad-creation technical solution document to align with the
  `model-reaction` API guidance, and moved it from the repository root into
  the package documentation. The current recipe is
  [examples/AD_CREATION_CN.md](examples/AD_CREATION_CN.md).
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
