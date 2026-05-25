# model-reaction

[中文版本](README_CN.md) | English

A powerful, type-safe data model management library supporting synchronous and asynchronous data validation, dependency reactions, dirty data management, and unified error handling.

## Project Introduction

`model-reaction` is a TypeScript library for managing application data models, providing the following core features:

- **Data Validation**: Supports synchronous and asynchronous validation rules, with custom validation messages
- **Dependency Reactions**: Automatically triggers related calculations and operations when specified fields change
- **Dirty Data Management**: Tracks validation-failed data and provides clearing functionality
- **Event System**: Supports subscribing to field changes, validation completion, and error events
- **Error Handling**: Unified error handling mechanism, supporting error type classification and custom error listening
- **Type Safety**: Built entirely on TypeScript, providing excellent type hints

## Installation

```bash
# Using npm
npm install model-reaction

# Using yarn
yarn add model-reaction
```

## Basic Usage

### Synchronous Validation Example

```typescript
import { createModel, Model, ValidationRules, ErrorType } from 'model-reaction';

// Define the interface for your data model
interface User {
  name: string;
  age: number;
  info: string;
}

// Define model schema
// Use the generic type to ensure schema matches the interface
const userModel = createModel<User>({
  name: {
    type: 'string',
    validator: [
      ValidationRules.required
    ],
    default: '',
  },
  age: {
    type: 'number',
    validator: [
      ValidationRules.required,
      ValidationRules.number,
      ValidationRules.min(18)
    ],
    default: 18
  },
  info: {
    type: 'string',
    reaction: {
      fields: ['name', 'age'],
      computed: (values) => `My name is ${values.name} and I am ${values.age} years old.`,
      action: (values) => console.log('Info updated:', values.computed)
    },
    default: ''
  }
}, {
  debounceReactions: 100,
  asyncValidationTimeout: 5000
});

// Subscribe to error events
userModel.on('validation:error', (error) => {
  console.error(`Validation error: ${error.field} - ${error.message}`);
});

userModel.on('field:not-found', (error) => {
  console.error(`Field not found: ${error.field}`);
});

// Set field values
await userModel.setField('name', 'John');
await userModel.setField('age', 30);

// Try to set non-existent field
await userModel.setField('nonexistentField', 'value');

// Get field values
console.log('Name:', userModel.getField('name')); // Output: John
console.log('Age:', userModel.getField('age')); // Output: 30
console.log('Info:', userModel.getField('info')); // Output: My name is John and I am 30 years old.

// Validate all fields
const isValid = await userModel.validateAll();
console.log('Validation passed:', isValid);
console.log('Validation errors:', userModel.validationErrors);
console.log('Validation summary:', userModel.getValidationSummary());

// Get dirty data
console.log('Dirty data:', userModel.getDirtyData());

// Clear dirty data
userModel.clearDirtyData();
console.log('Dirty data after clearing:', userModel.getDirtyData());
```

### Asynchronous Validation Example

```typescript
import { createModel, Model, ValidationRules, Rule } from 'model-reaction';

interface AsyncUser {
  name: string;
  username: string;
}

const asyncUniqueRule = new Rule(
  'asyncUnique',
  'Username already exists',
  async (value: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(value !== 'admin');
      }, 100);
    });
  }
);

// Define model schema
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
      asyncUniqueRule
    ],
    default: ''
  }
}, {
  asyncValidationTimeout: 3000
});

// Asynchronously set field value
const result1 = await asyncUserModel.setField('username', 'newuser');
console.log('Setting new username result:', result1); // Output: true

const result2 = await asyncUserModel.setField('username', 'admin');
console.log('Setting existing username result:', result2); // Output: false
console.log('Validation errors:', asyncUserModel.validationErrors);
console.log('Dirty data:', asyncUserModel.getDirtyData());
```

## API Reference

### createModel

The model manager is the core class of the library, providing the following methods:

#### Constructor
```typescript
createModel<T>(schema: Model<T>, options?: ModelOptions);
```

#### Methods

- `setField(field: keyof T, value: T[keyof T]): Promise<boolean>`: Set a single field value, returns validation result
- `setFields(fields: Partial<T>): Promise<boolean>`: Batch set field values, returns validation result
- `getField(field: keyof T): T[keyof T]`: Get field value
- `validateAll(): Promise<boolean>`: Validate all fields, returns overall validation result
- `getValidationSummary(): string`: Get validation summary information
- `getDirtyData(): Partial<T>`: Get validation-failed dirty data
- `clearDirtyData(): void`: Clear all dirty data
- `settled(): Promise<void>`: Wait for all pending reactions and validations to complete
- `dispose(): void`: Dispose the model, clear all timers and listeners
- `on(event: string, callback: (data: any) => void): void`: Subscribe to events
- `off(event: string, callback?: (data: any) => void): void`: Unsubscribe from events
- `subscribeField<K extends keyof T>(field: K, callback: (value: T[K]) => void): () => void`: Subscribe to a single field; callback fires only when that field changes. Returns an unsubscribe function.
- `subscribe<R>(selector: (data: T) => R, callback: (value: R, prev: R) => void, isEqual?: (a: R, b: R) => boolean): () => void`: Subscribe to a derived value; callback fires only when the selected value changes (default `Object.is`). Returns an unsubscribe function.
- `get data(): T`: Get all field values
- `get validationErrors(): Record<string, ValidationError[]>`: Get all validation errors

