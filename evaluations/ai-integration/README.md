# AI integration evaluation baseline

[中文版本](README_CN.md) | English

Suite version: `ai-integration-v1`. Status: **first run complete: 36 valid attempts,
zero BLOCKED**. First delivery: 28/36 (77.8%); final within two repairs: 34/36 (94.4%).
Both unresolved attempts are AI-11. See the [results summary](SUMMARY.md) for
configuration, adjudication and coverage limits. Full reports and evidence remain
in local Git-ignored `runs/` and are not included in clones.
The [execution guide](EXECUTION.md) documents the runner.
Historical task prompts, fixtures, checks, references and measured results are
preserved. The harness has since changed for status consistency, artifact
selection and sandboxed grading; it is not the unchanged historical grader.

Independent resampling with the Schema Recipe is also complete: first delivery
32/36 (88.9%), final 35/36 (97.2%), with all three AI-11 attempts passing first.
See the [results summary](SUMMARY.md) for the comparison.
Both runs are retained separately; three samples per task do not establish a
stable general success rate.

The goal is to evaluate whether a coding agent can integrate `model-reaction`,
diagnose usage errors, and repair its work using the materials delivered to consumers.
The first suite contains 12 fixed tasks: six core model tasks, four React tasks,
and two typing/migration tasks. They evaluate application code, without modifying the library.

## Contracts and version

This suite follows source commit `8678594c9f0b6f828d97258f6b01a4aaf0f785fa` and its
[API reference](../../packages/model-reaction/docs/API.md),
[React bindings](../../packages/model-reaction/docs/REACT.md),
[advanced usage](../../packages/model-reaction/docs/ADVANCED.md), and
[agent guide](../../packages/model-reaction/AGENTS.md).
Those links show the current checkout's contracts. For this historical suite,
read the documents in the pinned source checkout, not current 2.0 documentation.
This suite fixes the historical task inputs and acceptance criteria.

The package version at that commit is `1.2.0`, while its documentation includes
unreleased changes. **The version number alone does not identify this evaluation
target or establish the behavior of the same version on npm.**
Before sampling, build and pack the specified source and record its commit,
working-tree diff, tarball SHA-256, bundled documentation fingerprint, and consumer lockfile.
Install that tarball in the evaluation projects; do not map imports to source files.

