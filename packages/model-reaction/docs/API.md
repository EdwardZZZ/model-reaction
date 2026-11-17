# API Reference

[中文版本](API_CN.md) | [Documentation](README.md)

## Entries and types

| Entry | Runtime exports |
| --- | --- |
| `model-reaction` | `createModel`, `ModelEvents`, `SKIP_REACTION` |
| `model-reaction/react` | Hooks, `ModelProvider`, `Field`, `shallow` |
| `model-reaction/devtools` | Opt-in `createModel` |

Root type exports: `Model`, `FieldSchema`, `Reaction`, `ReactionAction`,
`ModelReturn`, `ModelError`, `ModelErrorCode`, `ModelEventMap`,
`InferFieldType`, `InferModelData`. Internal coordination types are not exported.
The core entry does not import React or DevTools integration.

## Creating a model

```ts
import { createModel, type Model } from 'model-reaction';

interface Person { name: string; age: number }
const schema: Model<Person> = {
  name: { type: 'string', default: '' },
  age: { type: 'number', default: 18 },
};
const person = createModel<Person>(schema);
const inferred = createModel({ name: { type: 'string', default: '' } });
```

The schema is a flat map of own field names. Values can contain nested data.
Keys such as `constructor` and `__proto__` work as own properties; use
`['__proto__']` or `Object.fromEntries` when constructing that key.
Each field accepts:

| Property | Contract |
| --- | --- |
| `type` | Required: `string`, `number`, `boolean`, `object`, `array`, `date`, or `enum` |
| `default` | Optional initial value, cloned and seeded directly |
| `values` | Optional enum literals for inference; no runtime membership check |
| `transform` | Optional synchronous `(value: any) => any`, applied to writes and computed results |
| `reaction` | Optional single `{ fields, computed, action? }` |

`type` is metadata, not runtime validation. Transforms must return the intended
value synchronously; Promise-returning transforms are unsupported. Defaults
do not run transforms. Missing or `undefined` defaults leave the value absent.
Construction seeds all defaults, then triggers reactions reachable from
non-reaction fields with defaults. A reaction with no triggered input, including
`fields: []`, does not execute automatically. Initial actions are deferred so
closures can safely refer to the created model.

Schema inference includes `undefined` without a default, retains object/array
shapes from useful defaults, and enum unions from readonly `values`.
It also includes the actual default type. An explicit `createModel<T>` relies
on the caller to initialize `T` correctly.

`createModel` accepts only the schema; there is no construction options argument.
All field computations execute synchronously.

## Reads and subscriptions

| API | Result |
| --- | --- |
| `model.data` | Stable `Readonly<T>` shallow-frozen snapshot |
| `model.getField(key)` | Stored value; missing reads return `undefined` at runtime |
| `model.subscribe(selector, callback, isEqual?)` | Unsubscribe function |
| `model.on(event, callback)` | Unsubscribe function |

`data` retains its identity until a field changes. Old snapshots retain their
field map, but nested values remain shared and mutable. Replace whole nested
values through setters; in-place mutations are not observed.

Subscriptions compute an initial selection without calling the callback, then
compare on each field-change event with `Object.is` or supplied equality.
Callbacks receive `(value, previous)`. Listener exceptions are logged and
isolated; they do not roll back writes. Unsubscribe during cleanup.

## Writes

```ts
model.setField('name', 'Ada');       // void
model.setFields({ name: 'Ada', age: 36 }); // void
```

Both setters are synchronous. `setField` shares the batch write path.

1. Verify every key before reading any value or running transforms. Unknown
   keys emit `field:not-found` and throw.
2. Read and transform all candidates before committing any field. A getter
   or transform exception throws and leaves this batch uncommitted.
3. Commit prepared values in object key order. Each structurally changed value
   invalidates the host's old action version and emits `field:change`.
4. Trigger dependent computations for the changed input set; release the batch
   task in `finally`.

Synchronous calculation cascades finish before the setter returns.
Actions always start later and are not awaited by setters.

This is preparation followed by individual commits, not an all-or-nothing
transaction. Events run after each commit and can observe intermediate state
or reenter a setter; remaining outer candidates still commit in order.
Disposal from a listener stops remaining writes.

Field equality retains the existing behavior: primitives use strict equality,
arrays/plain objects compare recursively, `Date` compares timestamps, `RegExp`
compares source/flags, and other instances such as `Map` and `Set` compare by reference. Equal replacements
do not replace the stored value or trigger events/reactions; `NaN` counts as
changed and `+0`/`-0` as equal. Selector equality is independently configurable.

## Reactions

```ts
import { SKIP_REACTION } from 'model-reaction';

const reaction = {
  fields: ['price', 'qty'],
  computed: ({ price, qty }: Record<string, any>) =>
    qty > 0 ? price * qty : SKIP_REACTION,
};
```

`computed` must be synchronous and pure. Declare every model input in `fields`.
Dependencies are top-level names, not nested paths. TypeScript checks the
return type against the host's `type` tag; enum membership is not checked, and
a bare `Reaction` uses `any`.

