# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- **React field metadata extensions:** `useModelFieldState` returns
  `[value, setValue, meta]` with only `errors`, `dirty`, and `validating` in
  `meta`. The `meta` option and prop, `setMeta`, and extension types are removed.
  Use [field UI state](docs/REACT.md#field-ui-state) to migrate existing extensions.

### Internal
- Track each write through its enclosing batch or scheduled reaction, and
  share the same field validation and commit pipeline.

## [2.0.0]

### Added
- **React derived values in DevTools:** `useModelSelector` and `useModelComputed`
  appear as green terminal nodes in Dependencies, with committed values and
  automatically observed top-level input arrows. Anonymous selectors use a
  source summary with the original source in the tooltip; named selectors use
  their function name. Conditional inputs update even when results stay equal.
  Hook signatures remain `(model, selector, isEqual?)`; no debug argument is required.
- **Action context:** each `reaction.action` receives `{ field, value }`, with
  the owning field from the last pending registration and its latest committed
  value read immediately before the call. `ReactionAction<T>` types the value;
  existing no-argument callbacks remain valid. See [action queue](docs/API.md#action-queue).
- **`SKIP_REACTION` sentinel:** return it from `reaction.computed` to skip
  validation, commit, field events, downstream reactions, and `action` for the
  current reaction.
- **`useDraftField` React hook** (`model-reaction/react`): the recommended
  controlled text-input binding, including fields under strict or async
  validators where a rejected or in-flight keystroke must not blank the input.
  It layers a local draft, blur-gated error display (`touched` / `onBlur` /
  `showError`), and a `format` option on top of `useModelFieldState`. See
  `docs/REACT.md` / `docs/REACT_CN.md`.
- **React field metadata:** `options.meta` derives optional UI properties;
  `useModelFieldState` now returns `[value, setValue, meta, setMeta]`.
  `setMeta` merges local extension overrides and is also exposed by
  `useDraftField` and `<Field>`. Optional selectors
  produce optional extension properties; top-level unions are not patchable.
  Enumerable symbol keys participate in updates and shallow equality.
  Existing three-item destructuring
  works; explicit tuple types and manually constructed binding objects need
  the new member. Built-in metadata remains read-only. See
  [Field UI state](docs/REACT.md#field-ui-state) for the current alternative.
- **DevTools browser extension** for inspecting models at runtime: a live data
  tree (`data` / `dirtyData` / `errors`), the reaction dependency graph, and a
  change timeline. Registration is opt-in via a new `model-reaction/devtools`
  entry — swap `import { createModel } from 'model-reaction'` for
  `'model-reaction/devtools'` and each model registers with the global DevTools
  hook when one is installed (a constant-time hook check with no integration
  allocation when it is absent). The package root imports none of this, so apps
  using only the core entry ship no DevTools integration. The React entry includes
  lightweight optional observation checks. The hook is a private dev-time
  channel — not part of the public `ModelReturn` API. See `docs/DEVTOOLS.md` /
  `docs/DEVTOOLS_CN.md`
  and the `packages/devtools/` workspace package.

### Changed
- **DevTools snapshot compatibility:** when the installed hook supports automatic
  selector observation, the opt-in entry wraps `model.data` in a stable shallow
  Proxy. Hook inputs and public snapshot reads keep matching identities.
  Native structured cloning requires copying the outer record first, such as
  `structuredClone({ ...model.data })`. Core models and models created without
  a capable hook retain their original snapshots. See [DevTools](docs/DEVTOOLS.md#enabling-it-in-your-app).
- **Source organization:** DevTools integration now lives in `src/devtools.ts`,
  with only `createModel` exported. Hook types and helpers remain private;
  tests observe registered instances through the global hook. Updated build,
  declaration, example, demo, and extension source mappings. Selector observation
  and its private types live in `src/devtools-observer.ts`; React snapshot caching
  and reporting stay private in `src/react/selectors.ts`. Public entry paths and
  exports remain unchanged.
- **Source organization:** commit options now live with write preparation;
  default cloning and structural equality move into `core/`. The validation
  entry owns error formatting, and type contract tests share one file. Removed
  three source/test files and the `utils/` directory without changing public
  APIs. Production declarations exclude the whole test directory, including
  React test helpers. See [module map](docs/ARCHITECTURE.md#module-map).
- **Internal refactor:** `ModelManager` uses per-field validation request IDs,
  shares commit options within a batch, and consolidates commit and event
  forwarding paths. The factory returns its manager without a type assertion,
  and write preparation no longer has an unrelated generic parameter. Public
  overloads and runtime behavior remain unchanged. See
  [write path](docs/ARCHITECTURE.md#write-path).
- **Internal refactor:** reaction indexing and scheduling use owning field names
  and read fixed schema definitions during execution. Removed `ReactionJob`;
  action registration now receives its owner and function array directly.
  Public APIs, trigger order, debounce, initialization, and action behavior
  remain unchanged. See [source architecture](docs/ARCHITECTURE.md#reaction-scheduling).
- **Documented contract:** schema configuration stays fixed from `createModel`
  until disposal, including shared definitions, rules, arrays, and defaults.
  Runtime mutation is unsupported; configuration changes require a new schema
  and instance. No schema cloning or freezing is added. See
  [Schema lifetime](docs/API.md#schema-lifetime).
- **Breaking (behavior):** `validateAll()` now waits for all tracked model work
  after its full pass and returns `false` if dirty values or errors remain.
  `validation:complete` fires after settlement with the final result. Submission
  uses `await model.settled(); const valid = await model.validateAll();`; remove
  the second wait and repeated model error checks. Actions and validators must
  not await either global waiting method on the same model. Public signatures
  and the shorter `setField` / `setFields` wait remain unchanged. See
  [validation](docs/API.md#validation) and its migration notes.
- **Breaking:** `reaction.action` is now an array of functions receiving
  `{ field, value }` and reading other fields through a model closure. Successful
  computations queue actions for a flush after calculation settles.
  Returned Promises remain tracked.
  See the [action migration](docs/API.md#action-queue).
- **Breaking (behavior):** pending action items now merge by function reference
  within each model, retaining the last registered occurrence and its error
  host, in arrival order. Host-version cancellation, schema sorting, and
  sequential array execution are removed. Every function in a flush is called
  without waiting for earlier results; errors do not stop other functions.
  Later skips, failures, and direct host writes retain queued functions.
  Already started calls and distinct wrappers remain independent.
- **Breaking:** each field now accepts one `reaction`; arrays (including empty
  arrays) fail at construction before initialization. Unwrap single entries;
  refactor multiple calculations by business result instead of merging them
  mechanically.
- **Breaking:** removed `strictMode` and `failFast`. Unknown keys always emit
  `field:not-found` and reject the whole batch before preparation. Field rules
  now evaluate condition/validation in order and stop at the first error.
- **Breaking:** `setField` shares the transformed candidate snapshot semantics
  of `setFields`, including its own new value in validator `data`. Move
  old-value preconditions to the business write entry point. `validateAll`
  reuses dirty values without applying transforms again.
- **React migration:** `DraftField` adds required `writeError: Error | null`;
  `showError` now includes local write exceptions. Display
  `writeError?.message ?? meta.errors[0]?.message`, and update manually constructed bindings.
- **Breaking (React):** Remove `FieldMeta.error`; use `meta.errors[0]?.message`
  for the first message and `meta.errors.length > 0` for error presence.
- Action scheduling uses one Map of pending functions; each host still has
  one pending debounced computation. Pending functions and returned Promises
  are tracked without maintaining execution groups or action versions.
- Structural field equality, both selector Hook contracts, async validation
  timeout, and reaction debounce remain unchanged.
- **Breaking:** moved `ValidationRules`, `Rule`, `formatValidationErrors`, and
  the `ValidationErrorFormatter` type from the root to
  `model-reaction/validation`. The core still executes validators. Browser
  users load the separate `dist/validation.js` UMD helpers when needed.
- **Breaking:** removed `model.subscribeField`; use
  `model.subscribe(data => data[field], callback)` or filter `field:change`
  events.
  See the migration sections in `docs/API.md` and `docs/API_CN.md`.
- **Breaking:** `reaction.computed` is now a synchronous pure-computation
  contract. Returning a Promise reports `reaction:error` and does not commit a
  value; move asynchronous work and other side effects to `reaction.action`.
- **Breaking (types):** `reaction.computed` results are type-checked against
  the field `type` (`string`, `number`, `boolean`, `Date`, `object`, readonly
  array; `enum` unchecked), plus `SKIP_REACTION`. `Reaction<T>` declares a
  standalone reaction's result type, and a bare `Reaction` stays unchecked.
  Nullable results are rejected; use a bare `Reaction` for them. Annotate
  standalone functions returning `SKIP_REACTION` as
  `(): typeof SKIP_REACTION`. `FieldSchema` is now a union discriminated by
  `type`, so `interface X extends FieldSchema` no longer compiles; use an
  intersection or a single variant such as `FieldSchema<'string'>`. Runtime
  behavior is unchanged.
- The minimum supported Node.js version is now 18, aligned with the workspace
  toolchain and CI matrix.
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

### Fixed
- Own field keys such as `toString`, `constructor`, and `__proto__` now work
  through model storage, defaults, dirty/error state, reactions, and React
  field selection without reading inherited properties or invoking prototype
  setters.
- Draft formatters from abandoned renders no longer affect pending writes;
  setter and cleanup rejections are handled locally without losing input text.
- DevTools selection falls back when the chosen instance disappears.
  `NaN`, infinities, and negative zero retain their identity through JSON
  transport and render as numbers.
- Published ESM entry points now use `.mjs`, so Node 18+ loads
  `model-reaction`, `model-reaction/react`, and `model-reaction/devtools`
  through the `import` condition without parsing them as CommonJS.

### Internal
- Boolean validator results skip timeout tasks while retaining asynchronous
  reporting; Promise results keep timeout and stale-request protection.
- Cycle guards in `deepEqual` and `cloneDefault` are allocated only when
  traversing object structures.
- Error objects and field error arrays are frozen when stored. Error snapshots
  reuse unchanged field arrays and preserve earlier snapshots.
- Removed the redundant batch reaction flag and thin validation/transform
  wrappers; single-field and batch reactions share one trigger method.
- Extracted `eachReactionEdge` (`src/reaction/reaction-graph.ts`) as the single
  definition of how a schema's `reaction.fields` are read as dependency edges.
  Both the runtime reaction index (`ReactionSystem.collectReactions`) and the
  DevTools dependency graph consume it; a lock-in test asserts agreement for
  the covered schemas.

### Docs
- Checked documentation links and examples; corrected enum default inference,
  selector example fields, and the scope of DevTools overhead. Documented
  component effects versus model actions and explicit app-wide model ownership.
- Consolidated document navigation; merged best-practice guidance into advanced
  usage and comparison, and completed design decisions into architecture.
  The ad-creation scenario now lives in
  [examples/AD_CREATION_CN.md](examples/AD_CREATION_CN.md).
- Clarified the separate subscription policies of `useModelSelector` and
  `useModelComputed`. Both share snapshot caching; `shallow` retains equivalent
  container results across updates and avoids unrelated re-renders.
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
