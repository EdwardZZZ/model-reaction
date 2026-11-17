# React Bindings

[中文版本](REACT_CN.md) | [Documentation](README.md)

Import from `model-reaction/react`; React 18+ is an optional peer dependency.
Bindings use `useSyncExternalStore` for field/selector reads. The core does not
import React.

## Hooks & components

| API | Result/purpose |
| --- | --- |
| `useModelField(model, field)` | Committed field value |
| `useModelFieldState(model, field)` | `[value, setValue]`; synchronous setter |
| `useModelFields(model, fields)` | Object containing listed field values |
| `useModelSelector(model, selector, isEqual?)` | Model-filtered selector subscription |
| `useModelComputed(model, selector, isEqual?)` | Stable event subscription, React snapshot filtering |
| `ModelProvider` / `useModel<T>()` | Explicit model context |
| `Field<T, K>` | Render-prop `{ value, setValue }`, using context |
| `shallow(a, b)` | Shallow equality helper for selector results |

`FieldSetter<V>` is `(value: V) => void`; `FieldMeta` and validation metadata
are removed. Public React types also include `ModelProviderProps`, `FieldProps`,
and `FieldRenderProps`.

## Basic example

```tsx
import { useEffect, useState } from 'react';
import { createModel, type ModelReturn } from 'model-reaction';
import { ModelProvider, useModel, useModelFieldState } from 'model-reaction/react';

interface User { name: string }

function NameInput() {
  const model = useModel<User>();
  const [name, setName] = useModelFieldState(model, 'name');
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
}

export function UserForm() {
  const [model, setModel] = useState<ModelReturn<User> | null>(null);
  useEffect(() => {
    const owned = createModel<User>({ name: { type: 'string', default: '' } });
    setModel(owned);
    return () => owned.dispose();
  }, []);
  if (!model) return null;
  return <ModelProvider model={model}><NameInput /></ModelProvider>;
}
```

Writes commit synchronously, so text controls can bind directly to committed
strings. Non-text controls can use the same tuple, or `<Field>`:

```tsx
<Field<User, 'name'> name="name">
  {({ value, setValue }) => <input value={value} onChange={(event) => setValue(event.target.value)} />}
</Field>
```

## Input conversion and composition

Parse non-string inputs in the control before writing a typed field value:

```tsx
function AmountInput({ model }: { model: ModelReturn<{ amount: number }> }) {
  const [amount, setAmount] = useModelFieldState(model, 'amount');
  return <input type="number" value={Number.isFinite(amount) ? amount : ''}
    onChange={(event) => setAmount(Number(event.target.value))} />;
}
```

This simple binding maps empty text to `0` and does not retain spellings such
as `2.`, `002`, or `2.00`. Applications that need those spellings can keep local
text and choose when to parse/commit it. Objects, arrays, and dates require
appropriate controls/parsers.

The adapter supplies field values and setters; application controls own text
formatting, blur/error feedback, and composition policy. For transformations
that could interrupt IME input, buffer composition text in the control and
write on `compositionend`. Catch synchronous write exceptions where the
application owns feedback.

## Model lifecycle in React

The owner creates and disposes the model. `ModelProvider` only supplies context;
it does not dispose an externally owned instance. Each hook unsubscribes on
cleanup. `useModel` requires a provider and throws when none is present.

For owners whose schemas start actions, create in an effect, as above. React
StrictMode's extra setup/cleanup disposes the first instance; the active mount
gets a new one. A render that is abandoned must not leak timers or side effects.
Use an independent model for independently owned editors. Module-level models
are appropriate only for intentionally shared application lifetimes.
Changing an entity key should recreate the model rather than share an editor
singleton. See [the lifecycle recipe](../examples/react-best-practices/7-8-lifecycle.tsx).

## useModelSelector vs useModelComputed

Both reuse selector snapshot caching and supplied equality (default
`Object.is`) to avoid rendering when the selected value is equal.
Their subscription policies are intentionally distinct:

| Policy | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| Subscription | `model.subscribe` filters notifications | Field-change subscription notifies React |
| Inline selector identity changes | Rebuilds model subscription | Keeps event subscription stable |
| Unrelated field changes | Filtered before notifying React | React reads and compares the selection |
| Best fit | Stable `useCallback` selectors | Inline selectors depending on props |

```tsx
const selectTotal = useCallback((data: Cart) => data.price * data.qty, []);
const total = useModelSelector(model, selectTotal);
const scaled = useModelComputed(model, (data) => data.price * multiplier);
const summary = useModelComputed(model, (data) => ({ qty: data.qty, price: data.price }), shallow);
```

Selectors should be pure; supplied equality must describe the selected
value. These Hooks derive values for readers; `reaction.computed` commits
a model field and can trigger downstream calculations.

## Submission flow

Application code owns business checks and feedback. Pause editing while
submitting or capture and submit the exact immutable field map you checked:

```ts
await model.settled();
const snapshot = model.data;
const errors = checkBusinessData(snapshot);
if (Object.keys(errors).length > 0) {
  setErrors(errors);
  return;
}
await api.save(snapshot);
```

`settled()` waits for model calculations and returned action work, not arbitrary
application validation or detached requests. Await your own asynchronous checks
explicitly. Nested values are shallow-shared; avoid mutating them or clone the
payload when deeper isolation is required. The server remains authoritative.
See [submission recipe](../examples/react-best-practices/7-6-submission-flow.tsx).

## SSR and concurrent rendering

The bindings provide server snapshots for models supplied by the caller.
Create a model per request and dispose it after rendering; avoid sharing model
state between users. An effect-created owner renders its fallback on the server;
precreate and provide a request-owned model when server-rendered fields are needed.
Snapshot caching uses current selectors and only publishes committed formatter
updates. Mounted regression coverage includes StrictMode and suspended renders.

The runnable [React example](../examples/react-bindings.tsx) has a separate
[SSR runner](../examples/react-bindings-runner.tsx):

```bash
pnpm --filter model-reaction run example:react
```

For upgrading old metadata bindings, see [API migration](API.md#removing-validation-migration-unreleased).
