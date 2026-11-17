# model-reaction

[中文版本](README_CN.md) | English

A TypeScript field model with synchronous writes, computed dependencies,
scheduled actions, and optional React bindings.

This branch contains an unreleased breaking change: validation is now owned by
the application. See the [migration guide](docs/API.md#removing-validation-migration-unreleased).

## Installation

Requires Node.js 18 or later; React bindings require React 18 or later.

```bash
npm install model-reaction
npm install react # when using the React entry
```

## Quick start

```ts
import { createModel } from 'model-reaction';

const cart = createModel({
  price: { type: 'number', default: 10 },
  qty: { type: 'number', default: 1, transform: Number },
  total: {
    type: 'number',
    reaction: {
      fields: ['price', 'qty'],
      computed: ({ price, qty }) => price * qty,
      action: [() => { console.log('Total:', cart.data.total); }],
    },
  },
});

cart.setFields({ price: 20, qty: 3 });
console.log(cart.data.total); // 60, computation is synchronous
await cart.settled(); // also waits for returned action work
cart.dispose();
```

Each top-level schema property defines one field. `setField` and `setFields`
transform and commit synchronously, return `void`, and throw for write errors.
`type` and enum `values` describe types; they do not check runtime input.
Defaults are cloned and seeded directly.

`data` is a stable, shallow-frozen snapshot. Replace objects, arrays, and
mutable values such as `Date` through setters; nested mutation is not observed.
Structural field equality is preserved. Batch inputs are prepared before any
commit, then each changed field emits an event and dependent calculations run.
Events can observe intermediate state; a batch is not a transaction.

## Reactions and actions

Each field has at most one reaction. `fields` declares top-level inputs;
`computed` synchronously and purely derives the host value. Its result passes
through the host transform. Return `SKIP_REACTION` to retain the host value
and skip its actions and downstream propagation.

`action` is an array of no-argument functions reading the model through a
closure. Groups start in a microtask after calculation settles; each item
checks that barrier again. New host versions cancel unstarted items, while
running Promises remain tracked. Groups run independently, and repeated
function references belong to their last registration.

Calculations finish before a setter returns. Use `await settled()` to wait for
action work. Never await this model's `settled()` inside one of its actions.
See the [complete contract](docs/API.md#action-groups).

## Business checks and events

Check a candidate before writing when the model must accept only approved
values. An editor can also store incomplete values and check the settled
snapshot before submission. Errors, request timeouts, and stale-response
protection belong to application code. See [advanced usage](docs/ADVANCED.md).

```ts
const off = cart.on('field:change', ({ field, value }) => console.log(field, value));
cart.on('reaction:error', (error) => console.error(error.message));
off();
```

## React bindings

```tsx
import type { ModelReturn } from 'model-reaction';
import { useModelFieldState } from 'model-reaction/react';

function NameInput({ model }: { model: ModelReturn<{ name: string }> }) {
  const [name, setName] = useModelFieldState(model, 'name');
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
}
```

Inputs bind directly to committed values with synchronous setters.
Parsing, text formatting, IME buffering, and business feedback belong to
application controls.
See [React bindings](docs/REACT.md) for ownership, selectors, SSR, and recipes.

## Documentation

[Documentation index](docs/README.md) · [API](docs/API.md) ·
[Examples](examples/README.md) · [DevTools](docs/DEVTOOLS.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Coding agent guide](AGENTS.md)

## License

[ISC](LICENSE)
