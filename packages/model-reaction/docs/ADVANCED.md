# Advanced Usage

[中文版本](ADVANCED_CN.md) | [Documentation](README.md)

## Business validation

The model stores transformed field values and runs declared computations.
Application functions or a separate validation library own required fields,
cross-field checks, server acceptance, and error display.

```ts
interface Budget { total: number; daily: number }

function checkBudget(data: Readonly<Budget>): string | null {
  if (!Number.isFinite(data.total) || data.total < 100) return 'Total must be at least 100';
  if (!Number.isFinite(data.daily) || data.daily < 10 || data.daily > data.total) {
    return 'Daily must be between 10 and total';
  }
  return null;
}

function updateBudget(model: ModelReturn<Budget>, input: Partial<Budget>): string | null {
  const candidate = { ...model.data, ...input };
  const error = checkBudget(candidate);
  if (error) return error;
  model.setFields(input);
  return null;
}
```

Normalize the candidate before checking when transforms change business
meaning; share a pure parser between schema and domain entry points. A
preflight of input fields does not automatically check subsequent computed
values. Keep calculations valid by construction, check after settlement, or
evaluate an isolated candidate model when a domain needs full graph acceptance.
Do not use transform as a replacement validator framework.

An editor may instead commit incomplete values, check on blur/submission, and
retain errors outside the model. Conditional checks are plain application
conditions. See [business-validation.ts](../examples/business-validation.ts).

## Async actions and stale responses

Keep `computed` synchronous; put requests in an action or application service.
Return/await the request when `settled()` should track it.

```ts
let revision = 0;
const model = createModel({
  query: { type: 'string', default: '' },
  results: { type: 'array', default: [] as string[] },
  normalized: { type: 'string', reaction: {
    fields: ['query'],
    computed: ({ query }) => query.trim(),
    action: [async () => {
      const version = revision;
      const query = model.data.normalized;
      const results = await search(query);
      if (version !== revision) return;
      model.setField('results', results);
    }],
  } },
});
const off = model.subscribe((data) => data.query, () => { revision++; });
// Owner cleanup: revision++; off(); model.dispose();
```

Increment revisions on input change, before responses can resume. Comparing
only the current text fails for A → B → A edits. Also invalidate on disposal.
The scheduler cancels unstarted items; it cannot interrupt running requests.
Use service timeouts or AbortController where needed. The complete runnable
[async action example](../examples/async-action.ts) includes cleanup.

All calculation cascades complete synchronously; actions always start later.
Equal normalized values still permit an action group. When request frequency
needs limiting, debounce at the application input or service boundary.

## Typed error events

```ts
const off = model.on(ModelEvents.REACTION_ERROR, (error) => {
  console.error(error.field, error.message);
});
try {
  model.setFields(input);
} catch (error) {
  // Direct getter/transform/unknown-field failures throw synchronously.
}
```

Reaction failures are event diagnostics, not a model error store or business
validation result. `settled()` resolves after tracked work even if an action
fails; observe domain status/error events to decide whether submission is safe.
The [API](API.md#events) owns event names and payloads.

## Model organization and inference

Keep one model for fields sharing a lifecycle and dependency graph. Compose
focused schema fragments into a flat object, with unique names. Independent
editors use independent models; coordination belongs in application code.
Separate fields own separate computed outputs.

Use `createModel<T>(schema)` for explicit domain contracts and schema inference
for small local models. `type` and enum `values` do not validate runtime payloads.
Missing defaults infer `undefined`; useful object/array defaults retain shape.
Map API payloads to known field keys before writing. See the
[ad-creation recipe](../examples/AD_CREATION_CN.md) for schema/DTO boundaries.

## Performance and testing

Use `setFields` for related inputs, narrow subscriptions for readers, and pure
computations with declared dependencies. The dependency engine is not a
transaction or a topological
single-pass scheduler; a diamond can compute intermediate values before its
final value. Actions wait for the calculation chain.

Test business limits, normalization, submission snapshots, stale requests,
action failures, owner disposal, and transformed text/IME behavior.
For asynchronous scenarios wait for model settlement and your application
checks separately. Repository checks live in [AGENTS.md](../AGENTS.md).
