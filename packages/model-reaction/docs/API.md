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
createModel<S extends Record<string, FieldSchema>>(
  schema: S,
  options?: ModelOptions
): ModelReturn<InferModelData<S>>;
```

The first argument is one flat schema object, with each top-level property
representing one model field. Large schemas may be split into focused fragments
and merged with object spread before being passed in. Object and array field
values may still contain nested data, but the model tracks changes only at the
top level.

> **Defaults bypass validation.** Each field's `default` is written directly
> into `data` at construction — validators do **not** run against it. A model
> can therefore start in an invalid state while `validationErrors` is empty.
> Call `await validateAll()` before trusting initial `data`.
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
> Passing validation is necessary for `action` eligibility. Only the host
> field's latest scheduled reaction can start its group after calculation
> settles; a failed value fires neither the derived field's change nor its
> `action`.

## Model Methods

### Read

| Method | Description |
| --- | --- |
| `getField(field)` | Read the current value of one field. |
| `get data` | Read a stable, shallow-frozen copy of the field map. Fields without defaults may be `undefined`. |
| `get validationErrors` | Read frozen validation errors grouped by field. |

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
asynchronous work and other side effects in `action`, an array of no-argument
functions. Each returned PromiseLike is tracked by `settled()`, and a
rejection is reported through `reaction:error`.

Return the package-level `SKIP_REACTION` export to conditionally stop the
current reaction:

```ts
import { SKIP_REACTION } from 'model-reaction';

computed: ({ enabled, source }) =>
  enabled ? String(source).trim() : SKIP_REACTION
```

`SKIP_REACTION` is a normal no-op: the target field is not validated or
written, `dirtyData` is unchanged, and no `field:change`, downstream reaction,
or current reaction `action` is triggered. Scheduling this reaction also cancels earlier
action eligibility for the same host field, even when it skips.

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
return type `symbol`; annotate it as `(): typeof SKIP_REACTION`. Schema
fragment factories should return a single variant such as
`FieldSchema<'string'>`, so a spread fragment keeps its tag when a reaction is
added.

Repeated triggers can overlap validations of the same reaction. Validation
request IDs decide which write can commit; action eligibility separately follows
the host's latest scheduling version. A later `SKIP_REACTION` creates no write,
so an earlier valid write may still commit while its actions are cancelled.
A later computation that throws has the same separation. Debouncing keeps one
pending computation per host, replacing it and restarting the window on another
trigger. An already started action may overlap with later updates; `settled()`
still waits for its returned Promise.

#### Action groups

```ts
import { createModel } from 'model-reaction';
import type { ReactionAction } from 'model-reaction';

const saveTotal: ReactionAction = async () => {
  const { price, quantity, total } = model.data;
  await saveAmount({ price, quantity, total }); // application-provided function
};

