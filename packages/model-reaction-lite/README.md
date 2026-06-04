# model-reaction-lite

A **synchronous-only** subset of [`model-reaction`](../../README.md). Same
schema-driven model + validator + reaction shape, but with the asynchronous
machinery deliberately removed:

| Feature | `model-reaction` | `model-reaction-lite` |
| --- | --- | --- |
| Sync `validator` (`(v) => boolean`) | yes | yes |
| Async `validator` (`Promise<boolean>`) | yes | **no** |
| `reaction.computed` (sync) | yes | yes |
| `reaction.action` side effect | yes | yes |
| `options.debounceReactions` | yes | **no** |
| `options.asyncValidationTimeout` | yes | **no** |
| `options.failFast` / `strictMode` / `errorFormatter` | yes | **no** |
| `field.transform` | yes | **no** |
| `Validator.condition` / `Rule.when` | yes | **no** |
| `Rule.withMessage` chaining | yes | **no** (pass `message` directly) |
| `setField` returns | `Promise<boolean>` | **`boolean`** |
| `model.settled()` | yes | **no** |
| `dirtyData` / `getDirtyData()` | yes | **no** (UI keeps raw input itself) |
| `subscribeField(field, cb)` | yes | **no** (use `subscribe(d => d.field, cb)`) |
| `getValidationSummary()` | yes | **no** (read `validationErrors` directly) |
| Event taxonomy | 6 events + `ErrorType` enum | **2 events**: `field:change` + `error` |
| `subscribe` `isEqual` argument | yes | **no** (always `Object.is`) |
| Reaction race / circular guard | yes | yes |
| `dispose()` | yes | yes |

## When to use lite

- Forms where every validator can be expressed synchronously.
- Pure computed/derived state inside a single tick — no debounced search,
  no remote uniqueness check.
- You want a smaller surface and simpler mental model: **set → validate →
  commit → reactions**, all in one synchronous call.

## When to use the full package

- You need `Promise<boolean>` validators (remote uniqueness, server-side
  rule checks).
- You debounce reactions for high-frequency inputs.
- You need `await model.settled()` to coordinate test/CI harnesses.

## Quick start

```ts
import { createModel, ValidationRules } from 'model-reaction-lite';

const m = createModel({
    name: {
        type: 'string',
        default: '',
        validator: [ValidationRules.required, ValidationRules.minLength(2)],
    },
    age: {
        type: 'number',
        default: 0,
        validator: [ValidationRules.number, ValidationRules.min(0)],
    },
    summary: {
        type: 'string',
        default: '',
        reaction: {
            fields: ['name', 'age'],
            computed: ({ name, age }) => `${name}(${age})`,
        },
    },
});

const ok = m.setField('name', 'Ada'); // boolean — synchronous
console.log(ok, m.data.summary); // true 'Ada(0)'

m.dispose();
```