Computed output passes through the host transform and synchronous commit.
Equal computed values still permit actions; ordinary downstream propagation
requires a changed host, except for the initial seeded calculation pass.
`SKIP_REACTION` skips the host transform/write, actions, and downstream
propagation for that computation. A skipped successor still invalidates an
older unstarted action group.

Thrown computation/transform errors emit `reaction:error`, preserve the host
value, and prevent that computation's action group. A Promise-like computed
result is rejected as a contract violation; it is observed to prevent an
unhandled rejection. Missing declared dependencies emit `dependency:error`
and are supplied as `undefined`. Runtime calculation recursion emits
`reaction:error` with `circular_dependency`; the core does not statically
detect arbitrary action writeback cycles.

## Action groups

```ts
reaction: {
  fields: ['source'],
  computed: ({ source }) => source * 2,
  action: [
    () => { model.setField('other', model.data.target); },
    async () => { await save(model.data); },
  ],
}
```

`ReactionAction` is `() => void | PromiseLike<void>`. It receives no arguments;
read model state through a closure. Each successfully handled computation can
register a group, including initialization and unchanged computed values.

- Registration captures the host version assigned when the reaction was
  scheduled. Only the latest version can start or continue.
- The first call is deferred to a microtask after all calculation tasks finish.
  Each subsequent item checks the same barrier before calling synchronously.
- Items follow array order and await their own returned work. Different
  groups attempt to start in schema order and wait independently.
- Repeated function references retain their last position within an array and
  belong to their last registered host among pending items.
- New host computations or changed direct host writes cancel unstarted items.
  Running items continue and their returned Promises remain tracked.
- An item that throws/rejects emits `reaction:error` and stops only its group.
  A late old failure is still reported while the model is alive.

The scheduler does not cancel requests or suppress writeback within a running
action. Application revisions/AbortController handle stale responses,
timeouts, and disposal. Return or await asynchronous work for it to be tracked.
Never await this model's `settled()` inside its action: that would wait for
the action itself.

## Settlement and disposal

`settled(): Promise<void>` waits for tracked batches,
calculation cascades, and action groups. It does not validate values or reject
when a reaction fails. Observe error events or application status separately.
It cannot track detached work, future writes, or arbitrary application checks.

`dispose(): void` is idempotent: cancels unstarted actions, releases
settlement waiters, clears subscriptions and data. Running action rejections
remain observed; application code must avoid writing after disposal.
Setters on a disposed model throw; reads see cleared data and `settled()`
resolves.

## Events

| `ModelEvents` key | Event | Payload |
| --- | --- | --- |
| `FIELD_CHANGE` | `field:change` | `{ field, value }` |
| `FIELD_NOT_FOUND` | `field:not-found` | `ModelError` |
| `DEPENDENCY_ERROR` | `dependency:error` | `ModelError` |
| `REACTION_ERROR` | `reaction:error` | `ModelError` |

`ModelError` has `code`, optional `field`, `message`, optional `originalError`.
Codes: `field_not_found`, `dependency_error`, `circular_dependency`,
`reaction_error`. There is no model error store; subscribe before the operation
you want to observe. Constructor-time calculations may precede subscriptions.

## Removing validation migration (unreleased)

This release removes built-in validation rather than retaining an adapter.

| Removed/changed | Migration |
| --- | --- |
| `FieldSchema.validator`, `Validator`, `ValidationError` | Application checks or a validation library |
| `model-reaction/validation`, `Rule`, `ValidationRules`, `formatValidationErrors` | Application helpers; the subpath is no longer exported |
| `asyncValidationTimeout` | Request/service timeout |
| `debounceReactions`, `ModelOptions`, `createModel` options argument | Call `createModel(schema)`; rate-limit requests/input in application code |
| `setField`/`setFields: Promise<boolean>` | Synchronous `void`; remove boolean branching, catch exceptions |
| `validateAll()` | Wait for model work, then check the business snapshot |
| `validationErrors`, `getDirtyData()`, `clearDirtyData()` | Application/UI errors and rejected draft values |
| Validation and dirty-data events | Application state or events |
| `FieldMeta`, `[value, setter, meta]`, `<Field>`'s `meta` | `[value, setter]` and application feedback |
| `useDraftField`, `DraftField`, `UseDraftFieldOptions` | Direct `useModelFieldState` binding; text/blur/error policy in application controls |
| DevTools dirty/error snapshots, validator count, snapshot subscription | Committed data and change subscription |

Previously rejected direct/computed values now commit after transformation.
Computations formerly delayed by `debounceReactions` now run on each changed
input, including during construction. Reading after a setter sees the completed
calculation chain. Actions remain deferred and tracked by `settled()`.
Typed tags and enum literals do not replace removed checks. Move acceptance
rules before writes if committed data must remain valid. Keep incomplete text
outside the model when appropriate, or accept incomplete editor values and
check at submission. The React adapter no longer provides draft text,
formatter synchronization, touched state, or local write-exception storage.

```ts
model.setFields(input);
await model.settled();
const snapshot = model.data;
const errors = checkBusinessData(snapshot);
if (Object.keys(errors).length === 0) await save(snapshot);
```

Retained contracts: one reaction per field, action arrays, structural equality,
two selector Hook policies, batch key preflight. Older removed `strictMode`,
`failFast`, and reaction arrays remain unsupported.