#### Events

- `field:change`: Triggered when field value changes
- `validation:complete`: Triggered when validation is complete
- `validation:error`: Triggered when validation error occurs
- `reaction:error`: Triggered when reaction processing error occurs
- `field:not-found`: Triggered when attempting to access a non-existent field

### ModelOptions

Model configuration options:

- `debounceReactions?: number`: Debounce time for reaction triggering (in milliseconds)
- `asyncValidationTimeout?: number`: Timeout time for asynchronous validation (in milliseconds)
- `errorFormatter?: (error: ValidationError) => string`: Custom error formatting function
- `strictMode?: boolean`: Strict mode. If true, attempting to set a field that doesn't exist in the schema will throw an Error.
- `failFast?: boolean`: Validation strategy. If true, stops validating a field after the first error. Default is false.

### ErrorHandler

Error handler provides unified error management:

- `onError(type: ErrorType, callback: (error: AppError) => void): void`: Subscribe to specific type of error
- `offError(type: ErrorType, callback: (error: AppError) => void): void`: Unsubscribe from specific type of error
- `triggerError(error: AppError): void`: Trigger error
- `createValidationError(field: string, message: string): AppError`: Create validation error
- `createFieldNotFoundError(field: string): AppError`: Create field not found error
- ... other error creation methods

### ErrorType Enum

- `VALIDATION`: Validation error
- `REACTION`: Reaction processing error
- `FIELD_NOT_FOUND`: Field not found error
- `DEPENDENCY_ERROR`: Dependency error in reactions
- `CIRCULAR_DEPENDENCY`: Circular dependency error
- `UNKNOWN`: Unknown error

### Type Definitions

For detailed type definitions, please refer to the `src/types.ts` file.

## Advanced Usage

### Custom Validation Rules and Messages

You can create custom validation rules and set custom error messages:

```typescript
import { createModel, Model, Rule, ErrorHandler } from 'model-reaction';

// Create error handler instance
const errorHandler = new ErrorHandler();

// Create custom validation rule
const customRule = new Rule(
  'custom',
  'Does not meet custom rules', // Default error message
  (value: any) => {
    // Custom validation logic
    return value === 'custom';
  }
);

// Use in model and override error message
const model = createModel({
  field: {
    type: 'string',
    validator: [
      customRule.withMessage('Field value must be "custom"')
    ],
    default: ''
  }
}, {
  errorHandler: errorHandler // Add errorHandler configuration
});
```

### Unified Error Handling

```typescript
import { createModel, Model, ValidationRules, ErrorHandler, ErrorType } from 'model-reaction';

// Create error handler
const errorHandler = new ErrorHandler();

// Subscribe to all validation errors
errorHandler.onError(ErrorType.VALIDATION, (error) => {
  console.error(`Validation error: ${error.field} - ${error.message}`);
});

// Subscribe to field not found errors
errorHandler.onError(ErrorType.FIELD_NOT_FOUND, (error) => {
  console.error(`Field not found: ${error.field}`);
});

// Subscribe to all errors
errorHandler.onError(ErrorType.UNKNOWN, (error) => {
  console.error(`Unknown error: ${error.message}`);
});

// Define model schema, pass custom error handler
const model = createModel({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('Name cannot be empty')],
    default: ''
  }
}, {
  errorHandler: errorHandler
});
```

### Conditional and Cross-field Validation

You can define rules that only run when specific conditions are met, or rules that validate a field based on the values of other fields using the `data` parameter:

```typescript
import { createModel, ValidationRules, Rule } from 'model-reaction';

const model = createModel({
  hasDiscount: { type: 'boolean', default: false },
  discountCode: {
    type: 'string',
    validator: [
      // Conditional Validation: This rule only runs if hasDiscount is true
      {
        ...ValidationRules.required.withMessage('Discount code is required when discount is enabled'),
        condition: (data) => data.hasDiscount === true
      },
      // Cross-field Validation: Check if the code is valid based on other data
      new Rule(
        'validCode',
        'Invalid discount code',
        (value, data) => {
          // You can access other field values from the `data` parameter
          if (data?.hasDiscount && value !== 'PROMO2024') {
            return false;
          }
          return true;
        }
      )
    ],
    default: ''
  }
});
```