const model = createModel({
  price: { type: 'number', default: 10 },
  quantity: { type: 'number', default: 2 },
  total: {
    type: 'number', default: 0,
    reaction: {
      fields: ['price', 'quantity'],
      computed: ({ price, quantity }) => price * quantity,
      action: [saveTotal, () => { console.log(model.data.total); }],
    },
  },
});
await model.settled();
```

The public signature is `type ReactionAction = () => void | PromiseLike<void>`
and `Reaction<T>.action?: ReactionAction[]`. `Reaction<T>` remains an interface;
its `T` only constrains `computed`. Actions receive no dependency projection,
result argument, or injected `computed` property. Their reads do not add
dependencies: declare trigger fields in `fields`.

Overlapping input validation, batch commits, reaction debounce, computation,
and computed-value validation form one calculation phase. When it becomes idle,
the scheduler attempts the eligible group for each host field. Each actual
reaction scheduling replaces the host's action version, including reactions
with no actions or an empty array. If the latest reaction skips, throws, returns
a Promise, fails validation, or loses its write, no earlier group is restored.
Later independent updates can start new groups.

Successful initialization and equal computed values remain eligible. The first
action call occurs after `createModel` returns, so initialization closures can
read `model`. Direct successful value changes through `setField`, `setFields`,
or dirty-value promotion in `validateAll` cancel the host's pending and remaining
items without starting actions themselves. Equal or failed direct writes do not
cancel them. Computed writeback does not invalidate its own group.

Each item, including the first, checks the host version and waits for calculation
to become idle immediately before its no-argument call. It then waits for that
item's PromiseLike before considering the next item. An unrelated calculation
pauses remaining items; a new host version cancels them. Already started
functions continue, and a new valid group starts from index zero without waiting
for an old function to finish. Duplicate function references execute once per
array position; empty arrays do nothing.

Groups ready in the same scheduler turn are attempted in schema field order.
Each group waits independently for its own Promise. A synchronous write starting
new calculation pauses other ready items. An exception or rejection stops only
that group. It appends `reaction_error` to the host's `validationErrors` before
emitting `reaction:error`, even if that action's version has since expired.
A late old error can therefore accompany a newer successful value. After
`dispose`, returned rejections are still observed, but errors and events are
no longer recorded; pending `settled()` calls are released immediately.

The barrier protects entry to each array item. An ordinary `await` inside an
item does not protect later reads: `await model.setField()` waits for that write,
and its downstream computation may still be running. Put a later operation in
the next array item to get a new calculation barrier. Capture `const data =
model.data` at function entry when one request needs consistent top-level values;
the snapshot includes transformed committed values and is only shallow-frozen.
Nested values must not be mutated in place.

For writeback, use `async () => { await model.setField('field', value); }`.
An expression returning `Promise<boolean>` does not fit `ReactionAction` and
may create circular schema inference. Never await the same model's `settled()`
inside an action: it waits for the current group itself. Only returned or
awaited business Promises are tracked. Cancellation of requests, stale response
protection, and writeback cycles remain application responsibilities.
For side effects without a derived field, use `model.subscribe`; its callback
Promises are not included in `settled()`.

### Validation

| Method | Description |
| --- | --- |
| `validateAll(): Promise<boolean>` | Validate every field and return whether all passed. |
| `getDirtyData(): Partial<T>` | Get a stable, shallow-frozen snapshot of values that failed validation. |
| `clearDirtyData(): void` | Clear all dirty data records. |

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

| Event | Triggered when |
| --- | --- |
| `field:change` | A field value changes. |
| `field:validation-complete` | A field validation finishes, including batch operations and reactions, even when its value did not change. Payload includes `field`, `isValid`, and whether the field remains dirty. |
| `dirty-data:cleared` | `clearDirtyData()` removes one or more dirty values. Payload lists the affected fields. |
| `validation:complete` | A validation pass finishes. |
| `validation:error` | A validation rule fails. |
| `reaction:error` | A reaction throws or rejects. |
| `dependency:error` | A reaction dependency is misconfigured. |
| `field:not-found` | `setField` or `setFields` attempts to write a field absent from the schema. |

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
`ModelErrorCode`, `ModelEventMap`, `InferFieldType`, and `InferModelData`.

The core entry exports `createModel`, `ModelEvents`, and `SKIP_REACTION`.
`model-reaction/validation` exports `ValidationRules`, `Rule`,
`formatValidationErrors`, and the `ValidationErrorFormatter` type.

For full type definitions, see [`src/types.ts`](../src/types.ts).

## API simplification migration (Unreleased)

These changes are breaking and require updating consumers:

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
- Replace `action: fn` with `action: [fn]` and migrate parameter reads to model
  closures. Direct callers must iterate the array and invoke items without
  arguments. Actions now wait for calculation to settle and merge by host's
  latest scheduling version; they no longer run after every intermediate
  successful computation. A later skip or failure cancels earlier actions even
  when an earlier value commits. Remaining items can be cancelled after a new
  host version; combine operations in one item when they must complete together.
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
