# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `Rule.when(predicate)` chainable helper for conditional validation rules.
- Built-in rules: `integer`, `boolean`, `string`, `min`/`max` with type guards,
  `minLength`, `maxLength`, `pattern`.
- `ModelEvents.DEPENDENCY_ERROR` event forwarded from `ErrorType.DEPENDENCY_ERROR`.
- `LICENSE` (ISC) and `CHANGELOG.md` files.
- `prepublishOnly` script (lint + test + build) and `engines.node >= 16`,
  `sideEffects: false`, explicit `files` whitelist in `package.json`.
- `clearMocks` / `restoreMocks` and `testMatch` defaults in `jest.config.js`.
- ESLint flat config now lints `src/__tests__/**` and `examples/**` with
  test/example-friendly rule overrides.
- Public type exports: `Validator`, `Reaction`, `FieldSchema`, `ValidationError`,
  `AppError`, `ValidateFieldOptions`, `ModelEvents`.
- New tests:
  - `h1-h8-fixes.test.ts` (13 cases) covering all eight high-severity fixes.
  - `m-fixes.test.ts` (10 cases) covering strictMode, dispose-after-use guards,
    shared `ErrorHandler` safety, EventEmitter robustness, and `settled()` with
    in-flight async validation.

### Changed
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
- `ModelManager.dispose()` only `off`s the listeners it registered; a shared
  external `errorHandler` is preserved. An internally-created `errorHandler` is
  fully disposed.
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
