# Examples

[中文版本](README_CN.md) | English | [Documentation](../docs/README.md)

## Runnable Examples

Run each command from the repository root.

| Example | Focus | Command |
| --- | --- | --- |
| [Basic usage](basic-usage.ts) | Creation, writes, validation | `pnpm --filter model-reaction run example:basic` |
| [Reactions](reaction-system.ts) | Dependency calculations and actions | `pnpm --filter model-reaction run example:reaction` |
| [Async validation](async-validation.ts) | Remote-style uniqueness check | `pnpm --filter model-reaction run example:async` |
| [Events](event-listening.ts) | Changes and validation events | `pnpm --filter model-reaction run example:event` |
| [Complex form](complex-form.ts) | Cross-field rules and errors | `pnpm --filter model-reaction run example:complex` |
| [Dirty data](dirty-data-conditional.ts) | Rejected input and conditional rules | `pnpm --filter model-reaction run example:dirty` |
| [Deep dependency chain](multi-record-deep-deps.ts) | Five layers across 100 records | `pnpm --filter model-reaction run example:multi-record` |
| [Schema composition](schema-composition/runner.ts) | Exact enums, independent defaults, replacements; [recipe](SCHEMA_COMPOSITION.md) | `pnpm --filter model-reaction run example:schema` |
| [React bindings](react-bindings.tsx) | Fields, selectors, draft, and ownership | `pnpm --filter model-reaction run example:react` |
| [Optional field metadata](react-field-meta.tsx) | Derive UI properties and pass `setMeta` to a business function | `pnpm --filter model-reaction run example:react` |

The React command executes [its SSR runner](react-bindings-runner.tsx).
Importing the component file does not execute the runner.
The metadata example has switches for delivery visibility and editing;
the runner verifies its editable, disabled, and hidden states. Its restriction
button passes `setMeta` to a function outside the component.

## Reference Recipes

| Topic | Reference |
| --- | --- |
| Stable and inline selectors | [Stable selector](react-best-practices/7-2-stable-selector.tsx), [computed selector](react-best-practices/7-2bis-model-computed.tsx) |
| Provider and committed-value controls | [Provider](react-best-practices/7-3-model-provider.tsx), [Field](react-best-practices/7-4-field-render-prop.tsx) |
| Error display, submission, and cleanup | [Touched](react-best-practices/7-5-touched.tsx), [submission](react-best-practices/7-6-submission-flow.tsx), [lifecycle](react-best-practices/7-8-lifecycle.tsx) |
| Application stores | [zustand](react-best-practices/7-10-2-with-zustand.tsx), [Redux](react-best-practices/7-10-3-with-redux.tsx), [comparison](react-best-practices/7-10-5-cheat-sheet.ts) |
| Ad-creation domain (Chinese) | [Schema composition, submission DTO, and draft recovery](AD_CREATION_CN.md) |

These are reference patterns, not standalone CLI programs. Module-level model
fixtures omit ownership for brevity; apply the
[owner lifecycle](../docs/REACT.md#model-lifecycle-in-react) in applications.
React contracts live in [REACT.md](../docs/REACT.md), and store integration
guidance in [COMPARISON.md](../docs/COMPARISON.md).

## Validation

Examples import public package entries. Repository runners resolve them to
source through `tsconfig.examples.json`; copied examples use the installed
package.

`pnpm --filter model-reaction run typecheck` checks source, tests, and a separate
examples project; lint includes `.ts` / `.tsx` examples. Three optional store
snippets (`7-10-2`, `7-10-3`, `7-10-5`) and their aggregate `index.ts` are
excluded from example typecheck because their dependencies and application
glue are not installed. Markdown recipes are not included in that check.
