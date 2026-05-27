# Advanced Usage

Patterns beyond the README quick start.

[← Back to README](../README.md)

---

## Table of Contents

- [Asynchronous Validation](#asynchronous-validation)
- [Custom Validation Rules and Messages](#custom-validation-rules-and-messages)
- [Unified Error Handling](#unified-error-handling)
- [Conditional and Cross-field Validation](#conditional-and-cross-field-validation)
- [Transformation and Asynchronous Validation](#transformation-and-asynchronous-validation)
- [Waiting for Async Operations](#waiting-for-async-operations)
- [Schema Type Inference](#schema-type-inference)

---

## Asynchronous Validation

```typescript
import { createModel, Rule, ValidationRules } from 'model-reaction';

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
import { createModel, Rule, ErrorHandler } from 'model-reaction';

const errorHandler = new ErrorHandler();

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
}, { errorHandler });
```

## Unified Error Handling

```typescript
import { createModel, ValidationRules, ErrorHandler, ErrorType } from 'model-reaction';

const errorHandler = new ErrorHandler();

errorHandler.onError(ErrorType.VALIDATION, (error) => {
  console.error(`Validation error: ${error.field} - ${error.message}`);
});

errorHandler.onError(ErrorType.FIELD_NOT_FOUND, (error) => {
  console.error(`Field not found: ${error.field}`);
});

errorHandler.onError(ErrorType.UNKNOWN, (error) => {
  console.error(`Unknown error: ${error.message}`);
});

const model = createModel({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('Name cannot be empty')],
    default: '',
  },
}, { errorHandler });
```

## Conditional and Cross-field Validation

Define rules that only run under specific conditions, or that validate one
field based on another via the `data` parameter.

```typescript
import { createModel, ValidationRules, Rule } from 'model-reaction';

const model = createModel({
  hasDiscount: { type: 'boolean', default: false },
  discountCode: {
    type: 'string',
    validator: [
      // Conditional: only runs when hasDiscount is true.
      {
        ...ValidationRules.required.withMessage('Discount code is required when discount is enabled'),
        condition: (data) => data.hasDiscount === true,
      },
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
import { createModel, Rule } from 'model-reaction';

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

When using async validations or debounced reactions, awaiting `setField`
alone may not guarantee that all cascading effects have settled. Use
`settled()`:

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

// 2. Inferred from a schema literal (use `as const` on each `type`):
const m = createModel({
  name: { type: 'string'  as const, default: '' },
  age:  { type: 'number'  as const, default: 0 },
  ok:   { type: 'boolean' as const, default: false },
});
// m.data is typed as { name: string; age: number; ok: boolean }
```
