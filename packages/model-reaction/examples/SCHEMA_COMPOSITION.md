# Schema composition: a recipe that preserves exact types

English | [中文](SCHEMA_COMPOSITION_CN.md) | [Examples](README.md)

Split identity and order fields into schema factories, then merge their results
to create a model. Enum metadata, defaults and validation share one literal list.
Each factory call creates fresh object and array defaults. Infer data types from
the schema and export domain update functions separately.

This recipe addresses the three failure patterns observed in AI-11:

| Failure | Cause | Fix |
| --- | --- | --- |
| status becomes string | A widened default contributes string to the inferred read type | Apply `as const` only to the enum list; use `statusValues[0]` as the default |
| Readonly line properties or a tuple array | Whole-schema `as const` recursively affects defaults | Check fragments with `satisfies`, retaining ordinary object/array inference |
| Invalid status still commits | Enum tags and values are metadata, not runtime validation | Add a status validator accepting unknown input |

AI-11 checks exact equality of the line-element type. A readonly shape failing
that check does not make it unusable in every application. This recipe preserves
the task's requested `{ sku: string; qty: number }[]`.

## Use the implementation

These four compiled source files are the implementation reference. Keep them
in one directory when copying them:

| File | Responsibility |
| --- | --- |
| [identity-schema.ts](schema-composition/identity-schema.ts) | name, status, note, address and status validation |
| [order-schema.ts](schema-composition/order-schema.ts) | lines with independently created array defaults |
| [business-model.ts](schema-composition/business-model.ts) | Compose fragments, return the native model and export inferred types |
| [operations.ts](schema-composition/operations.ts) | Replace top-level fields when changing a city or appending a line |

```ts
import { createBusinessModel } from './schema-composition/business-model.js';
import { appendLine, changeCity } from './schema-composition/operations.js';

async function main() {
  const model = createBusinessModel();
  try {
    const citySaved = await changeCity(model, 'Shanghai');
    const lineSaved = await appendLine(model, { sku: 'pen', qty: 2 });
    if (citySaved && lineSaved) {
      console.log(model.data);
    }
  } finally {
    model.dispose();
  }
}

void main().catch(console.error);
```

This illustrates a call from a module. See [runner.ts](schema-composition/runner.ts)
for the complete runnable entry. The implementation imports only public
`model-reaction` APIs and needs no additional schema helper or core API.

## Why this composition works

### 1. One enum list controls both the default and validation

The identity fragment uses this configuration:

```ts
import type { FieldSchema } from 'model-reaction';

const statusValues = ['draft', 'published'] as const;
const statusField = {
  type: 'enum',
  values: statusValues,
  default: statusValues[0],
  validator: [{
    type: 'business-status',
    message: 'Status must be draft or published',
    validate: (value: unknown) => statusValues.some(status => status === value),
  }],
} satisfies FieldSchema<'enum'>;
```

The example above isolates the status field; the full identity fragment lives in
`identity-schema.ts`. `statusValues[0]` has type `'draft'`, so the default does not
introduce string into the enum union. The validator uses the same list, avoiding
separate allowed-value definitions. Keep the list and all schema configuration
fixed while models use them.

`satisfies Record<string, FieldSchema>` checks fragment structure while retaining
its actual field types. It does not automatically narrow every default to a
literal, so the enum default still needs the expression above. Do not annotate
the factory's return type as broad `Record<string, FieldSchema>`; doing so loses
specific field information. The [API guide](../docs/API.md#data-type-inference)
owns the inference contract.

### 2. Factories create mutable defaults

Each `createIdentitySchema()` call creates a new address. Each `createOrderSchema()`
call creates a new lines array and row object. The model factory calls both for
every instance, so those defaults are not shared between models. Only the fixed
enum list is shared.

Avoid applying `as const` to an entire fragment to preserve its type tags.
`satisfies` already checks the tags; a whole-fragment const assertion also affects
object properties and array elements. The resulting exact types here are:

| Field | Inferred type |
| --- | --- |
| name | `string` |
| status | `'draft' \| 'published'` |
| note | `string \| undefined` |
| address | `{ city: string }` |
| lines | `{ sku: string; qty: number }[]` |

note omits a default and therefore includes undefined. `BusinessModel` uses the
factory's `ReturnType`, `BusinessData` uses the model's data type, and the appended
line parameter uses `BusinessData['lines'][number]`. There is no duplicated full
data interface or explicit `createModel<T>` overriding inference.

### 3. Replace top-level fields when updating data

`changeCity` submits a new address object. `appendLine` submits a new array and
copies the caller's row. Both retain the setter's `Promise<boolean>` contract;
callers handle validation failure or rejection. Mutable nested types do not
enable observation of in-place city changes or `lines.push`. If reactions are
added later, wait for `model.settled()` outside callbacks when a business operation
needs the fully derived result.

Keep fragment field names unique and compose before `createModel`. Do not mutate
schemas belonging to existing instances; create new fragments and a new model
for new configuration. The model owner calls `dispose()` and subscription owners
call their unsubscribe functions.

## Compile and verify

From the repository root:

```bash
pnpm --filter model-reaction run typecheck
pnpm --filter model-reaction run example:schema
```

[type-contract.ts](schema-composition/type-contract.ts) compiles with the examples
project. It checks exact inferred types and negative setter cases for invalid
status, wrong qty types and unknown fields. Its `@ts-expect-error` directives mark
expected compiler failures, rather than suppressing implementation errors. Its
check function is never run; applications need not copy this file.

The runner checks top-level replacements, subscription counts, independent default
references and the status rule. It creates and disposes its own models. Importing
the four implementation files does not create instances or execute the example.
The existing package `examples` inclusion ships these files.

**Initial verification (2026-11-20):** the four implementations also passed the
frozen AI-11 type, runtime and integration-constraint checks in a standalone consumer,
including rejection of an invalid external status while retaining the committed
value and isolation of a second model. The additional exact-type file and runner
also compiled and ran in that consumer. Verification used TypeScript 5.9.3 and the
first baseline's locally built tarball, SHA-256
`ecb40d684565d24b91bb5662109a7b1d52c1284fbc15f4733b201e362ca81652`.
That package is labeled 1.2.0 and includes unreleased behavior; its version label
does not establish the behavior of the online release with the same number.

The checks above validate the recipe's types and behavior. Subsequent independent
resampling passed all three AI-11 first deliveries; each read and adopted this
Recipe. Original scores remain separate. Three samples only cover this scenario.
