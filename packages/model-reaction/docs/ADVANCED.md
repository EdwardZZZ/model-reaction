# Advanced Usage

Patterns beyond the README quick start.

[中文版本](ADVANCED_CN.md) | English

[← Back to README](../README.md)

---

## Table of Contents

- [Asynchronous Validation](#asynchronous-validation)
- [Custom Validation Rules and Messages](#custom-validation-rules-and-messages)
- [Typed Error Events](#typed-error-events)
- [Conditional and Cross-field Validation](#conditional-and-cross-field-validation)
- [Transformation and Asynchronous Validation](#transformation-and-asynchronous-validation)
- [Waiting for Async Operations](#waiting-for-async-operations)
- [Schema Type Inference](#schema-type-inference)
- [Model Organization](#model-organization)
- [Performance and Error Handling](#performance-and-error-handling)
- [Testing Application Models](#testing-application-models)

---

## Asynchronous Validation

```typescript
import { createModel } from 'model-reaction';
import { Rule, ValidationRules } from 'model-reaction/validation';

interface AsyncUser {
  name: string;
  username: string;
}

const asyncUniqueRule = new Rule(
  'asyncUnique',
  'Username already exists',
  async (value: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(value !== 'admin'), 100);
    });
  }
);

const asyncUserModel = createModel<AsyncUser>({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('Username cannot be empty')],
    default: '',
  },
  username: {
    type: 'string',
    validator: [
      ValidationRules.required.withMessage('Account cannot be empty'),
      asyncUniqueRule,
    ],
    default: '',
  },
}, { asyncValidationTimeout: 3000 });

const ok = await asyncUserModel.setField('username', 'admin');
console.log(ok); // false
console.log(asyncUserModel.validationErrors);
console.log(asyncUserModel.getDirtyData());
```

## Custom Validation Rules and Messages

```typescript
import { createModel } from 'model-reaction';
import { Rule } from 'model-reaction/validation';

const customRule = new Rule(
  'custom',
  'Does not meet custom rules',
  (value: any) => value === 'custom'
);

const model = createModel({
  field: {
    type: 'string',
    validator: [customRule.withMessage('Field value must be "custom"')],
    default: '',
  },
});
```

## Typed Error Events

```typescript
import { createModel, ModelEvents } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';

const model = createModel({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('Name cannot be empty')],
    default: '',
  },
});

const unsubscribeValidation = model.on(
  ModelEvents.VALIDATION_ERROR,
  (error) => console.error(`Validation error: ${error.field} - ${error.message}`)
);
const unsubscribeMissing = model.on(
  ModelEvents.FIELD_NOT_FOUND,
  (error) => console.error(`Field not found: ${error.field}`)
);

unsubscribeValidation();
unsubscribeMissing();
```

## Conditional and Cross-field Validation

Define rules that only run under specific conditions, or that validate one
field based on another via the `data` parameter.

```typescript
import { createModel } from 'model-reaction';
import { ValidationRules, Rule } from 'model-reaction/validation';

const model = createModel({
  hasDiscount: { type: 'boolean', default: false },
  discountCode: {
    type: 'string',
    validator: [
      // Conditional: only runs when hasDiscount is true. `.when(predicate)`
      // is the concise form of attaching a `condition`.
      ValidationRules.required
        .withMessage('Discount code is required when discount is enabled')
        .when((data) => data.hasDiscount === true),
      // Cross-field: read other fields via `data`.
      new Rule(
        'validCode',
        'Invalid discount code',
        (value, data) => {
          if (data?.hasDiscount && value !== 'PROMO2024') return false;
          return true;
        }
      ),
    ],
    default: '',
  },
});
```

## Transformation and Asynchronous Validation

```typescript
import { createModel } from 'model-reaction';
import { Rule } from 'model-reaction/validation';

const asyncModel = createModel({
  field: {
    type: 'string',
    transform: (value: string) => value.toUpperCase(),
    validator: [
      new Rule(
        'asyncValidator',
        'Asynchronous validation failed',
        async (value: string) => value.length > 3
      ).withMessage('Field length must be greater than 3 characters'),
    ],
    default: '',
  },
});
```

## Waiting for Async Operations

Awaiting `setField` waits for that field's validation and commit. Cascading
reactions and action groups may still be running, including without debounce.
Use `settled()` outside actions:

```typescript
interface Schema {
  source: string;
  target: string;
}

const model = createModel<Schema>({
  source: { type: 'string', default: '' },
  target: {
    type: 'string',
    default: '',
    reaction: {
      fields: ['source'],
      computed: (vals) => vals.source.toUpperCase(),
    },
  },
}, { debounceReactions: 100 });

await model.setField('source', 'hello');

console.log(model.getField('target')); // '' (debounce pending)

await model.settled();

console.log(model.getField('target')); // 'HELLO'
```

## Schema Type Inference

`createModel` supports two call styles:

```ts
// 1. Explicit type argument (recommended for complex models):
const user = createModel<User>(userSchema);

// 2. Inferred from a schema literal:
const m = createModel({
  name: { type: 'string', default: '' },
  age:  { type: 'number', default: 0 },
  ok:   { type: 'boolean', default: false },
});
// m.data is typed as { name: string; age: number; ok: boolean }

// Without a default, the inferred value also includes undefined.
const optional = createModel({ note: { type: 'string' } });
// optional.data.note is string | undefined

// `values` gives an enum field a useful inferred union. Runtime validation
// still comes from the field's validators.
const status = createModel({
  state: {
    type: 'enum',
    values: ['draft', 'published'] as const,
    default: 'draft',
  },
});
// status.data.state is 'draft' | 'published'
```

Schema inference describes the runtime value, including a mismatched default
because defaults intentionally bypass validation. Explicit `createModel<T>` is
an assertion by the caller that the schema initializes that shape. For object
and array fields without useful defaults, provide an explicit data type.

## Model Organization

Keep one model for fields that share a lifecycle and dependency graph. Split a
large schema into focused modules, then spread the fragments into one flat
schema. Field names must be unique across fragments: object spread replaces an
earlier definition silently. Separate models are useful for independently owned
forms; cross-model coordination belongs in application code.

Extract reusable checks into named rules and put orchestration in domain
functions. Keep `computed` synchronous and pure, declare every input in
`reaction.fields`, and use separate fields for independent computed results.
Async work and side effects belong in action groups; see the
[action contract](API.md#action-groups).

Use an explicit domain interface for shared contracts and schema inference for
small local models. `FieldSchema.type` is metadata, not runtime validation:
untyped input still needs validators. Map API payloads to known field keys
before writing them. The [ad-creation recipe](../examples/AD_CREATION_CN.md)
demonstrates schema composition and DTO conversion.

## Performance and Error Handling

- Put cheap rules first. A field runs rules sequentially and stops at its first
  error; different fields can validate concurrently.
- Cache reusable remote checks at the service boundary and configure
  `asyncValidationTimeout` for that service.
- Debounce input before `setField` when remote validation should not run on
  every keystroke. `debounceReactions` only delays derived calculations.
- Use field or selector subscriptions for narrow views. Hook choice, draft
  buffering, and model ownership are documented in [React bindings](REACT.md).
- A `false` write result is a validation failure; rejected writes are separate
  exceptions. Read `validationErrors[field]` or use
  `formatValidationErrors` from `model-reaction/validation` for a summary.
  Subscribe to typed error events for logging and always unsubscribe in cleanup.
  Text bindings display `writeError?.message ?? meta.error` under `showError`.

## Testing Application Models

Test business boundaries: rule limits, transforms, invalid input preserved in
dirty data, rejected computed values, stale async results, and reaction chains.
Submission tests should `await settled()`, then `await validateAll()` and check
its result before reading the payload. Full validation includes settlement of
work that it triggered. Include server rejection and retry behavior when the
application owns them.

React integration checks should cover editing text while validation is pending,
field-specific updates, and owner cleanup. Repository contribution checks are
maintained in [AGENTS.md](../AGENTS.md).
