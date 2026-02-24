# Model Reaction Library Best Practices Guide

[中文版本](BEST_PRACTICES_CN.md) | English

## 1. Performance Optimization

### Large Form Handling
- Use the `debounceReactions` option to reduce frequently triggered reactions
- Consider using virtual scrolling for large list data

### Asynchronous Validation Optimization
- Implement validation result caching to avoid re-validating the same values
- Use `asyncValidationTimeout` to control validation timeouts
- Apply debouncing to user input to reduce the number of validation requests

## 2. Error Handling

### Global Error Handling
```typescript
const errorHandler = new ErrorHandler();
errorHandler.onError(ErrorType.UNKNOWN, (error) => {
  console.error('Error occurred:', error);
  // Display global error notification
});
```

### Field-Level Error Handling
- Use the `validationErrors` object to get errors for specific fields
- Display error messages for each field in the UI
- Use `getValidationSummary()` to get an error summary

## 3. Complex Business Rules

### Reaction System Design
- Keep `computed` functions pure, only for calculating values
- Handle side effects in `action`
- Use dependency graphs to optimize complex reaction chains

### Conditional Validation
- Implement complex conditional validation using custom `Rule`
- Access other field values using the validator's `data` parameter
- For complex logic, consider encapsulating it as a separate validation service

## 4. Testing Strategy

### Unit Testing
- Test validation rules for each field
- Test the correctness of the reaction system
- Test error handling flow

### Integration Testing
- Test complete form submission flow
- Test asynchronous validation integration
- Test interaction with UI components

## 5. Code Organization

### Large Application Structure
- Organize model definitions by functional modules
- Extract common validation rules into shared libraries
- Use composition instead of inheritance to extend model functionality

### Maintainability Recommendations
- Add clear documentation comments for each model
- Keep model definitions concise, avoiding excessive complexity
- Regularly refactor and optimize the reaction system

## 6. Type Safety

### Define Interfaces
- Always define a TypeScript interface for your data model.
- Use `createModel<Interface>(...)` to enforce schema validation.
- This prevents runtime errors caused by missing fields or incorrect types.

### Strict Schema Matching
- The library enforces that your Schema matches your Interface exactly.
- All required fields in the Interface must be present in the Schema.
- Extra fields not in the Interface are not allowed in the Schema.