Use `prepare(output, sourceRepo)` (or the CLI's second argument) with a separate
checkout at the commit above. The current 2.0 package is rejected before any
build/install. The version guard is necessary, not sufficient: record and verify
the source commit/diff and calibrate all 12 references. A current-API experiment
needs a separately versioned suite; do not update these v1 references in place.
Manifests record the actual `package_version` and `tarball_name`; old manifests
derive the filename from their historical version. Use fresh evidence directories.

Current grading uses `codex sandbox -P evaluation`, without AI calls, for all
static/type inspection, compilation and runtime acceptance. Startup/permission
failure is `BLOCKED`, never an unsandboxed retry. The default-deny worker exposes
only its project, trusted toolchain/check code, and verified Node/system paths;
references, other attempts and host secrets are denied, the environment is
sanitized, and network is disabled. Checks share the submission's runtime and
are readable there: they are **not hidden or proof against adversarial tampering**.
This boundary protects host filesystem/environment/network access, not grading
integrity against a hostile runtime. Historical grades ran on the host and do
not establish this new boundary. See [execution limits](EXECUTION.md).

This directory is outside the npm package's `files` list. Acceptance criteria and
failure patterns below are evaluator material, excluded from both the package
and the agent's initial context.

## Fixed task list

| ID | Task | Main coverage |
| --- | --- | --- |
| AI-01 | Create a validated user model | Public imports, defaults, validation, inference |
| AI-02 | Preserve and handle rejected input | Data, dirty data, errors, events, recovery |
| AI-03 | Update related fields in a batch | Transformed candidate snapshot, partial commits, unknown keys |
| AI-04 | Implement a cart computation chain | Declared dependencies, pure computed, derived validation, settlement |
| AI-05 | Integrate async username availability | Out-of-order completion, stale isolation, latest state |
| AI-06 | Calculate shipping from a postcode | SKIP, actions, Promise tracking, writeback, errors |
| AI-07 | Bind a controlled amount input | Draft text, numeric conversion, async validation, both error paths |
| AI-08 | Submit an actively edited form | Waiting, full validation, submission lock, valid payload |
| AI-09 | Own independent editor lifecycles | Ownership, StrictMode, route changes, subscription cleanup |
| AI-10 | Display selections that follow props | Selector closures, field isolation, error subscriptions |
| AI-11 | Compose precisely typed business schemas | Fragments, optional values, enums, nested replacement |
| AI-12 | Migrate and repair a legacy cart integration | Current API, dependency diagnosis, shared actions |

Include all tasks in the first baseline and report per-task results. Classify AI-12
as migration/repair separately, rather than silently mixing it with implementation
from an empty starter.

## Agent input and execution rules

Each initial input consists of the shared prompt below, the task's exact “Task prompt,”
and its starter. Starters fix exports, editable files, and mock service interfaces.
Business requirements and mock behavior are visible to the agent; hidden checks
must not introduce requirements absent from the prompt. Implement and hash each
starter and evaluator before formal sampling.

> Complete the task in this standalone TypeScript consumer project. Use public
> entry points of the installed model-reaction package. You may consult its bundled
> README, AGENTS.md, docs, examples, and declarations.
> Implement runnable code in src/ using the starter's exports, handling async
> failures and resource cleanup. You may run the provided typecheck and public checks.
> Keep dependency versions, compiler configuration, starter export signatures,
> and evaluation files unchanged; do not modify node_modules.
> Do not use any, type assertions, or suppressed diagnostics to bypass the task's
> type requirements. Report changed files and checks run when submitting.

Execution rules:

1. Use a fresh project and agent context for every task and repetition. Exclude
   this conversation, other solutions, repository memory, reference implementations,
   and hidden assertions. Expose only the installed package, starter, and fixed
   toolchain; deny access to this evaluation directory, library source, repository
   tests, and web search.
2. Core tasks use plain TypeScript projects. React tasks use React, React DOM,
   jsdom, and Testing Library. Preinstall dependencies; installation failures are
   not integration failures.
3. Fix and fingerprint the agent product/version, model version, system prompt,
   reasoning configuration, tool permissions, prompt language, Node, package manager,
   TypeScript, React, and test tools. Chinese and English prompts define separate
   experiment groups; do not pool their results.
4. The first stage allows documentation lookup, compilation, and public checks.
   Freeze the first submission before running hidden acceptance checks. Call the
   metric “first-submission pass rate,” not unassisted first-generation accuracy.
5. After an initial failure, allow at most two repair rounds with raw diagnostics.
   Include failing inputs, expected/actual assertions, stacks, and timeouts; provide
   neither a reference solution nor new implementation hints.
6. Allow 20 minutes per attempt: up to 10 minutes for the first submission and
   five minutes per repair. Agent-initiated checks count toward this time; record
   evaluator execution time separately. Repeat each task three times per configuration,
   for 36 independent attempts. Changing prompts or budgets requires a new suite version.
7. Use controllable Promises for services and a fixed virtual clock for debounce.
   Synchronize through explicit events, request starts, or task state, not arbitrary
   sleeps. Assertion timeouts are watchdogs, not evidence that async work completed.
8. Before sampling, run every hidden check against an evaluator-owned reference
   implementation. Distinguish integration failures from library/environment defects;
   do not penalize an agent for capabilities the current library does not provide.

## Fixed task cards

### AI-01 — Create a validated user model

**Task prompt**

> Implement a user model factory. name defaults to an empty string and is required;
> age defaults to 18 and must be a finite number of at least 18. Return a
> model-reaction model, preserving the supplied defaults at creation so callers
> can explicitly validate and write values. Infer data types from the schema
> rather than duplicating them in a data interface.

**Fixed inputs and acceptance**

- A new model has `{ name: '', age: 18 }`; construction does not pretend defaults
  have passed validation.
- Initial full validation fails; after writing name=Ada, full validation succeeds.
- Ages 17, NaN, and Infinity are rejected while committed age remains 18; 21 succeeds.
- Consumer compilation succeeds. name/age retain string/number types; evaluator-side
  negative type checks reject unknown setter keys and incompatible values.

**Failure patterns**: importing rules from the root; treating `type` as runtime
validation; assuming defaults were validated.

### AI-02 — Preserve and handle rejected input

**Task prompt**

> Implement a name editor model defaulting to Ada, with required then minimum
> length 3 rules. Let callers read the committed name, rejected input, current
> errors, and subscribe to validation errors. Support clearing rejected-input
> records and entering a valid replacement, preserving the library's error and
> event semantics.

**Fixed inputs and acceptance**

- Writing Bo returns false: committed name remains Ada, dirty name is Bo,
  and a length error exists.
- An empty string violates both rules but only the first error is reported.
  Ordinary validation failure resolves false rather than being treated as an exception.
- `clearDirtyData()` empties dirty data without changing committed data or existing errors.
- Writing Grace clears that field's dirty data and errors. Unsubscribed listeners
  receive no further notifications.

**Failure patterns**: mutating data directly; using dirty data as UI draft storage;
inventing `commitDirty`; assuming dirty clearing clears errors.

### AI-03 — Update related fields in a batch

**Task prompt**

> Implement a password-change model. password defaults to old-password, is trimmed,
> and must contain at least eight characters. confirm defaults to old-password
> and must match the new password in the same batch. memo defaults to old.
> Support one batch write, preserving independent field commits. Report unknown
> fields through the library's exceptional-write path.

**Fixed inputs and acceptance**

- `{ password: '  new-secret  ', confirm: 'new-secret' }` succeeds; confirm sees
  the transformed candidate password.
- Next, `{ password: 'next-secret', confirm: 'wrong', memo: 'saved' }` returns false.
  Password and memo commit; confirm stays new-secret and dirty.confirm is wrong.
- On a fresh model, a batch containing unknownField emits `field:not-found` and
  rejects, leaves all values unchanged, and invokes no instrumented transforms.
- The evaluator supplies unknown keys through a runtime fixture; the agent need
  not bypass TypeScript to construct them.

**Failure patterns**: sequential setters for a cross-field update; checking old
data; rolling back valid fields.

### AI-04 — Implement a cart computation chain

**Task prompt**

> Implement a cart model with price=10, quantity=2, and discount=2.
> subtotal is price times quantity; total is subtotal minus discount.
> Subtotal must not exceed 100, and invalid derived results must preserve valid
> committed values. Declare all dependencies through reactions, use a 10ms
> reaction debounce, and provide a business function that updates the cart and
> returns the completed calculation.

**Fixed inputs and acceptance**

- After initialization settles, subtotal/total are 20/18.
- Writing `{ price: 20, quantity: 3, discount: 5 }` returns 60/55 through the
  business function; changing only discount to 10 returns 60/50.
- Changing price to 200 and quantity to 1 rejects the derived subtotal of 200,
  preserves subtotal/total at 60/50, and records dirty.subtotal=200.
- Computed functions are synchronous and contain no I/O or model writes.
  Manual synchronization of derived fields does not replace reactions.

**Failure patterns**: missing dependencies; async computed; returning downstream
values after waiting only for the setter; guessing settlement with a delay.

### AI-05 — Integrate async username availability

**Task prompt**

> Implement a username model defaulting to guest, using an injected async
> availability service. Start new validation immediately during successive edits.
> Final committed values, rejected input, and errors must reflect the latest edit.
> The caller controls service completion order; do not serialize user input.

**Fixed inputs and acceptance**

- Write alice, then bob before alice finishes. Both service requests must start.
- Scenario A: bob returns available first, then alice unavailable. Final value
  is bob with no dirty data or errors.
- Scenario B uses a fresh model: bob returns unavailable first, then alice available.
  Final value remains guest, dirty input is bob, and the error belongs to bob.
- No unhandled rejection remains. Do not infer current state from the result
  of an already superseded setter.

**Failure patterns**: bypassing model commits after network responses; global
availability state; equating last response with latest input.

### AI-06 — Calculate shipping from a postcode

**Task prompt**

> Implement a shipping model with postcode='', base=100, fee=0, and total=base+fee.
> Derive requestKey by trimming postcode. An empty postcode skips the computation
> and preserves the last quote. Validate on requestKey that nonempty postcodes contain five digits.
> After a valid result, use an action to call the injected quote service, write
> fee, then call async audit with that fee. External callers can await the whole
> flow and observe quote failures. The caller controls services; request
> cancellation is not required.

**Fixed inputs and acceptance**

- Empty defaults make no request. Entering ` 10001 ` calls quote with 10001.
  A quote of 12 produces fee/total=12/112 and audit receives 12.
- External `settled()` stays pending while quote or audit is pending; final
  derived values are ready when it resolves.
- With no pending work, an empty input makes no new request and preserves results.
  Input abc fails requestKey validation and starts no action for that invalid result.
- A rejected quote on a fresh model is observable through `reaction:error` and
  the owning field's errors, preserving fee. `settled()` need not reject.
- Quote, writeback, and audit are explicitly sequenced. Actions/validators do not
  await the same model's `settled()` or `validateAll()`. Skips and invalid input
  are not required to cancel previously queued work.

**Failure patterns**: unreturned requests; assuming serial action arrays;
expression bodies returning `Promise<boolean>`; waiting for a task set that
includes the action itself.

### AI-07 — Bind a controlled amount input

**Task prompt**

> Implement an amount text input. The model defaults to 10, commits finite
> nonnegative numbers, and uses injected async validation. Transforming text !
> throws Invalid amount text. Display edits immediately and preserve invalid text
> as well as the user's numeric formatting after success. Show errors after blur,
> handling both validation failure and exceptional writes. Use the library's
> recommended text binding.

**Fixed inputs and acceptance**

- Text 3.50 appears before the service responds; after success, data is number 3.5
  while text remains 3.50.
- Input -1 preserves that text and committed 3.5, records numeric dirty -1,
  and shows the validation error after blur.
- Input ! shows the write-error message without an unhandled rejection.
  That exception is not misrepresented as model dirty data.
- Valid input 4 recovers. An external commit of 8 updates the text when no local
  edit remains in flight.
- Validation metadata updates the error UI even if committed data did not change.
  Validate mounted behavior, not just SSR.

**Failure patterns**: binding directly to committed values; missing numeric
transform; rendering only meta.error; treating `setDraft` as a Promise.

### AI-08 — Submit an actively edited form

**Task prompt**

> Implement submission for the starter's form model and inputs. Include untouched
> fields, pending input validation, and async calculations. Call save only when
> both the input layer and model are valid. Disable editing and duplicate
> submission throughout the operation, releasing the lock on success or failure.
> Preserve the inputs' write-error state and display failures.

**Fixed inputs and acceptance**

- An untouched required empty name prevents saving. An input-layer write error
  also prevents saving even when the model's previous value is valid.
- The fixed valid inputs are name=Ada, price=20, quantity=3; a pending quote
  supplies fee=12. Once barriers resolve, the saved payload is
  `{ name: 'Ada', price: 20, quantity: 3, fee: 12, total: 72 }`.
- Full validation starts after existing input and initialization work settles.
  A false result or rejection prevents save.
- Two submissions while pending cause only one save, with editing disabled.
  A rejected save releases the lock and permits editing and retry.
- Follow the one-pass full-validation contract; do not require automatic
  revalidation of all cross-field rules after action writeback.

**Failure patterns**: checking only an empty error map; capturing payload too early;
skipping defaults; duplicate saves; failing to release the lock on exceptions.

### AI-09 — Own independent editor lifecycles

**Task prompt**

> Implement a React editor owned by recordId, using the injected model factory
> and event recorder. Record A starts at Ada and B at Bob. Two simultaneous
> editors work independently; routing from A to B changes the instance, and
> unmounting stops updates. Support React StrictMode and create/release models
> and subscriptions according to their actual owner lifecycles.

**Fixed inputs and acceptance**

- Editing simultaneous A/B instances is isolated; switching A→B retains neither
  A's values nor its errors.
- After StrictMode's repeated effect setup/cleanup, the displayed instance
  remains editable.
- Observe cleanup through the injected factory and recorder: retired models
  are disposed, subscriptions removed, and old requests finishing after unmount
  update neither unmounted UI nor the new instance.
- Do not require a fixed construction count or assume disposal cancels started requests.

**Failure patterns**: module singletons; disposing a new instance in old cleanup;
creating models with initialization effects during render; assuming Provider owns models.

### AI-10 — Display selections that follow props

**Task prompt**

> Implement ItemPrice and AmountError using the starter's model. Initial items
> have prices a=10 and b=20, note defaults to an empty string, and amount defaults
> to 10 and must be a finite nonnegative number.
> ItemPrice selects by its id prop and returns an object-shaped selection.
> Model notifications for unrelated note changes should not rerender ItemPrice.
> AmountError displays validation errors even when rejected input does not commit.

**Fixed inputs and acceptance**

- Changing only id from a to b, without a model write, updates displayed 10 to 20.
- Replacing items so b=21 displays 21. Updating note adds zero ItemPrice renders.
- Invalid amount input shows an error while committed amount stays unchanged;
  correction removes the error.
- Accept different Hook combinations that satisfy current props, selection
  equality, and error subscription behavior. Avoid absolute StrictMode render counts.

**Failure patterns**: stale selectors; new selection objects without equality
handling; subscribing only to data for errors.

### AI-11 — Compose precisely typed business schemas

**Task prompt**

> Split a model into composable identity and order schema modules, then create
> independent instances through a factory. Fields are name='Ada', status='draft'
> (draft/published only), a string note without a default, address={city:'Hangzhou'}, and
> lines=[{sku:'book',qty:1}]. Preserve inferred schema types. Provide city-update
> and line-append functions whose changes the model can observe. Do not mutate
> schemas belonging to existing models when reusing configuration.

**Fixed inputs and acceptance**

- name is string, status is `'draft' | 'published'`, note is `string | undefined`,
  address.city is string, and line items are `{ sku: string; qty: number }`.
- Negative type checks reject invalid status literals, qty types, and unknown
  setter keys. No explicit generic misrepresents defaults or assertions conceal unknown/any.
- City updates and line appends use top-level replacement and trigger subscribers;
  a second instance stays unchanged.
- Runtime validation rejects external invalid status values; enum metadata
  does not substitute for validation.

**Failure patterns**: widened fragment annotations; nested mutation or push;
runtime schema edits; assuming shallow freezing is deep freezing.

### AI-12 — Migrate and repair a legacy cart integration

**Task prompt**

> Migrate the starter's legacy cart integration to the installed version and fix
> calculation and saving. Preserve fields and exports: price=10, quantity=2,
> with derived subtotal and total. Price must be finite and nonnegative; quantity
> must be a positive integer. Price=20 and quantity=3 produce 60 for both derived fields.
> Both derived fields share the same save function, called once per calculation
> phase with settled data. Preserve subscription cleanup and report unknown-field
> exceptions and ordinary validation failure. Do not modify library code or
> dependency versions.

**Fixed inputs and acceptance**

- The legacy fixture contains root rule imports, strictMode/failFast,
  a single-element reaction array, a single action function with old parameter
  usage, subscribeField, and misspelled dependency quantitiy.
  These are faulty inputs, not capabilities promised by the target version.
- The result compiles and runs. After initial settlement, clear save records,
  batch-update price/quantity, and observe subtotal/total=60/60 with one shared
  save invocation reading final data.
- Recreate the model after fixing its dependencies. Unsubscription works,
  unknownField rejects, and price=-1 returns false while preserving committed 20.
- Do not disable checks, change versions, or add core compatibility APIs.
  The migration explanation distinguishes the target tarball from published versions.

**Failure patterns**: copying outdated tutorials; distinct wrappers defeating
reference deduplication; assuming computed inputs infer missing dependencies;
patching a live schema.

## Acceptance, metrics, and records

A submission passes a task only when all these conditions hold:

- **Types**: the consumer compiles and evaluator-side positive/negative type
  assertions behave as expected.
- **Behavior**: all task assertions pass; React tasks are mounted.
- **Integration constraints**: public entry points only; no environment/evaluator
  tampering, type escapes, hardcoded outputs, or replacements for required library capabilities.
- **Cleanup**: no unhandled rejection, leaked subscription, or task timeout after
  fixture cleanup.

Prefer compilation and observable behavior. Combine static checks and manual
review for purity, public imports, and type escapes; do not require specific
variable names, formatting, or line-by-line similarity to the reference.

| Metric | Definition |
| --- | --- |
| First-submission pass rate | Valid attempts passing at their first frozen submission / valid attempts |
| Final pass rate within two repairs | Valid attempts passing initially or after at most two repairs / valid attempts |
| Repair rounds | Per-task distribution of 0 / 1 / 2 / unrepaired |
| Misuse distribution | Evidence-tagged missing APIs, wrong imports, type escapes, contract mistakes, waiting errors, UI errors |
| Delivery cost | Active agent time, tool calls, and input/output tokens when available; otherwise unavailable |
| Coverage and blockers | Completed, unrun, and BLOCKED counts out of 36 planned attempts, with reasons |

FAIL is a valid attempt and stays in the denominator, including agent time-budget
exhaustion. Reserve BLOCKED for confirmed environment, tool, or fixture failures;
report it separately and exclude it from rate denominators. Compare only matching
coverage and configuration. A complete v1 baseline requires 36 valid results.
Do not invent a target score before measurement or compress tasks into an arbitrary weighted score.

Record at least:

```text
suite_version, task_id, repeat_id, prompt_language, prompt_hash
starter_hash, evaluator_hash, reference_check
source_commit, source_diff_hash, package_version, tarball_name, tarball_sha256, docs_hash
consumer_lock_hash, node_version, package_manager_version
typescript_version, react_version, test_tool_versions
agent_product, agent_model, agent_config_hash, tool_policy_hash
initial_status, final_status, repair_rounds, failure_tags, blocked_reason
active_duration, evaluator_duration, tool_calls, token_usage
submission_paths, diagnostic_log_paths
```

Preserve the first submission and each repair, unfiltered compiler/acceptance
output, and tool records. Attribute failures using concrete evidence. Label
documentation, type-system, or library gaps only when observed; an agent failing
to find a rule does not establish that the documentation omitted it.

## Readiness checklist and extensions

- [x] Fix 12 tasks, prompts, inputs, and acceptance criteria.
- [x] Define isolation, repair rounds, scoring, records, and version identification.
- [x] Implement starters, service mocks, hidden checks, and reference solutions; freeze hashes.
- [x] Build the target tarball, pin consumer environments/toolchains, and verify references.
- [x] Run 36 independent attempts, retain initial/repair evidence, and publish measured results.

Expand based on observed failures: IME composition coordination, request cancellation
and stale action responses, SSR/Suspense, action reentrancy, DevTools diagnosis,
large schemas, and cross-model orchestration. These do not enter the v1 denominator.
Explicitly state application responsibilities instead of presenting them as
default library capabilities.

Evaluate agents modifying the library in a separate suite, keeping consumer
integration difficulty distinct from maintenance difficulty.
