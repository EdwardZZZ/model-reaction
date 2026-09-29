# model-reaction

[English Version](README.md) | 中文

一个类型安全的 TypeScript 数据模型库：验证、依赖反应、脏数据跟踪、类型化事件 —— 并提供可选的 React 绑定。

---

## 为什么选择 model-reaction

- **数据验证** —— 同步 / 异步规则、自定义消息、条件验证、跨字段验证。
- **依赖反应** —— 字段在依赖变化时自动重算，可选防抖。
- **脏数据跟踪** —— 验证失败的值单独保存，便于清理。
- **类型化事件** —— 订阅字段变化、验证流程和反应错误。
- **类型安全** —— Schema 字面量推导字段类型；没有默认值的字段包含 `undefined`。
- **可选 React 适配** —— 细粒度、selector 级订阅；核心入口零 React 依赖。

### 面向 AI 友好设计

`model-reaction` 刻意保持较小的 API 面：schema 字面量定义模型，
`setField` / `setFields` 是主要写入路径，验证失败的值进入 `dirtyData`，
React 生命周期显式处理（`await setField(...)`，cleanup 中调用 `dispose()`）。
Coding agent 可以先阅读 [AGENTS.md](AGENTS.md) 获取精简规则。

## 安装

需要 Node.js 18 或更高版本。

```bash
npm install model-reaction          # 仅核心
npm install model-reaction react    # + React 绑定（peer 依赖，react >= 18）
```

```ts
import { createModel, ValidationRules } from 'model-reaction';
import { useDraftField } from 'model-reaction/react'; // 可选
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
模型只支持浅层数据，按字段跟踪变化。`data` 和 `getDirtyData()` 返回稳定的浅冻结快照；
`getField()` 返回字段值。对于对象、数组或 Date 等可变内建对象字段，请通过
`setField()` 或 `setFields()` 整体替换；原地修改不会被观察，也不会触发校验或
reactions。

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

验证失败的值会被记录为"脏数据"，与已提交状态隔离保存。

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

`field:validation-complete` 会报告每个字段的校验结果，包括批量操作和 reactions，
即使字段值没有变化；`dirty-data:cleared` 会报告 `clearDirtyData()` 清理的字段。

## React 绑定

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { createModel, ValidationRules, type ModelReturn } from 'model-reaction';
import { ModelProvider, useModel, useModelFieldState, useDraftField } from 'model-reaction/react';

function NameInput() {
  const user = useModel<User>();
  const { draft, setDraft, meta, onBlur, showError } = useDraftField(user, 'name');
  return (
    <label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        aria-invalid={showError}
      />
      {meta.validating && <span>校验中...</span>}
      {showError && <span role="alert">{meta.error}</span>}
    </label>
  );
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

function UserModelOwner({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ModelReturn<User> | null>(null);
  useEffect(() => {
    const owned = createModel<User>({
      name: { type: 'string', default: '', validator: [ValidationRules.required] },
      age:  { type: 'number', default: 18, validator: [ValidationRules.min(18)] },
    });
    setUser(owned);
    return () => owned.dispose();
  }, []);
  if (!user) return null;
  return <ModelProvider model={user}>{children}</ModelProvider>;
}

function App() {
  return <UserModelOwner><NameInput /><AgeInput /></UserModelOwner>;
}
```

React 生命周期推荐两种模式：**Provider owner**（共享状态限定在某个子树内）
或 **per-route model**（每个路由 / 弹窗创建新实例）；避免模块级 singleton。
完整 hook 列表、生命周期示例、`useModelSelector` vs `useModelComputed` 选择决策树与性能建议，见 [docs/REACT_CN.md](docs/REACT_CN.md)。

### 文本表单字段 —— `useDraftField`

`useDraftField` 是受控文本输入的默认推荐绑定。它在本地维护编辑中的文本，
通过 model 执行校验，并直接提供 validation、dirty、touched 和 pending 状态，
使用方不需要再维护一份 `useState`。

```tsx
function NameField() {
  const { draft, setDraft, meta, onBlur, showError } =
    useDraftField(user, 'name');
  return (
    <label>
      <input
        value={draft}
        disabled={meta.validating}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        aria-invalid={showError}
      />
      {showError && <span role="alert">{meta.error}</span>}
    </label>
  );
}
```

被拒或仍在校验中的值会保留在 `draft`，而 `data` 继续保存最后一次提交成功的值。
checkbox、select、date picker 等非文本控件，或明确需要 committed value 语义时，
使用更低层的 `useModelFieldState`。详见
[docs/REACT_CN.md](docs/REACT_CN.md#严格--异步校验下的受控输入)。

## 文档

| 主题 | 链接 |
| --- | --- |
| API 参考 | [docs/API_CN.md](docs/API_CN.md) |
| 高级用法（异步验证、自定义规则、跨字段、`settled()`、类型推导） | [docs/ADVANCED_CN.md](docs/ADVANCED_CN.md) |
| React 绑定与选择器 hooks | [docs/REACT_CN.md](docs/REACT_CN.md) |
| 最佳实践 | [docs/BEST_PRACTICES_CN.md](docs/BEST_PRACTICES_CN.md) |
| 与 Redux、zustand 对比 | [docs/COMPARISON_CN.md](docs/COMPARISON_CN.md) |
| DevTools 浏览器扩展 | [docs/DEVTOOLS_CN.md](docs/DEVTOOLS_CN.md) |
| 场景化技术方案 | [docs/TECHNICAL_SOLUTION.md](docs/TECHNICAL_SOLUTION.md) |
| 可运行示例 | [`examples/`](examples/) |
| 给编码代理 / LLM 的高密度入门指南 | [AGENTS.md](AGENTS.md) |

## 许可证

[ISC](LICENSE)
