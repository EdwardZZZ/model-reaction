# API Reference

Reference for the public `model-reaction` API surface.

[中文版本](API_CN.md) | English

[← Back to README](../README.md)

---

## Table of Contents

- [createModel](#createmodel)
- [Model Methods](#model-methods)
- [Reactions](#reactions)
- [Events](#events)
- [ModelOptions](#modeloptions)
- [Validation Rules](#validation-rules)
- [Error Formatting](#error-formatting)
- [Type Definitions](#type-definitions)
- [API simplification migration](#api-simplification-migration-unreleased)

---

## createModel

The factory function that creates a model instance.

```typescript
createModel<T>(schema: Model<T>, options?: ModelOptions): ModelReturn<T>;
createModel<S extends Record<string, FieldSchema> & Record<symbol, never>>(
  schema: S,
  options?: ModelOptions
): ModelReturn<InferModelData<S>>;
```

The first argument is one flat schema object, with each top-level property
representing one model field. Large schemas may be split into focused fragments
and merged with object spread before being passed in. Object and array field
values may still contain nested data, but the model tracks changes only at the
top level.

Fields are own enumerable string keys; numeric literal keys are supported and
use JavaScript's string representation at runtime. For `{ 0: ... }`, call
`setField(0, value)` and use `'0'` in reaction dependencies and event filters.
Symbol fields are unsupported and rejected by the schema types.

### Data type inference

Without an explicit type argument, each field's read type combines its type
tag, its default, and its declared `computed` results. Array/object defaults
retain their element/property types; a different computed shape adds a union
member. `SKIP_REACTION` is excluded. An absent default adds `undefined`, even
for derived fields, because reads can occur before initialization settles.
Schema unions distribute through these rules. `data`, `getField`, setters,
selectors, and field events all use the resulting data type.

An optional default retains its declared type rather than being treated as
absent. Annotating a fragment as `FieldSchema<'string'>` widens its default to
`unknown`, so the inferred read type becomes `unknown`. Prefer `satisfies` to
check the fragment while preserving its actual default:

```ts
const textField = () =>
  ({ type: 'string', default: null } satisfies FieldSchema<'string'>);
const model = createModel({ label: textField() });
// model.data.label: string | null
```

For fragments containing enums, objects and arrays, `satisfies` does not
automatically narrow enum defaults; a default widened to string also widens the
read type. The compiled [schema composition recipe](../examples/SCHEMA_COMPOSITION.md)
preserves enum literals, mutable array elements and fields without defaults,
with explicit runtime validation.

An explicit `createModel<T>(schema)` returns `ModelReturn<T>`. `Model<T>` checks
that the field keys exist and definitions are valid; it does **not** relate
each definition's tag, default, or transform to `T[K]`. The caller promises that
defaults, transformed inputs, and computed results fit `T`, including
`undefined` for fields that may be read before receiving a value. Prefer schema
inference when that promise cannot be maintained. Untyped transforms and `any`
computed results remain unchecked boundaries; this is not runtime validation.

### Schema lifetime

Schema is static configuration for a model instance. Finish composing it before
calling `createModel`. From the start of that call until the instance is
disposed, keep the configuration unchanged through every reference to it:

- The field keys and field definitions, including `type`, `default`, `values`,
  `transform`, `validator`, and `reaction`.
- Array contents and order: enum values, validators, reaction dependencies, and
  actions. Validator properties such as `type`, `message`, `condition`, and
  `validate`, and reaction function references also remain fixed.
- Mutable default contents and shared configuration objects, including schema
  fragments and rule instances. Replacing a definition, pushing into an array,
  or editing a shared rule all count as configuration changes. Accessors or
  proxies must not return changing definitions.

The same schema, fragments, rules, and functions may be reused by multiple
instances while their configuration stays unchanged. To change configuration,
create a new schema and a new model instance. Object spread copies only one
level: replace the changed nested definitions instead of mutating references
shared with an existing model.

This is a caller obligation. `createModel` does not deep-clone, freeze, observe,
or provide a live-update API for schema configuration. Current TypeScript types
do not enforce this lifetime contract. Post-creation schema mutation is
unsupported; callers must not rely on whether it takes effect, is ignored, or
throws. Reaction indexing and DevTools metadata are built at creation, while
some write-time configuration is read later, so mutation can affect only part
of an instance.

Default cloning is separate from schema ownership. Arrays and plain objects
are recursively cloned, with cycle handling; `Date`, `RegExp`, class instances,
and other non-plain objects remain shared references treated as immutable
leaves. This is not a complete schema or value snapshot. Update model values
through `setField` / `setFields`, without modifying `schema[field].default` or shared
default leaves in place.

Fixed function references do not freeze model data or action closure state.
Express dynamic validation conditions through model fields and
`validator.condition`; revalidate affected fields explicitly or call
`validateAll()` when those inputs change. Declare changing computed inputs in
`reaction.fields`.
`computed` remains synchronous and pure. Actions can read current model data
and business services through closures; closure reads do not automatically
create dependencies or trigger recalculation.

> **Defaults bypass validation.** Each field's `default` is written directly
> into `data` at construction — validators do **not** run against it. A model
> can therefore start in an invalid state while `validationErrors` is empty.
> Before trusting initial `data`, wait for initialization with
> `await settled()`, then call `await validateAll()`.
>
> **Initial reactions propagate through unchanged values.** Non-derived
> defaults start the initial reaction pass. A successfully validated derived
> value continues that pass even when it equals its own default, without
> emitting a field change for that unchanged value. Initialization survives
> rescheduling; use `await settled()` to wait for the complete chain.
>
> **`FieldSchema.type` is metadata, not a runtime validator.** It drives
> TypeScript inference and tooling. Add an appropriate `ValidationRules` entry
> or custom `Rule` when values must be checked at runtime.
>
> **Reaction output is validated.** A field's `reaction.computed` result is
> committed through the same validate-then-commit path as `setField`. If the
> derived field declares a `validator` and the computed value fails it, `data`
> keeps its previous value and the computed value is stored in `dirtyData`.
> Successful validation and commit queue the reaction's actions for execution
> after calculation settles, deduplicating pending functions by reference.
> A failed value fires neither the derived field's change nor its `action`.

## Model Methods

### Read

| Method | Description |
| --- | --- |
| `getField(field)` | Read the current value of one field. |
| `get data` | Read a stable, shallow-frozen copy of the field map. Fields without defaults may be `undefined`. |
| `get validationErrors` | Read frozen validation errors grouped by field. |

`data` and `validationErrors` are getter-only properties. Every declared field
is an enumerable own property of `data`, initially `undefined` when no default
is supplied. This includes `constructor`, `__proto__`, and `toString`; direct-write
candidate snapshots preserve the same field map. Snapshots keep the ordinary
object prototype. Seeding `undefined` does not start initial reactions.

Error snapshots preserve earlier results. Each field's frozen error array keeps
its reference until that field's errors are cleared or replaced; updates to
another field do not recreate it.

This library supports shallow model data and tracks field-level replacements.
Object, array, and mutable built-in
field values such as `Date` are opaque to the model: mutating them in place is
not observed and does not trigger validation, reactions, or subscriptions.
Replace the whole field value with `setField()` or `setFields()` when it changes.
The outer `data` and dirty-data records are shallow-frozen; field values
themselves are not frozen.

Replacement values are compared structurally for plain objects, arrays,
`Date`, and `RegExp`. Other objects, including `Map`, `Set`, and class
instances, are compared by reference: a new instance is treated as a change.

### Write

| Method | Description |
| --- | --- |
| `setField(field, value): Promise<boolean>` | Set a single field; returns its validation result. |
| `setFields(fields): Promise<boolean>` | Batch set multiple fields in one validation + reaction pass; returns the AND of every field's result. Cross-field validators see the **merged batch** — each field validates against `data` with all fields in the same call already applied, so co-dependent fields (e.g. `password` / `confirmPassword`) can be set together in one call. **Not atomic** — valid fields commit to `data` even if a sibling field fails validation. |

`setField()` delegates to the single-entry `setFields()` flow. Conditions and
validators share one shallow-frozen candidate snapshot: committed data merged
with every transformed input in this call, including the field being validated.
These candidates have not necessarily passed validation. `validateAll()` merges
committed and dirty data without transforming values again. Validators must
remain pure and must not mutate the snapshot or its nested field values.
They must not await the same model's `settled()` or `validateAll()`: these
global waits include the validator's own task.

All input keys must be own fields of the schema. An unknown key emits
`field:not-found` and rejects the whole call before any transform, validation,
or commit starts; the first unknown key in input order is reported. A transform
exception also rejects rather than becoming a validation error or dirty input.
For known fields, ordinary validation failures resolve `false` and still allow
valid siblings to commit. The batch drains started validations and registers
reactions before releasing its calculation task, including rejection paths.

### Reactions

A field can have at most one reaction. It runs when one of the fields in its
`fields` list changes. Arrays, including empty arrays, throw a `TypeError` naming
the field during construction, before defaults or asynchronous work start:

```ts
total: {
    type: 'number',
    reaction: {
        fields: ['price', 'quantity'],
        computed: ({ price, quantity }) => price * quantity,
    },
}
```

`computed` must run synchronously and remain pure: it reads only the
dependencies declared in `fields` and returns the target field's next value.
Returning a Promise is reported through `reaction:error`, and no result is
committed. Other side effects, such as requests, logging, or external-state
mutations, cannot be detected at runtime and must be avoided by the caller. Put
asynchronous work and other side effects in `action`, an array of functions
receiving `{ field, value }`. Each returned PromiseLike is tracked by
`settled()`, and a rejection is reported through `reaction:error`.

Return the package-level `SKIP_REACTION` export to conditionally stop the
current reaction:

```ts
import { SKIP_REACTION } from 'model-reaction';

computed: ({ enabled, source }) =>
  enabled ? String(source).trim() : SKIP_REACTION
```

`SKIP_REACTION` is a normal no-op: the target field is not validated or
written, `dirtyData` is unchanged, and no `field:change`, downstream reaction,
or current reaction `action` is triggered. Previously queued functions remain
in the action queue.

#### Result types

TypeScript checks the `computed` result against the field's `type`:
`string`, `number`, `boolean`, `Date`,
`object`, or a readonly array, plus `SKIP_REACTION`. `enum` results are not
checked. `values` is typed as `Record<string, any>`, so a result read straight
from it (`(v) => v.name`) is `any` and also passes unchecked.

```ts
total: {
    type: 'number',
    // ❌ Type error: a number field cannot derive a string.
    reaction: { fields: ['price'], computed: ({ price }) => `${price}` },
}
```

The check is strict: `null` and `undefined` are rejected even when the data
type allows them. A standalone reaction can declare its result type with
`Reaction<T>`; it then fits only fields of that type. A bare `Reaction` (that
is, `Reaction<any>`) is unchecked and is the escape hatch for nullable derived
values:

```ts
import type { Reaction } from 'model-reaction';

const label: Reaction = {
    fields: ['price'],
    computed: ({ price }) => (price > 0 ? `$${price}` : null),
};
```

A function declared outside the schema that returns `SKIP_REACTION` infers the
return type `symbol`; annotate it as `(): typeof SKIP_REACTION`. Check schema
fragments with `satisfies FieldSchema<'string'>` to preserve the tag and default
type when spreading them and adding reactions; see [Data type inference](#data-type-inference).

Repeated triggers can overlap validations of the same reaction. Validation
request IDs decide which write can commit. Only a successful computation queues
its actions; a later skip or failure does not remove previously queued functions.
Debouncing keeps one pending computation per host, replacing it and restarting
the window on another trigger. An already started action may overlap with later
updates; `settled()` still waits for its returned Promise.

#### Action queue

```ts
import { createModel } from 'model-reaction';
import type { ReactionAction } from 'model-reaction';

const saveTotal: ReactionAction<number> = async ({ value }) => {
  const { price, quantity } = model.data;
  await saveAmount({ price, quantity, total: value }); // application-provided function
};

const model = createModel({
  price: { type: 'number', default: 10 },
  quantity: { type: 'number', default: 2 },
  total: {
    type: 'number', default: 0,
    reaction: {
      fields: ['price', 'quantity'],
      computed: ({ price, quantity }) => price * quantity,
      action: [saveTotal, ({ field, value }) => { console.log(field, value); }],
    },
  },
});
await model.settled();
```

The public signatures are:

```ts
type ReactionAction<T = any> = (context: {
  field: string;
  value: T;
}) => void | PromiseLike<void>;
// Reaction<T>.action?: ReactionAction<T>[]
```

`field` is the field that owns the action: for `price → total`, `total.action`
receives `'total'`. `value` is read immediately before each call from that
field's latest committed state, including transforms. It is not saved at
registration, so a direct host write while the action is queued is reflected
in the argument. Each call captures its own value; later writes do not update
that context. Object values retain their model reference and must not be
mutated in place.

`Reaction<T>` remains an interface; its `T` constrains both `computed` and the
action's `value`. A bare `ReactionAction` leaves the value unchecked. Existing
no-argument functions remain valid and can ignore the context. Read other
fields through a model closure; neither context nor closure reads add
dependencies. Declare trigger fields in `fields`.

After a computed value validates and commits, its functions enter a queue shared
by the model. Successful initialization and equal computed values also queue
actions. A skipped, failed, or stale write queues nothing. Empty arrays do nothing.
Direct writes do not cancel queued functions or start actions for that field;
their downstream reactions can queue actions as usual.

The queue uses function reference identity. A later registration replaces the
earlier pending record and moves it to the end, including the host field passed
in the context and used for error reporting. Registration order means arrival
after successful validation and commit, not reaction scheduling or schema field order.
For example, `[save, log, save]` calls `log` then `save`. Distinct wrappers are
distinct functions. Deduplication applies only while queued: an already started
function can be queued again and overlap its earlier returned Promise.

Overlapping input validation, batch commits, reaction debounce, computation,
and computed-value validation form one calculation phase. When it becomes idle,
a microtask takes and clears the queue, then calls every function in order
without waiting for earlier results. The first call occurs after `createModel`
returns, so initialization closures can read `model`. A write started by one
action does not pause the rest of that batch. Actions queued during a flush
belong to a later flush after calculation becomes idle again.

Each returned PromiseLike remains tracked by `settled()`. An exception or
rejection does not stop other functions. It appends `reaction_error` to the
recorded host's `validationErrors` before emitting `reaction:error`. A late
error can accompany a newer successful value. After `dispose`, queued calls
are discarded and returned rejections are still observed, but errors and events
are no longer recorded; pending `settled()` calls are released immediately.

Array items are independent calls. Put dependent operations in one function and
sequence them with `await`. `await model.setField()` waits for that write, and
its downstream computation may still be running; no new calculation barrier is
provided between array items. Capture `const data = model.data` at function entry
when one request needs consistent top-level values; the snapshot includes
transformed committed values and is only shallow-frozen. Nested values must not
be mutated in place.

For writeback, use `async () => { await model.setField('field', value); }`.
An expression returning `Promise<boolean>` does not fit `ReactionAction` and
may create circular schema inference. Never await the same model's `settled()`
or `validateAll()` inside an action: both wait for that action's returned Promise.
Only returned or awaited business Promises are tracked. Cancellation of requests, stale response
protection, and writeback cycles remain application responsibilities.
For side effects without a derived field, use `model.subscribe`; its callback
Promises are not included in `settled()`.

### Validation

| Method | Description |
| --- | --- |
| `validateAll(): Promise<boolean>` | Validate every field once, wait for all tracked model work, and return the final result. |
| `getDirtyData(): Partial<T>` | Get a stable, shallow-frozen snapshot of values that failed validation. |
| `clearDirtyData(): void` | Clear all dirty data records. |

For submission, wait for existing inputs and initialization before creating
the full-validation candidate snapshot:

```ts
await model.settled();
const valid = await model.validateAll();
if (!valid) return;
await api.save(model.data);
```

`validateAll()` validates a shared snapshot of committed and dirty values once,
commits valid fields independently, then waits for tracked calculations,
actions, and writebacks. The wait is global: overlapping work and already
running actions from earlier flushes are included. There is no
implicit wait before taking the candidate snapshot.

The result is `true` only if this pass succeeded, no dirty values remain, and
every field's error array is empty after settlement. A failed pass stays
`false` even if later work repairs its fields. Computation or action failures
use existing error reporting; remaining errors or failed writebacks make the
result `false`. An exceptional batch rejection waits for tracked work before
propagating the original exception, without `validation:complete`.

This is one full pass followed by settlement, not repeated validation of the
final data. Action writebacks validate their written fields; they do not
revalidate untouched cross-field rules. Complete related corrections before
full validation or write the related fields together with `setFields()`.
The application must pause editing, prevent duplicate submissions, and handle
input-layer write errors separately; see [Submission Flow](REACT.md#submission-flow).

Disposal during a normally completing call returns `false` and suppresses
`validation:complete`. It releases settlement waits immediately, but does not
cancel a field validator already awaited by the batch: that validator must
return or reach `asyncValidationTimeout` first. Calling after disposal still
rejects with the existing disposed error.

### Subscription

| Method | Description |
| --- | --- |
| `subscribe(selector, callback, isEqual?)` | Observe a selected value, compared with `Object.is` by default. The callback receives `(next, prev)`; returns an unsubscribe function. |
| `on(event, callback)` | Observe typed event payloads, including errors, validation, and field changes; returns an unsubscribe function. |

Single fields and derived values share `subscribe`:

```ts
const off = model.subscribe((data) => data.name, (next, prev) => {
  console.log(prev, '→', next);
});
off();
```

Use `on('field:change', handler)` and check the payload's `field` when raw
field events are needed. `useModelSelector` uses model-side filtering;
`useModelComputed` subscribes directly to field events. Both share snapshot
comparison logic.

### Lifecycle

| Method | Description |
| --- | --- |
| `settled(): Promise<void>` | Wait for all pending or cascading reactions, async actions, and async validations to complete. |
| `dispose(): void` | Release timers, listeners, and internal state. |

## Events

Subscribe via `model.on(eventName, handler)`.

Field names in events are strings, including numeric schema keys.
`field:change` is a discriminated union: checking `event.field` narrows
`event.value` to that field's data type. Keep the pair together when forwarding
events so the relationship is preserved.

| Event | Triggered when |
| --- | --- |
| `field:change` | A field value changes. |
| `field:validation-complete` | A field validation finishes, including batch operations and reactions, even when its value did not change. Payload includes `field`, `isValid`, and whether the field remains dirty. |
| `dirty-data:cleared` | `clearDirtyData()` removes one or more dirty values. Payload lists the affected fields. |
| `validation:complete` | `validateAll()` finishes after tracked work settles; `isValid` matches its final boolean. Not emitted on batch rejection or disposal. |
| `validation:error` | A validation rule fails. |
| `reaction:error` | A reaction throws or rejects. |
| `dependency:error` | A reaction dependency is misconfigured. |
| `field:not-found` | `setField` or `setFields` attempts to write a field absent from the schema. |

The final result is checked immediately before `validation:complete`. A
listener's writes, disposal, or new calls are subsequent operations; this
validation call does not wait again for work started by its completion event.
Use the event to observe the result, and keep submission-time updates outside it.

## ModelOptions

```typescript
interface ModelOptions {
  debounceReactions?: number;
  asyncValidationTimeout?: number;
}
```

| Option | Default | Description |
| --- | --- | --- |
| `debounceReactions` | `0` | Debounce window (ms) for reaction triggers. |
| `asyncValidationTimeout` | `5000` | Timeout (ms) for async validators. |

## Validation Rules

`ValidationRules` is a collection of reusable built-in rules, and `Rule` is the
class behind them. Both are exported from `model-reaction/validation`:

```typescript
import { ValidationRules, Rule } from 'model-reaction/validation';
```

Each rule implements the `Validator` interface, so it can be dropped straight
into a field's `validator` array.

Rules run in declaration order, evaluating each `condition` immediately before
its `validate`. A false condition skips that rule. The first condition exception,
failed validation, exception, or timeout stops the field; later rules are not
evaluated. Errors retain their array shape. Async rules in one field run
sequentially; different fields can validate concurrently. Put cheap synchronous
checks first, and combine independent requests inside one validator if needed.

### Built-in rules

| Rule | Form | Passes when |
| --- | --- | --- |
| `required` | constant | value is not `undefined`, `null`, or `''` |
| `number` | constant | value is a finite number |
| `integer` | constant | value is a finite integer |
| `boolean` | constant | value is a boolean |
| `string` | constant | value is a string |
| `min(n)` | factory | numeric value `>= n` |
| `max(n)` | factory | numeric value `<= n` |
| `minLength(n)` | factory | string/array length `>= n` |
| `maxLength(n)` | factory | string/array length `<= n` |
| `pattern(regex, message?)` | factory | string matches `regex` |
| `email` | constant | value is a valid email string |

### Rule chaining

Every rule (constant or factory result) is a `Rule` instance with two chainable
helpers that return a **new** rule, leaving the original untouched:

| Method | Description |
| --- | --- |
| `.withMessage(message)` | Override the error message. |
| `.when(predicate)` | Only run the rule when `predicate(data)` is truthy — handy for cross-field conditional validation. |

```typescript
createModel({
  discountCode: {
    type: 'string',
    default: '',
    validator: [
      ValidationRules.required
        .withMessage('Code required when a discount is applied')
        .when((data) => data.hasDiscount === true),
    ],
  },
});
```

## Error Formatting

Formatting is independent from model state:

```typescript
import { formatValidationErrors } from 'model-reaction/validation';

const summary = formatValidationErrors(model.validationErrors);
const custom = formatValidationErrors(
  model.validationErrors,
  (error) => `[${error.field}] ${error.message}`
);
```

## Type Definitions

Publicly exported types include `Model`, `ModelOptions`, `ModelReturn`,
`Validator`, `Reaction`, `ReactionAction`, `FieldSchema`, `ValidationError`, `ModelError`,
`ValidationErrors`, `ModelErrorCode`, `ModelEventMap`, `ModelFieldKey`,
`ModelFieldName`, `InferFieldType`, and `InferModelData`.

`ModelFieldKey<T>` extracts string/number keys; `ModelFieldName<T>` is their
string representation. `ValidationErrors` is
`Readonly<Record<string, readonly ValidationError[]>>`, shared by model error
snapshots and the error formatter. `InferFieldType` combines tag-derived values
and computed results; `InferModelData` also accounts for initial defaults.

The core entry exports `createModel`, `ModelEvents`, and `SKIP_REACTION`.
`model-reaction/validation` exports `ValidationRules`, `Rule`,
`formatValidationErrors`, and the `ValidationErrorFormatter` type.

For full type definitions, see [`src/types.ts`](../src/types.ts).

## API simplification migration (Unreleased)

These changes are breaking and require updating consumers:

- Inferred object/array reads now include computed result shapes. Narrow the
  union before using shape-specific members. Fragments annotated with a broad
  `FieldSchema` may infer `unknown`; use `satisfies` to preserve their default
  types. Missing defaults still require handling `undefined`.
- Model/React field APIs accept string and numeric keys; symbols are rejected.
  Compare event fields with `String(key)` and preserve correlated field/value
  pairs when constructing `field:change` payloads.
- `data` and `validationErrors` properties are now `readonly`. Stop assigning
  to these getters; update values with setters. `Object.keys(model.data)` now
  includes every declared field, including unset fields. Filter values explicitly
  if an application needs only assigned fields; JSON still omits `undefined`.
- Finish schema composition before calling `createModel`. Runtime changes to
  fields, rules, dependency lists, or action arrays are unsupported; create a
  new schema and instance when configuration changes. Shared nested references
  must remain unchanged. See [Schema lifetime](#schema-lifetime).
- `validateAll()` now waits for all tracked model work after its full pass and
  includes remaining dirty values and errors in its boolean. Keep
  `await model.settled(); const valid = await model.validateAll();` before
  submission; remove the second settlement and repeated model error checks.
  Preserve UI write-error handling and submission locks.
  `validation:complete` now fires after settlement with the final result.
  Never await the same model's `validateAll()` or `settled()` inside actions
  or validators; move that orchestration to the external entry point.
  Gate-based callers must release action gates before awaiting full validation.
- Unwrap single-entry `reaction` arrays. Rewrite multiple rules as one business
  calculation or split independent results into separate fields; merging
  dependency lists mechanically does not preserve the old semantics.
- Remove `strictMode` and `failFast`. Unknown fields now always reject after
  `field:not-found`, before any field in that batch is prepared. Map external
  DTO keys before writing. Per-field validation always stops at the first error,
  with interleaved condition/validation evaluation rather than condition
  prefiltering; this also changes error priority for former `failFast: true` users.
- A single-field validator's `data[field]` now contains the transformed candidate,
  not the previous committed value. Move checks that require the old value to
  the business write entry point or provide an explicit business baseline.
  `validateAll()` does not transform dirty values again.
- React `DraftField` adds required `writeError: Error | null`; update manually
  constructed values and display `writeError?.message ?? meta.error`.
  `showError` is now gated by `touched` and either error source. See
  [React bindings](REACT.md).
- Structural field equality and both selector Hooks remain unchanged.
- Replace `action: fn` with `action: [fn]`. Read the owning field and its latest
  committed value from `{ field, value }`, and other fields through model
  closures. Existing no-argument callbacks remain valid. Direct callers must
  iterate the array and supply `{ field, value }` to each item. Actions wait for
  calculation to settle; repeated pending references
  merge instead of running after every intermediate successful computation.
  Host-version cancellation and sequential array execution have been removed:
  later skips, failures, or direct host writes leave queued functions intact.
  All functions in a flush are called without waiting for earlier results;
  combine dependent operations in one function and sequence them explicitly.
- Pending actions keep only the last registered occurrence of each function
  reference within a model. Use distinct wrappers when repeated array positions
  or host fields must each execute the function.
- Import `ValidationRules`, `Rule`, `formatValidationErrors`, and the
  `ValidationErrorFormatter` type from `model-reaction/validation`.
  Browser UMD consumers also load `dist/validation.js`; helpers are on the
  `ModelReactionValidation` global.
- Replace `model.subscribeField(field, callback)` with
  `model.subscribe(data => data[field], callback)`. The callback also receives
  the previous value. Use `on('field:change', handler)` with field filtering
  when callbacks must follow raw field events.
- `reaction.computed` results are now type-checked against the field `type`
  (see [Result types](#result-types)). Nullable results need a bare
  `Reaction`, and standalone functions returning `SKIP_REACTION` need a
  `(): typeof SKIP_REACTION` annotation. `FieldSchema` is now a union of
  per-tag variants, so `interface X extends FieldSchema` no longer compiles;
  use a type intersection or a single variant such as `FieldSchema<'string'>`.
