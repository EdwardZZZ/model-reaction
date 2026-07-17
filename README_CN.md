# model-reaction

[English Version](README.md) | 中文

一个类型安全的 TypeScript 数据模型库：验证、依赖反应、脏数据跟踪、类型化事件 —— 并提供可选的 React 绑定。

---

## 为什么选择 model-reaction

- **数据验证** —— 同步 / 异步规则、自定义消息、条件验证、跨字段验证。
- **依赖反应** —— 字段在依赖变化时自动重算，可选防抖。
- **脏数据跟踪** —— 验证失败的值单独保存，便于清理。
- **类型化事件** —— 订阅字段变化、验证流程和反应错误。
- **类型安全** —— Schema 完整驱动 `model.data` 类型。
- **可选 React 适配** —— 细粒度、selector 级订阅；核心入口零 React 依赖。

### 面向 AI 友好设计

`model-reaction` 刻意保持较小的 API 面：schema 字面量定义模型，
`setField` / `setFields` 是主要写入路径，验证失败的值进入 `dirtyData`，
React 生命周期显式处理（`await setField(...)`，cleanup 中调用 `dispose()`）。
Coding agent 可以先阅读 [AGENTS.md](AGENTS.md) 获取精简规则。

## 安装

```bash
npm install model-reaction          # 仅核心
npm install model-reaction react    # + React 绑定（peer 依赖，react >= 18）
```

```ts
import { createModel, ValidationRules } from 'model-reaction';
import { useModelField } from 'model-reaction/react'; // 可选
```

> 默认入口零 React 依赖；只有 `model-reaction/react` 才会引入 React。

## 快速上手

```typescript
import { createModel, ValidationRules } from 'model-reaction';

interface User {
  name: string;
  age: number;
}

const user = createModel<User>({
  name: {
    type: 'string',
    validator: [ValidationRules.required],
    default: '',
  },
  age: {
    type: 'number',
    validator: [ValidationRules.required, ValidationRules.min(18)],
    default: 18,
  },
});

await user.setField('name', 'John');
await user.setField('age', 30);

const ok = await user.validateAll();
console.log(ok, user.data); // true { name: 'John', age: 30 }
```

始终 `await setField(...)`，确保验证完成后再读取 `data`；
当 model 的 owner 卸载时，始终在 cleanup 路径里调用 `dispose()`。

## 核心概念

### 反应（Reactions）

字段可以声明依赖列表与 `computed` 函数；任一依赖变化时，字段会自动重算。

```typescript
const m = createModel({
  first: { type: 'string', default: '' },
  last:  { type: 'string', default: '' },
  full:  {
    type: 'string',
    default: '',
    reaction: {
      fields: ['first', 'last'],
      computed: (v) => `${v.first} ${v.last}`,
    },
  },
});
```

### 脏数据

验证失败的值会被记录为"脏数据"，与正常状态隔离保存。

```typescript
user.getDirtyData();   // 验证失败的值
user.clearDirtyData(); // 清空
```

### 事件

```typescript
user.on('validation:error', (e) => console.error(e.field, e.message));

// `on` 返回取消订阅函数（与 `subscribe` / `subscribeField` 一致）：
const off = user.on('field:change', (e) => console.log(e.field, '=', e.value));
off(); // 停止监听
```

完整事件列表见 [docs/API_CN.md](docs/API_CN.md#事件)。

## React 绑定

```tsx
import { useEffect, useState } from 'react';
import { createModel, ValidationRules } from 'model-reaction';
import { ModelProvider, useModel, useModelField, useModelFieldState } from 'model-reaction/react';

function NameInput() {
  const user = useModel<User>();
  const name = useModelField(user, 'name');
  return <input value={name} onChange={async (e) => { await user.setField('name', e.target.value); }} />;
}

function AgeInput() {
  const user = useModel<User>();
  const [age, setAge, meta] = useModelFieldState(user, 'age');
  return (
    <>
      <input type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} />
      {meta.error && <span>{meta.error}</span>}
    </>
  );
}

function UserModelOwner() {
  const [user] = useState(() => createModel<User>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
    age:  { type: 'number', default: 18, validator: [ValidationRules.min(18)] },
  }));
  useEffect(() => () => user.dispose(), [user]);
  return <ModelProvider model={user}><NameInput /><AgeInput /></ModelProvider>;
}
```

React 生命周期推荐两种模式：**Provider owner**（共享状态限定在某个子树内）
或 **per-route model**（每个路由 / 弹窗创建新实例）；避免模块级 singleton。
完整 hook 列表、生命周期示例、`useModelSelector` vs `useModelComputed` 选择决策树与性能建议，见 [docs/REACT_CN.md](docs/REACT_CN.md)。

### 表单字段绑定 —— `useModelFieldState`

`useModelFieldState` 是 React 适配层中最上层的 hook：一次调用即可获取把受控输入框接到模型字段所需的一切 —— 当前值、异步 setter、validation / dirty / validating 元数据。

```ts
const [value, setValue, meta] = useModelFieldState(model, field);
```

**`FieldSetter<V> = (value: V) => Promise<boolean>`**

setter 在 `model.setField` 之上额外维护 `meta.validating` 标志（在调用期间为 `true`）。返回的 `Promise<boolean>` 表示验证结果（`true` = 已提交，`false` = 验证失败并写入 dirtyData）。

**`FieldMeta`**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `errors` | `ValidationError[]` | 当前字段的全部验证错误；无错误时为空数组。 |
| `error` | `string \| null` | 便捷字段：首条错误消息，或 `null`。 |
| `validating` | `boolean` | 当本 hook 实例的异步 `setValue` 还在执行时为 `true`。 |
| `dirty` | `boolean` | 当前字段在 `model.getDirtyData()` 中是否有记录（即上次写入是否被验证拒绝）。 |

**实用范式 —— touched / blur / 错误回显：**

`touched` 故意不放进 `meta` —— 它是纯 UI 关注点。在组件本地用 `useState` 维护，再用它来 gate 错误展示：

```tsx
function NameField() {
  const [name, setName, meta] = useModelFieldState(user, 'name');
  const [touched, setTouched] = React.useState(false);
  const showError = touched && meta.error;
  return (
    <label>
      <input
        value={name}
        disabled={meta.validating}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={showError ? 'true' : 'false'}
      />
      {showError && <span role="alert">{meta.error}</span>}
    </label>
  );
}
```

> `validating` 是组件本地状态（每个 hook 实例独立），仅追踪本 hook 发起的 setter，不会跟踪其他位置的 `model.setField` 调用。

## 文档

| 主题 | 链接 |
| --- | --- |
| API 参考 | [docs/API_CN.md](docs/API_CN.md) |
| 高级用法（异步验证、自定义规则、跨字段、`settled()`、类型推导） | [docs/ADVANCED_CN.md](docs/ADVANCED_CN.md) |
| React 绑定与选择器 hooks | [docs/REACT_CN.md](docs/REACT_CN.md) |
| 最佳实践 | [docs/BEST_PRACTICES_CN.md](docs/BEST_PRACTICES_CN.md) |
| 与 Redux、zustand 对比 | [docs/COMPARISON_CN.md](docs/COMPARISON_CN.md) |
| 场景化技术方案 | [docs/TECHNICAL_SOLUTION.md](docs/TECHNICAL_SOLUTION.md) |
| 可运行示例 | [`examples/`](examples/) |
| 给编码代理 / LLM 的高密度入门指南 | [AGENTS.md](AGENTS.md) |

## 许可证

[ISC](LICENSE)
