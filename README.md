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

## Examples

For more examples, please check the files in the `examples/` directory.

## Best Practices

Please refer to the best practices guide in the `BEST_PRACTICES.md` file.
