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
- **可选 DevTools** —— 查看模型字段、action 和已挂载的 React 派生值，自动采集
  selector 输入，详见 [DevTools](docs/DEVTOOLS_CN.md)。

### 面向 AI 友好设计

`model-reaction` 刻意保持较小的 API 面：schema 字面量定义模型，
`setField` / `setFields` 是主要写入路径，验证失败的值进入 `dirtyData`，
React 生命周期显式处理（`await setField(...)`，cleanup 中调用 `dispose()`）。
Coding agent 可以先阅读 [AGENTS.md](AGENTS.md) 获取精简规则。
源码模块图和主要调用链见[架构导览](docs/ARCHITECTURE_CN.md)。

## 安装

需要 Node.js 18 或更高版本。

```bash
npm install model-reaction          # 仅核心
npm install model-reaction react    # + React 绑定（peer 依赖，react >= 18）
```

```ts
import { createModel } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';
import { useDraftField } from 'model-reaction/react'; // 可选
```

> 核心入口包含校验执行逻辑，不包含内置规则或 React。规则构建和错误格式化工具
> 从 `model-reaction/validation` 按需导入；只有 `model-reaction/react` 引入 React。

## 快速上手

```typescript
import { createModel } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';

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

await user.settled();
const ok = await user.validateAll();
console.log(ok, user.data); // true { name: 'John', age: 30 }
```

`createModel` 的第一个参数是单个扁平 Schema 对象：每个顶层属性对应一个模型字段。
大型 Schema 可以先按职责拆成片段，再通过对象展开合并后传入；对象、数组等字段值
本身仍可包含嵌套数据，但模型只在顶层跟踪字段变化。

在 `createModel` 前完成 Schema 组装；实例生命周期内，定义及共享配置保持固定。
配置变化时创建新的 Schema 和实例。这是调用方契约，库不做运行时深冻结，
详见 [Schema 固定性](docs/API_CN.md#schema-固定性)。

始终 `await setField(...)`，确保验证完成后再读取 `data`；
当 model 的 owner 卸载时，始终在 cleanup 路径里调用 `dispose()`。

提交前先 `await settled()`，再 `await validateAll()`。完整校验会等待受追踪的
计算与 action，并在返回前检查剩余 dirty 值与错误，见 [校验契约](docs/API_CN.md#验证)。

模型只支持浅层数据，按字段跟踪变化。`data` 和 `getDirtyData()` 返回稳定的浅冻结快照；
`getField()` 返回字段值。对于对象、数组或 Date 等可变内建对象字段，请通过
`setField()` 或 `setFields()` 整体替换；原地修改不会被观察，也不会触发校验或
reactions。

推导读值同时包含默认值与 computed 结果类型。复用 Schema 片段时使用 `satisfies`；
显式 `createModel<T>` 是调用方对值类型的承诺，见
[数据类型推导](docs/API_CN.md#数据类型推导)。`data` 为所有已声明字段保留自有 key，
未赋值时为 `undefined`。支持数字字段 key，事件中的字段名使用字符串。

每字段只接受一个 `reaction`。字段内校验按规则顺序执行，首错即停。
未知写入 key 先发送 `field:not-found` 再 reject，整批不开始处理。
`setField` 和 `setFields` 的验证器读取经过 transform 的候选快照，包含字段自身的新值。
字段结构判等保持不变，详见 [破坏性迁移说明](docs/API_CN.md#迁移到-200)。

## 核心概念

### 反应（Reactions）

字段可以声明依赖列表与 `computed` 函数；任一依赖变化时，字段会自动重算。
`computed` 必须同步执行，只根据 `fields` 中声明的依赖做纯计算并返回目标字段的
新值；不要返回 Promise，也不要在其中发请求、写日志或修改外部状态。异步操作和
其他副作用应放在 `action` 中。
需要有条件地跳过本次 reaction 时返回 `SKIP_REACTION`；此时不会验证或写入目标
字段，也不会执行 `action` 或触发下游 reaction。

```typescript
import { createModel, SKIP_REACTION } from 'model-reaction';

const m = createModel({
  first: { type: 'string', default: '' },
  last:  { type: 'string', default: '' },
  full:  {
    type: 'string',
    default: '',
    reaction: {
      fields: ['first', 'last'],
      computed: (v) =>
        v.first || v.last ? `${v.first} ${v.last}`.trim() : SKIP_REACTION,
    },
  },
});
```

TypeScript 会按字段的 `type` 检查返回值，因此 `full` 只能返回字符串或
`SKIP_REACTION`；具体规则与例外见 [docs/API_CN.md](docs/API_CN.md#反应)。

`action` 是可选的函数数组，接收 `{ field, value }`：宿主字段名与每次调用前读取的
最新已提交值。现有无参函数仍可使用，其他字段通过 model 闭包读取。成功计算将函数
登记到模型共享的 Map，相同引用后进入的覆盖前一条记录、决定上下文的 field，
并移到队尾。计算链落定后按顺序调用所有待执行函数，不等待前项结果；
返回的 Promise 纳入 `settled()`。初始化及相等
计算值也能登记 action；较晚跳过、失败或直接修改宿主字段不取消已登记的函数。
action 与 validator 内不能 await 同一模型的 `settled()` 或 `validateAll()`。
从单函数 action 升级前，请阅读 [执行契约与迁移](docs/API_CN.md#action-队列)。

### 脏数据

验证失败的值会被记录为"脏数据"，与已提交状态隔离保存。

```typescript
user.getDirtyData();   // 验证失败的值
user.clearDirtyData(); // 清空
```

### 事件

```typescript
user.on('validation:error', (e) => console.error(e.field, e.message));

// `on` 返回取消订阅函数（与 `subscribe` 一致）：
const off = user.on('field:change', (e) => console.log(e.field, '=', e.value));
off(); // 停止监听
```

完整事件列表见 [docs/API_CN.md](docs/API_CN.md#事件)。

`field:validation-complete` 会报告每个字段的校验结果，包括批量操作和 reactions，
即使字段值没有变化；`dirty-data:cleared` 会报告 `clearDirtyData()` 清理的字段。

## React 绑定

```tsx
import type { ModelReturn } from 'model-reaction';
import { useDraftField } from 'model-reaction/react';

function NameInput({ user }: { user: ModelReturn<{ name: string }> }) {
  const { draft, setDraft, meta, writeError, onBlur, showError } = useDraftField(user, 'name');
  return (
    <label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        aria-invalid={showError}
      />
      {meta.validating && <span>校验中...</span>}
      {showError && <span role="alert">{writeError?.message ?? meta.errors[0]?.message}</span>}
    </label>
  );
}

```

React 的技术契约与完整示例统一维护在 [docs/REACT_CN.md](docs/REACT_CN.md)，
包含 Hook 选择、模型所有权、selector 订阅、SSR 与提交流程。

### 文本表单字段 —— `useDraftField`

draft 行为、非文本控件、transform 和错误展示，详见
[受控输入](docs/REACT_CN.md#严格--异步校验下的受控输入)。

2.0.0 包含 API 不兼容变更，升级时请参考
[迁移说明](docs/API_CN.md#迁移到-200)。

## 文档

通过[文档导航](docs/README_CN.md)查找 API 参考、高级用法、React 绑定、集成、
DevTools、架构、示例与贡献约定。

## 许可证

[ISC](LICENSE)
