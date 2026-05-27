# API Reference

Complete API documentation for `model-reaction`.

[← Back to README](../README.md)

---

## Table of Contents

- [createModel](#createmodel)
- [Model Methods](#model-methods)
- [Events](#events)
- [ModelOptions](#modeloptions)
- [ErrorHandler](#errorhandler)
- [ErrorType Enum](#errortype-enum)
- [Type Definitions](#type-definitions)

---

## createModel

The factory function that creates a model instance.

```typescript
createModel<T>(schema: Model<T>, options?: ModelOptions): ModelManager<T>;
```

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
| `setFields(fields): Promise<boolean>` | Batch set multiple fields; returns overall validation result. |

### Validation

| Method | Description |
| --- | --- |
| `validateAll(): Promise<boolean>` | Validate every field and return whether all passed. |
| `getValidationSummary(): string` | Get a human-readable validation summary. |
| `getDirtyData(): Partial<T>` | Get values that failed validation. |
| `clearDirtyData(): void` | Clear all dirty data records. |

### Subscription

| Method | Description |
| --- | --- |
| `subscribeField(field, callback)` | Subscribe to a single field's value changes. Returns an unsubscribe function. |
| `subscribe(selector, callback, isEqual?)` | Subscribe to a derived value. Default equality is `Object.is`. Returns an unsubscribe function. |
| `on(event, callback)` | Subscribe to a model event (see [Events](#events)). |
| `off(event, callback?)` | Unsubscribe from an event. |

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
| `field:not-found` | A non-existent field is accessed. |

## ModelOptions

```typescript
interface ModelOptions {
  debounceReactions?: number;
  asyncValidationTimeout?: number;
  errorFormatter?: (error: ValidationError) => string;
  errorHandler?: ErrorHandler;
  strictMode?: boolean;
  failFast?: boolean;
}
```

| Option | Default | Description |
| --- | --- | --- |
| `debounceReactions` | `0` | Debounce window (ms) for reaction triggers. |
| `asyncValidationTimeout` | none | Timeout (ms) for async validators. |
| `errorFormatter` | — | Customise validation error message formatting. |
| `errorHandler` | new instance | Inject a shared `ErrorHandler`. |
| `strictMode` | `false` | If `true`, setting a field absent from the schema throws. |
| `failFast` | `false` | If `true`, stop validating a field after its first failure. |

## ErrorHandler

Unified error management.

| Method | Description |
| --- | --- |
| `onError(type, callback)` | Subscribe to a specific error type. |
| `offError(type, callback)` | Unsubscribe. |
| `triggerError(error)` | Trigger an error manually. |
| `createValidationError(field, message)` | Build a validation error object. |
| `createFieldNotFoundError(field)` | Build a "field not found" error object. |

## ErrorType Enum

| Member | Meaning |
| --- | --- |
| `VALIDATION` | Validation rule failed. |
| `REACTION` | Reaction handler errored. |
| `FIELD_NOT_FOUND` | Field is not declared in the schema. |
| `DEPENDENCY_ERROR` | Reaction dependency is invalid. |
| `CIRCULAR_DEPENDENCY` | Reaction graph contains a cycle. |
| `UNKNOWN` | Unclassified error. |

## Type Definitions

For full type definitions, see [`src/types.ts`](../src/types.ts).
