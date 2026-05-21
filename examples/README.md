# model-reaction Examples

[中文版本](README_CN.md) | English

This directory provides various usage examples for the `model-reaction` library.

## Available Examples

### Basic Usage Example (basic-usage.ts)
Demonstrates the basic functionality of the library, including model creation, field settings, validation, etc.

### Reaction System Example (reaction-system.ts)
Shows the dependency reaction system, which automatically triggers calculations and operations when specified fields change.

### Async Validation Example (async-validation.ts)
Demonstrates how to use asynchronous validation rules, such as username uniqueness checks.

### Event Listening Example (event-listening.ts)
Shows how to listen for events such as field changes and validation completion.

### Complex Form Example (complex-form.ts)
Demonstrates field correlation, dependency validation, and error handling mechanisms in complex form scenarios.

### React Bindings Example (react-bindings.tsx)
Shows how to use the `model-reaction/react` adapter (`useModelField`, `useModelSelector`) for field-level and selector-level component subscriptions, plus schema type inference. Copy-paste-ready into any React 18+ project (not runnable from the CLI).

## Running Examples

Use the following commands to run the examples:

```bash
npm run example:basic
npm run example:reaction
npm run example:async
npm run example:event
npm run example:complex
```

> The React example (`examples/react-bindings.tsx`) is a standalone snippet —
> import it from a real React app rather than running it via `ts-node`.