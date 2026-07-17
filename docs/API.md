# API Reference

Reference for the public `model-reaction` API surface.

[← Back to README](../README.md)

---

## Table of Contents

- [createModel](#createmodel)
- [Model Methods](#model-methods)
- [Events](#events)
- [ModelOptions](#modeloptions)
- [Error Formatting](#error-formatting)
- [Type Definitions](#type-definitions)

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

> **Defaults bypass validation.** Each field's `default` is written directly
> into `data` at construction — validators do **not** run against it. A model
> can therefore start in an invalid state while `validationErrors` is empty.
> Call `await validateAll()` before trusting initial `data`.
>
> **Reaction output is validated.** A field's `reaction.computed` result is
> committed through the same validate-then-commit path as `setField`. If the
> derived field declares a `validator` and the computed value fails it, `data`
> keeps its previous value and the computed value is stored in `dirtyData`.

## Model Methods

### Read

| Method | Description |
| --- | --- |
| `getField(field)` | Get a field's current value. |
| `get data` | Get all field values as an object. |
| `get validationErrors` | Get all current validation errors keyed by field. |

### Write

| Method | Description |
| --- | --- |
| `setField(field, value): Promise<boolean>` | Set a single field; returns its validation result. |
| `setFields(fields): Promise<boolean>` | Batch set multiple fields in one validation + reaction pass; returns the AND of every field's result. **Not atomic** — valid fields commit to `data` even if a sibling field fails validation. |

### Validation

| Method | Description |
| --- | --- |
| `validateAll(): Promise<boolean>` | Validate every field and return whether all passed. |
| `getDirtyData(): Partial<T>` | Get values that failed validation. |
| `clearDirtyData(): void` | Clear all dirty data records. |

### Subscription

| Method | Description |
| --- | --- |
| `subscribeField(field, callback)` | Subscribe to a single field's value changes. Returns an unsubscribe function. |
| `subscribe(selector, callback, isEqual?)` | Subscribe to a derived value. Default equality is `Object.is`. Returns an unsubscribe function. |
| `on(event, callback)` | Subscribe to a model event (see [Events](#events)). Returns an unsubscribe function, like `subscribe` / `subscribeField`. |

#### Two layers: events vs. data subscription

These three methods live at **two different abstraction levels** — they are
complementary, not redundant:

- **`on` — typed model events.** The low-level layer. It subscribes by
  **event name**, receives that event's typed payload, and returns an
  unsubscribe function. It is the *only* way to
  observe non-value events such as `validation:error`, `validation:complete`,
  `reaction:error`, `dependency:error`, and `field:not-found` (see
  [Events](#events)).

- **`subscribe` / `subscribeField` — data subscription.** A convenience layer
  built on top of `on('field:change', …)`. Both observe **value changes** and
  only fire when the observed value actually changes:
  - `subscribeField(field, cb)` — filters to one field; callback gets `(value)`.
  - `subscribe(selector, cb, isEqual?)` — observes a derived value; callback
    gets `(next, prev)`, deduped via `isEqual` (default `Object.is`).

**Which to use:** reach for `subscribeField` / `subscribe` for reactive value
watching (the common case, and what the React adapter uses); drop down to
`on` when you need error/validation events or full control over the raw event
stream.

### Lifecycle

| Method | Description |
| --- | --- |
| `settled(): Promise<void>` | Wait for all pending reactions and async validations to complete. |
| `dispose(): void` | Release timers, listeners, and internal state. |

## Events

Subscribe via `model.on(eventName, handler)`.

| Event | Triggered when |
| --- | --- |
| `field:change` | A field value changes. |
| `validation:complete` | A validation pass finishes. |
| `validation:error` | A validation rule fails. |
| `reaction:error` | A reaction throws or rejects. |
| `dependency:error` | A reaction dependency is misconfigured. |
| `field:not-found` | A non-existent field is accessed. |

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

## Error Formatting

Formatting is independent from model state:

```typescript
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

For full type definitions, see [`src/types.ts`](../src/types.ts).
