---
name: "model-reaction"
description: "Expert helper for the model-reaction library. Invoke when creating data models, defining validation rules, or implementing reactive fields."
---

# Model Reaction Helper

This skill assists in using the `model-reaction` library for TypeScript/JavaScript projects. It provides patterns for creating models, handling validation (sync/async), managing reactions, and handling errors.

## When to Use
- Creating new data models or schemas.
- Adding validation logic to fields.
- Implementing reactive fields (computed values or side effects).
- Debugging validation or reaction issues.

## Core Concepts

### 1. Creating a Model
Use `createModel` to define the schema. Each field can have `type`, `validator`, `reaction`, and `default`.

```typescript
import { createModel, ValidationRules } from 'model-reaction';

const userModel = createModel({
  username: {
    type: 'string',
    validator: [ValidationRules.required],
    default: '',
  },
  age: {
    type: 'number',
    validator: [ValidationRules.min(18)],
    default: 18,
  }
}, {
  debounceReactions: 100 // Optimization
});
```

### 2. Validation Rules
- **Built-in**: `ValidationRules.required`, `ValidationRules.email`, `ValidationRules.min(n)`, etc.
- **Custom**: Use `new Rule(...)`.
- **Async**: Use custom async `Rule` or custom async `validate` logic.

```typescript
// Custom Async Rule
import { Rule } from 'model-reaction';

const asyncUnique = new Rule(
  'asyncUnique',
  'Value already exists',
  async (value) => {
    return await checkApi(value);
  }
);
```

### 3. Reactions
Reactions allow fields to change based on other fields.
- `fields`: Dependencies.
- `computed`: Pure function to calculate new value.
- `action`: Side effects (e.g., API calls, logging).

```typescript
fullName: {
  type: 'string',
  reaction: {
    fields: ['firstName', 'lastName'],
    computed: (values) => `${values.firstName} ${values.lastName}`,
    action: (values) => console.log('Name changed:', values.computed)
  },
  default: ''
}
```

### 4. Event Handling
Subscribe to changes and errors.

```typescript
model.on('validation:error', (err) => console.error(err));
model.on('field:change', (data) => console.log('Changed:', data));
```

## Best Practices

1. **Performance**:
   - Use `debounceReactions` for frequent updates.
   - Use `asyncValidationTimeout` to prevent hanging validations.

2. **Structure**:
   - Keep `computed` functions pure.
   - Handle side effects in `action`.
   - Extract complex validation rules into reusable functions.

3. **Error Handling**:
   - Use `ErrorHandler` for global error management.
   - Monitor `validationErrors` for field-specific issues.
