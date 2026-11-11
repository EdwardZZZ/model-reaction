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

### Dirty Data & Conditional Validation Example (dirty-data-conditional.ts)
Demonstrates how failed input is diverted to `dirtyData` (retrievable via `getDirtyData()` / clearable via `clearDirtyData()`) instead of polluting `data`, and how `Rule.when(predicate)` makes a rule apply only when a cross-field condition holds.

### React Bindings Example (react-bindings.tsx)
Shows field-level and selector-level React subscriptions, provider ownership,
the recommended `useDraftField` binding, form metadata, local drafts, and schema type inference. The package script
uses `react-bindings-runner.tsx` for an SSR smoke check through `react-dom/server`.
Importing the component file does not execute the runner.

### Multi-record Deep Dependency Example (multi-record-deep-deps.ts)
Builds a larger deterministic schema and runs a five-layer reaction chain
across 100 records.

### React Best Practices Snippets (react-best-practices/)
Additional React-focused snippets covering stable selectors, `ModelProvider`,
`Field`, touched-state handling, submission flow, lifecycle cleanup, and
comparisons with zustand / Redux. These files are intended as reference
patterns rather than CLI-runnable examples.

## Running Examples

From the repository root:

```bash
pnpm --filter model-reaction run example:basic
pnpm --filter model-reaction run example:reaction
pnpm --filter model-reaction run example:async
pnpm --filter model-reaction run example:event
pnpm --filter model-reaction run example:complex
pnpm --filter model-reaction run example:dirty
pnpm --filter model-reaction run example:multi-record
pnpm --filter model-reaction run example:react
```

> Files under `examples/react-best-practices/` are also reference snippets and
> are not standalone CLI programs.

## Validation

All examples import public package entries. Repository runners resolve these
entries to source through `tsconfig.examples.json`; copied examples use the
installed package normally.

`pnpm --filter model-reaction run typecheck` checks source, tests, and a separate
examples project. CI uses this command; lint also includes `.ts` and `.tsx`
examples. The examples project excludes the three optional zustand / Redux
snippets (`7-10-2`, `7-10-3`, `7-10-5`) and their aggregate `index.ts`, because
their third-party dependencies and application glue are not installed here.
React contracts live in [REACT.md](../docs/REACT.md).
