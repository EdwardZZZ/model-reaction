# API Reference

Reference for the public `model-reaction` API surface.

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
> **`FieldSchema.type` is metadata, not a runtime validator.** It drives
> TypeScript inference and tooling. Add an appropriate `ValidationRules` entry
> or custom `Rule` when values must be checked at runtime.
>
> **Reaction output is validated.** A field's `reaction.computed` result is
> committed through the same validate-then-commit path as `setField`. If the
> derived field declares a `validator` and the computed value fails it, `data`
> keeps its previous value and the computed value is stored in `dirtyData`.
> The reaction's optional `action` runs **only when that computed value passes
> validation** — a value that fails and lands in `dirtyData` fires neither the
> derived field's change nor its `action`.

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

### Reactions

A field can have one reaction or an array of reactions. Each reaction runs when
one of the fields in its `fields` list changes. For an array, matching
reactions are scheduled in declaration order:

```ts
total: {
    type: 'number',
    reaction: [
        { fields: ['price'], computed: ({ price }) => price * 1.1 },
        { fields: ['price'], computed: ({ price }) => price * 1.2 },
    ],
}
```

`computed` must run synchronously and remain pure: it reads only the
dependencies declared in `fields` and returns the target field's next value.
Returning a Promise is reported through `reaction:error`, and no result is
committed. Other side effects, such as requests, logging, or external-state
mutations, cannot be detected at runtime and must be avoided by the caller. Put
asynchronous work and other side effects in `action`. An `action` may be
asynchronous; its Promise is tracked by `settled()`, and a rejection is
reported through `reaction:error`.

Return the package-level `SKIP_REACTION` export to conditionally stop the
current reaction:

```ts
import { SKIP_REACTION } from 'model-reaction';

computed: ({ enabled, source }) =>
  enabled ? String(source).trim() : SKIP_REACTION
```

`SKIP_REACTION` is a normal no-op: the target field is not validated or
written, `dirtyData` is unchanged, and no `field:change`, downstream reaction,
or current reaction `action` is triggered. Later entries in a reaction array
still run in declaration order.

#### Result types

TypeScript checks each `computed` result, including every entry of a reaction
array, against the field's `type`: `string`, `number`, `boolean`, `Date`,
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

When several reactions write the same target for the same changed dependency,
the last scheduled write is authoritative; earlier writes are superseded. Thus,
in the example, the second reaction determines `total` if its result passes
validation. If it fails validation, the result goes to `dirtyData`; an earlier
reaction's value is not used as a fallback. An `action` runs only when that
reaction's own write commits successfully.

For a `setFields()` batch that changes multiple dependencies, the order in
which changed fields are processed also affects scheduling. If one result
depends on several inputs, prefer one reaction listing all of them rather than
using multiple reactions to compete for the same target.

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
  strictMode?: boolean;
  failFast?: boolean;
}
```

| Option | Default | Description |
| --- | --- | --- |
| `debounceReactions` | `0` | Debounce window (ms) for reaction triggers. |
| `asyncValidationTimeout` | `5000` | Timeout (ms) for async validators. |
| `strictMode` | `false` | If `true`, setting a field absent from the schema throws. |
| `failFast` | `false` | If `true`, stop validating a field after its first failure. |

## Validation Rules

`ValidationRules` is a collection of reusable built-in rules, and `Rule` is the
class behind them. Both are exported from `model-reaction/validation`:

```typescript
import { ValidationRules, Rule } from 'model-reaction/validation';
```

Each rule implements the `Validator` interface, so it can be dropped straight
into a field's `validator` array.

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
`Validator`, `Reaction`, `FieldSchema`, `ValidationError`, `ModelError`,
`ModelErrorCode`, `ModelEventMap`, `InferFieldType`, and `InferModelData`.

The core entry exports `createModel`, `ModelEvents`, and `SKIP_REACTION`.
`model-reaction/validation` exports `ValidationRules`, `Rule`,
`formatValidationErrors`, and the `ValidationErrorFormatter` type.

For full type definitions, see [`src/types.ts`](../src/types.ts).

## API simplification migration (Unreleased)

These changes are breaking and require updating consumers:

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
