# model-reaction

[English Version](README.md) | 中文

一个类型安全的 TypeScript 数据模型库：验证、依赖反应、脏数据跟踪、统一错误处理 —— 并提供可选的 React 绑定。

---

## 为什么选择 model-reaction

- **数据验证** —— 同步 / 异步规则、自定义消息、条件验证、跨字段验证。
- **依赖反应** —— 字段在依赖变化时自动重算，可选防抖。
- **脏数据跟踪** —— 验证失败的值单独保存，便于清理。
- **事件 & 错误** —— 订阅字段变化、验证流程，统一的错误管线。
- **类型安全** —— Schema 完整驱动 `model.data` 类型。
- **可选 React 适配** —— 细粒度、selector 级订阅；核心入口零 React 依赖。

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
user.on('field:change',     (e) => console.log(e.field, '=', e.value));
```

完整事件列表见 [docs/API_CN.md](docs/API_CN.md#事件)。

## React 绑定

```tsx
import { useModelField, useModelFieldState } from 'model-reaction/react';

function NameInput() {
  const name = useModelField(user, 'name');
  return <input value={name} onChange={(e) => user.setField('name', e.target.value)} />;
}

function AgeInput() {
  const [age, setAge, meta] = useModelFieldState(user, 'age');
  return (
    <>
      <input type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} />
      {meta.error && <span>{meta.error}</span>}
    </>
  );
}
```

完整 hook 列表、`useModelSelector` vs `useModelComputed` 选择决策树与性能建议，见 [docs/REACT_CN.md](docs/REACT_CN.md)。

## 文档

| 主题 | 链接 |
| --- | --- |
| API 参考 | [docs/API_CN.md](docs/API_CN.md) |
| 高级用法（异步验证、自定义规则、跨字段、`settled()`、类型推导） | [docs/ADVANCED_CN.md](docs/ADVANCED_CN.md) |
| React 绑定与选择器 hooks | [docs/REACT_CN.md](docs/REACT_CN.md) |
| 最佳实践 | [docs/BEST_PRACTICES_CN.md](docs/BEST_PRACTICES_CN.md) |
| 与 Redux、zustand 对比 | [docs/COMPARISON_CN.md](docs/COMPARISON_CN.md) |
| 可运行示例 | [`examples/`](examples/) |

## 许可证

[MIT](LICENSE)