### Transformation and Asynchronous Validation

```typescript
import { createModel, Model, Rule } from 'model-reaction';

const asyncModel = createModel({
  field: {
    type: 'string',
    transform: (value: string) => value.toUpperCase(),
    validator: [
      new Rule(
        'asyncValidator',
        'Asynchronous validation failed',
        async (value: string) => {
          // Asynchronous validation logic
          return value.length > 3;
        }
      ).withMessage('Field length must be greater than 3 characters')
    ],
    default: ''
  }
});
```

### Waiting for Async Operations (Reactions & Validations)

When using asynchronous validations or reactions (especially with debouncing), simply awaiting `setField` might not be enough to ensure all side effects (like cascading reactions) are finished.

Use the `settled()` method to wait for all pending operations:

```typescript
// Define schema with reaction
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
      computed: (vals) => vals.source.toUpperCase()
    }
  }
}, { debounceReactions: 100 }); // Reactions are debounced

// Trigger update
await model.setField('source', 'hello');

// At this point, 'target' might not be updated yet due to debounce
console.log(model.getField('target')); // ''

// Wait for all reactions to settle
await model.settled();

console.log(model.getField('target')); // 'HELLO'
```

### React Bindings

The package ships a React adapter at `model-reaction/react`. It exposes a
small set of hooks and components designed so each subscriber re-renders
only when its watched slice actually changes:

| Export | Kind | Purpose |
| --- | --- | --- |
| `useModelField(model, field)` | hook | Subscribe to a single field. |
| `useModelSelector(model, selector, isEqual?)` | hook | Subscribe to a derived value (selector reference is **part of the subscription** — wrap it in `useCallback`). |
| `useModelComputed(model, selector, isEqual?)` | hook | Same shape as `useModelSelector`, but selector / `isEqual` are stored in refs and refreshed every render — inline arrows and per-render closure variables (`id`, `index`, …) work without `useCallback`. |
| `useModelFields(model, fields)` | hook | Subscribe to several fields at once (shallow-compared). |
| `useModelFieldState(model, field)` | hook | `[value, setValue, meta, helpers]` form-style binding with `error / dirty / touched / validating`. |
| `shallow` | function | Shallow equality helper for object/array selectors. |
| `<ModelProvider model>` | component | Provide a model via context. |
| `useModel<T>()` | hook | Read the model from the nearest provider. |
| `<Field name>` | component | Render-prop binding to a single field; consumes `<ModelProvider>` automatically. |

`react` is declared as an optional peer dependency (`>=18.0.0`); install it
in your app if you use this entry point.

```tsx
import { createModel, ValidationRules } from 'model-reaction';
import {
    Field,
    ModelProvider,
    shallow,
    useModel,
    useModelField,
    useModelFields,
    useModelFieldState,
    useModelSelector,
} from 'model-reaction/react';

interface Cart {
    qty: number;
    price: number;
    coupon: string;
    name: string;
}

const cart = createModel<Cart>({
    qty:    { type: 'number', default: 1 },
    price:  { type: 'number', default: 100 },
    coupon: { type: 'string', default: '' },
    name:   { type: 'string', default: '', validator: [ValidationRules.required] },
});

// 1. Single-field hook.
function NameInput() {
    const name = useModelField(cart, 'name');
    return <input value={name} onChange={(e) => cart.setField('name', e.target.value)} />;
}

// 2. Selector hook.
function Total() {
    const total = useModelSelector(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

// 3. Multi-field hook (shallow-compared).
function PriceLine() {
    const { qty, price } = useModelFields(cart, ['qty', 'price']);
    return <span>{qty} x {price}</span>;
}

// 4. All-in-one form binding.
function CouponInput() {
    const [coupon, setCoupon, meta, helpers] = useModelFieldState(cart, 'coupon');
    return (
        <label>
            <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                onBlur={() => helpers.setTouched()}
                disabled={meta.validating}
            />
            {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
        </label>
    );
}

// 5. Provider + render-prop Field — no prop drilling.
function CartApp() {
    return (
        <ModelProvider model={cart}>
            <Field<Cart, 'name'> name="name">
                {({ value, setValue, meta }) => (
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        aria-invalid={!!meta.error}
                    />
                )}
            </Field>
            <Total />
            <PriceLine />
            <CouponInput />
        </ModelProvider>
    );
}

// 6. Custom selectors that build fresh containers — pair with `shallow`.
function Snapshot() {
    const m = useModel<Cart>();
    const slice = useModelSelector(
        m,
        (d) => ({ qty: d.qty, price: d.price }),
        shallow
    );
    return <span>{slice.qty * slice.price}</span>;
}
```

