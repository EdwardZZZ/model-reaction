# model-reaction

[English Version](README.md) | 中文

TypeScript 字段模型：同步写入、计算依赖、action 调度，以及可选的 React 绑定。

本分支包含尚未发布的破坏性变更：校验由应用层负责。参见
[迁移说明](docs/API_CN.md#移除校验的迁移说明未发布)。

## 安装

要求 Node.js 18 或更高版本；React 绑定要求 React 18 或更高版本。

```bash
npm install model-reaction
npm install react # 使用 React 入口时
```

## 快速上手

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
      action: [() => { console.log('总价:', cart.data.total); }],
    },
  },
});

cart.setFields({ price: 20, qty: 3 });
console.log(cart.data.total); // 60，同步完成计算
await cart.settled(); // 同时等待 action 返回的异步工作
cart.dispose();
```

Schema 的每个顶层属性定义一个字段。`setField` 和 `setFields` 同步转换并提交，
返回 `void`；写入异常直接抛出。`type` 和枚举 `values` 只描述类型，
不检查运行时输入。默认值克隆后直接播种。

`data` 是稳定、浅冻结的快照。对象、数组和 `Date` 等可变值需通过 setter
整体替换，嵌套修改不会被观察。保留字段结构比较。批量输入先全部准备，
再逐字段提交并发出事件，最后触发依赖计算。事件可能观察到中间状态；
批量写入不是事务。

## Reaction 与 action

每个字段最多声明一个 reaction。`fields` 声明顶层输入；`computed` 同步、
纯粹地计算宿主值，结果再经过宿主 transform。返回 `SKIP_REACTION`
可保留宿主值，并跳过本次 action 与下游传播。

`action` 是无参函数数组，通过闭包读取 model。计算落定后在微任务中启动，
每个数组项调用前再次检查计算屏障。新的宿主版本取消尚未调用的项，
已运行的 Promise 继续被跟踪。组间独立执行，重复函数引用归最后一次注册。

计算在 setter 返回前结束，用 `await settled()` 等待 action 工作。
不要在 action 内等待同一个 model 的 `settled()`。
完整规则见 [API](docs/API_CN.md#action-组)。

## 业务校验与事件

要求模型只接收合格值时，先检查候选再写入。编辑器也可以保存不完整值，
提交前检查计算落定后的快照。错误、请求超时与过期响应保护由应用维护。
参见 [高级用法](docs/ADVANCED_CN.md)。

```ts
const off = cart.on('field:change', ({ field, value }) => console.log(field, value));
cart.on('reaction:error', (error) => console.error(error.message));
off();
```

## React 绑定

```tsx
import type { ModelReturn } from 'model-reaction';
import { useModelFieldState } from 'model-reaction/react';

function NameInput({ model }: { model: ModelReturn<{ name: string }> }) {
  const [name, setName] = useModelFieldState(model, 'name');
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
}
```

控件通过同步 setter 直接绑定提交值。
解析、文本格式、IME 缓冲和业务反馈由应用控件负责。
生命周期、selector、SSR 和配方见 [React 绑定](docs/REACT_CN.md)。

## 文档

[文档导航](docs/README_CN.md) · [API](docs/API_CN.md) ·
[示例](examples/README_CN.md) · [DevTools](docs/DEVTOOLS_CN.md) ·
[源码架构](docs/ARCHITECTURE_CN.md) · [Coding agent 约定](AGENTS.md)

## 许可证

[ISC](LICENSE)
