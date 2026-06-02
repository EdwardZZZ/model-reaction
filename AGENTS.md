# AGENTS.md

> A high-density guide for **coding agents / LLMs** working on or with the
> `model-reaction` library. Read this **before** README when you only have
> a few KB of context budget.
>
> 给 **AI 编码代理 / LLM** 的高密度上手指南。当你的上下文预算只够读一个
> 文件时，先读这个，别读 README。

---

## 1. Mental Model · 心智模型

```
schema  ─►  ModelManager  ─►  data            (validated, source of truth)
                          ├─►  dirtyData      (unvalidated user input)
                          └─►  reactions      (auto-derived fields)
```

**EN.** Three layers, nothing else:

1. `data` — only fields that **passed** validation live here.
2. `dirtyData` — last user input that **failed** validation, indexed by field.
3. `reactions` — derived values recomputed when their declared `fields`
   change. They write back into `data`.

**CN.** 三层结构，仅此而已：

1. `data` —— 只有**通过校验**的值会落地这里。
2. `dirtyData` —— 校验失败的用户输入暂存在这里。
3. `reactions` —— 依赖 `fields` 变化时自动重算的派生字段，结果写回 `data`。

---

## 2. The 5 APIs You Use 90% of the Time · 90% 场景只用 5 个 API

```ts
const m = createModel(schema, options?);     // factory
await m.setField('name', 'Ada');              // set + validate; returns boolean
m.getField('name');                           // read
await m.validateAll();                        // re-validate every field
m.dispose();                                  // ALWAYS call this in cleanup
```

**Discriminating rules — 区分原则：**

| Need / 需求 | API |
| --- | --- |
| Set one field with validation | `setField(name, value)` |
| Set many fields atomically | `setFields({ a, b })` |
| Read current value | `getField(name)` or `m.data.name` |
| Get failed input back | `getDirtyData()` |
| React to change outside React | `subscribeField` / `subscribe` |
| Inspect schema for tooling | iterate the schema literal directly (it's a plain object) |

---

## 3. The 5 Pitfalls You'll Hit · 5 个最常见的坑

1. **Forgetting `await`** — `setField` returns `Promise<boolean>` (true = passed validation). If you don't await, validation may still be in-flight.
   忘记 `await` —— `setField` 返回 `Promise<boolean>`，不等就读 `data` 容易误判。

2. **Reading `data` after a failed `setField`** — failed values go to `dirtyData`, not `data`. Use `getDirtyData()` to retrieve them.
   `setField` 失败后值在 `dirtyData`，不在 `data`。

3. **Side effects inside `reaction.computed`** — `computed` MUST be pure. Put side effects in `reaction.action` instead.
   `computed` 必须纯函数；副作用放 `action`。

4. **Not calling `dispose()`** — leaks reactions, event listeners and pending validation timers. Always wire it to your cleanup path (React effect, test `afterEach`, server shutdown).
   不调用 `dispose()` 会泄漏。

5. **Sharing one model across React trees without dispose** — see [docs/REACT.md](docs/REACT.md). Use `useEffect` cleanup or instantiate per route.
   跨树共享 model 不释放会泄漏；用 `useEffect` 清理或按路由实例化。

---

## 4. Code Skeletons (copy-paste these) · 直接抄的代码骨架

### 4.1 Form model · 表单模型

```ts
import { createModel, ValidationRules } from 'model-reaction';

export const userModel = createModel({
  name: {
    type: 'string',
    default: '',
    validator: [
      ValidationRules.required.withMessage('Name required'),
      ValidationRules.minLength(2).withMessage('Min 2 chars'),
    ],
  },
  email: {
    type: 'string',
    default: '',
    validator: [
      ValidationRules.required,
      ValidationRules.email.withMessage('Bad email'),
    ],
  },
});
```

### 4.2 Cross-field reaction · 跨字段反应

```ts
fullName: {
  type: 'string',
  default: '',
  reaction: {
    fields: ['firstName', 'lastName'],
    computed: ({ firstName, lastName }) =>
      `${firstName} ${lastName}`.trim(),
  },
},
```

### 4.3 React form field · React 表单字段

```tsx
import { useModelFieldState } from 'model-reaction/react';

function Input({ model, field, label }) {
  const [value, setValue, meta] = useModelFieldState(model, field);
  const [touched, setTouched] = useState(false);
  const showError = touched && meta.error;

  return (
    <label>
      <span>{label}</span>
      <input
        value={value ?? ''}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={Boolean(showError)}
        disabled={meta.validating}
      />
      {showError && <small role="alert">{meta.error}</small>}
    </label>
  );
}
```

### 4.4 Selector subscription · selector 订阅

```ts
const unsub = model.subscribe(
  (data) => data.cart.totalCents,
  (next, prev) => console.log('total changed', prev, '→', next)
);
// later: unsub()
```

### 4.5 Iterate the schema literal · 直接遍历 schema 字面量

```ts
// schema is just a plain object — no helper API needed.
for (const [name, field] of Object.entries(schema)) {
  console.log(name, field.type, field.validator?.length ?? 0);
}
```

---

## 5. What's NOT in this Library · 库不做的事

These are **deliberate omissions**. Don't add them; don't fake them.

| Missing / 缺失 | Why / 原因 |
| --- | --- |
| Per-field `touched` state in the model | Belongs to UI lifecycle, not to data model. Use component-local `useState` (see §4.3). |
| `commitDirty(field)` / `resetDirty(field)` | Computed fields that depend on a dirty field could be poisoned. Reset by recreating the model. |
| Arbitrary side-effect from validators | Validators are pure boolean tests. Use reactions for side-effects. |
| Synchronous batching across `setField` calls | Each `setField` is its own validation cycle. Use `setFields({ ... })` for atomic batches. |
| Plugin / middleware system | Compose at the schema level (factory functions returning `FieldSchema`). |

---

## 6. When You're About to Modify the Library · 改库代码前

Run **all three** before submitting:

```bash
npm run lint
npm run typecheck:test    # types of test files (CI gate)
npx jest --silent         # 200+ tests including doc scenarios
```

Then verify the README scenarios still work end-to-end:

```bash
npm run example:react
```

**Files that act as living spec — touch with care:**

| File | Role |
| --- | --- |
| [src/__tests__/integration.test.ts](src/__tests__/integration.test.ts) | Every README code snippet runs as a test here. Breaking this = breaking the docs contract. |
| [src/types.ts](src/types.ts) | Public type surface. Adding a method here means updating `index.ts` AND `ModelManager` AND README + README_CN. |
| [README.md](README.md) / [README_CN.md](README_CN.md) | Always update both languages in the same patch. |

---

## 7. Glossary · 术语表

| Term | Meaning |
| --- | --- |
| `data` | Validated source of truth. Read via `m.data` or `getField`. |
| `dirtyData` | Last user input whose validation **failed**, indexed by field. Cleared by `clearDirtyData()` or by next successful `setField` of that field. |
| `reaction.computed` | Pure function: `deps -> derived value`. |
| `reaction.action` | Optional side-effect callback fired after computed returns. |
| `settled()` | Promise that resolves when all in-flight reactions and validations finish. Use it in tests. |
| `verify-then-commit` | Set-field protocol: validate first, write to `data` only on pass; otherwise write to `dirtyData`. |
| `commitValid` | Internal: when `validateAll` finds the dirty value now passes, promote it from `dirtyData` to `data`. |

---

If anything in this file conflicts with [README.md](README.md), the README wins. Open an issue and we'll fix this file.
若本文件与 [README_CN.md](README_CN.md) 冲突，以 README_CN 为准，请提 issue 让我们修这个文件。