A complete sample lives at `examples/react-bindings.tsx`.

#### `useModelSelector` vs `useModelComputed`

Both hooks return a derived value with custom equality, but they treat
the `selector` reference very differently:

| Aspect | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| Selector identity | Captured in the `subscribe` deps. A new reference triggers **unsubscribe + resubscribe + extra render**. | Stored in a ref refreshed every render. Reference changes are **free**. |
| Recommended pattern | Wrap the selector in `useCallback` (or hoist it to module scope). | Inline arrow functions are fine. |
| Per-render closure variables | Need to be added to `useCallback` deps (otherwise stale). | Always reflect the latest render automatically. |
| Equality check site | Inside the model subscription — model can dedupe before reaching React. | Inside `getSnapshot` — model fans out every change, hook caches/dedupes per render. |
| Selector cost | Runs once per **commit**. | Runs once per **render** (because `getSnapshot` is called on every render). |
| Best for | Stable, hot-path derived values where the selector body is fixed. | Selectors that depend on per-render variables (`id`, `index`, paging cursor, …) or short-lived components where ceremony matters more than per-render selector cost. |

```tsx
// useModelSelector — selector must be stable.
const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
const total = useModelSelector(cart, selectTotal);

// useModelComputed — inline arrow is fine, and `id` stays fresh.
function Row({ id }: { id: string }) {
    const item = useModelComputed(cart, (d) => d.items[id]);
    return <span>{item?.name}</span>;
}
```

Rule of thumb: prefer `useModelSelector` for "global" derivations, switch
to `useModelComputed` whenever the selector closes over a value that
changes between renders.

##### Decision tree

```
1. Does the selector close over a value that changes between renders
   (e.g. `id`, `index`, paging cursor, search keyword)?
   ├── Yes → useModelComputed
   │         (correctness: avoids stale closures without useCallback)
   └── No  → continue ↓

2. Is the selector body expensive
   (deep map / aggregate / serialise / per-row diff)?
   ├── Yes → useModelSelector + stable reference
   │         (selector runs once per commit, not once per render)
   └── No  → continue ↓

3. Are you on a hot update path
   (high-frequency field, large fan-out: many subscribers,
    parent re-renders unrelated to this model)?
   ├── Yes → useModelSelector + stable reference
   │         (model-level isEqual prevents the change from entering
   │          React scheduling at all)
   └── No  → continue ↓

4. Will the selector be reused across components, or do you want it
   observable by middleware / devtools?
   ├── Yes → useModelSelector
   │         (selector identity lives at the model layer and can be
   │          instrumented; useModelComputed selectors only exist
   │          inside React render and cannot be observed)
   └── No  → continue ↓

5. Are you willing to wrap the selector in useCallback?
   ├── Yes → useModelSelector
   └── No  → useModelComputed
             (convenience: ref-locked semantics, no useCallback needed)
```

###### Performance hot-spots — explicit guidance

| Scenario | Why it matters | Pick |
| --- | --- | --- |
| 100+ list rows each subscribing to a derived value | `useModelComputed`'s selector runs **on every parent render** for every row | `useModelSelector` |
| Expensive selector body (deep map / clone / aggregate) | `getSnapshot` is invoked every render and twice under concurrent / strict mode | `useModelSelector` |
| High-frequency field (animation, mouse, debounce) feeding unrelated subscribers | Model-level `isEqual` keeps unrelated changes out of React scheduling | `useModelSelector` |
| Selector closes over `id` / `index` / per-render variables | `useModelSelector` would either go stale or resubscribe every render | `useModelComputed` |
| One-off prototype / short-lived component, light selector | The ceremony of `useCallback` outweighs the per-render `getSnapshot` cost | `useModelComputed` |
| Selector must stay observable by middleware / devtools | Identity must live at the model layer | `useModelSelector` |
| Selector with side effects or impurity (`console.log`, counters, dev-only logs) | `useSyncExternalStore` requires `getSnapshot` to be pure | `useModelSelector` |

> One-liner: `useModelSelector` is the performance ceiling
> (model-layer dedup, runs per **commit**); `useModelComputed` is the
> convenience floor (render-layer dedup, runs per **render**). They are
> **not** interchangeable — keep both.

### Schema Type Inference

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

## Examples

For more examples, please check the files in the `examples/` directory.

## Best Practices

Please refer to the best practices guide in the `BEST_PRACTICES.md` file.

## Comparison with Redux & zustand

For a side-by-side comparison with Redux Toolkit and zustand — including
feature matrix, mental model, code style, and decision tree — see
[COMPARISON.md](COMPARISON.md).
