# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
