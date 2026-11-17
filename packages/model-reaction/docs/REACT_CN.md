# React 绑定

[English Version](REACT.md) | [文档导航](README_CN.md)

从 `model-reaction/react` 导入，React 18+ 为可选 peer dependency。
字段/selector 读取基于 `useSyncExternalStore`；核心不导入 React。

## Hook 与组件

| API | 返回/用途 |
| --- | --- |
| `useModelField(model, field)` | 提交字段值 |
| `useModelFieldState(model, field)` | `[value, setValue]`，同步 setter |
| `useModelFields(model, fields)` | 指定字段值组成的对象 |
| `useModelSelector(model, selector, isEqual?)` | 模型层过滤的 selector 订阅 |
| `useModelComputed(model, selector, isEqual?)` | 稳定事件订阅，React 快照过滤 |
| `ModelProvider` / `useModel<T>()` | 显式模型上下文 |
| `Field<T, K>` | 从上下文读取，render-prop 提供 `{ value, setValue }` |
| `shallow(a, b)` | selector 结果的浅比较工具 |

`FieldSetter<V>` 是 `(value: V) => void`；`FieldMeta` 与校验元数据已删除。
React 类型还包括 `ModelProviderProps`、`FieldProps`、`FieldRenderProps`。

## 基础示例

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

同步写入允许文本控件直接绑定提交字符串。非文本控件也可使用二元组，或 `<Field>`：

```tsx
<Field<User, 'name'> name="name">
  {({ value, setValue }) => <input value={value} onChange={(event) => setValue(event.target.value)} />}
</Field>
```

## 输入转换与组合输入

非字符串输入先在控件中解析，再写入类型化字段值：

```tsx
function AmountInput({ model }: { model: ModelReturn<{ amount: number }> }) {
  const [amount, setAmount] = useModelFieldState(model, 'amount');
  return <input type="number" value={Number.isFinite(amount) ? amount : ''}
    onChange={(event) => setAmount(Number(event.target.value))} />;
}
```

此简单绑定将空文本转换为 `0`，不保留 `2.`、`002`、`2.00` 等输入格式。
需要保留格式的应用可以维护本地文本，自行决定何时解析/提交。
对象、数组和日期使用适当的控件/解析器。

适配器只提供字段值和 setter；文本格式、blur/错误反馈、组合策略由应用负责。
可能打断 IME 的转换应在控件中缓冲组合文本，并在 `compositionend` 写入。
需要显示同步写入异常时，由应用捕获并提供反馈。

## React 中的模型生命周期

创建者负责销毁模型；`ModelProvider` 只提供上下文，不销毁外部实例。
Hook 在清理时取消订阅；`useModel` 在缺少 Provider 时抛错。

可能启动 action 的 schema 按示例在 effect 中构造。
StrictMode 额外的 setup/cleanup 会销毁第一次实例，活跃挂载使用新实例。
被放弃的渲染不能泄漏定时器或副作用。独立编辑器使用独立模型；
模块级实例仅适合有意共享的应用生命周期。实体键改变时重建模型。
参见 [生命周期配方](../examples/react-best-practices/7-8-lifecycle.tsx)。

## useModelSelector 与 useModelComputed

两者共享 selector 快照缓存，并用指定比较函数（默认 `Object.is`）
避免选择值相等时重新渲染。订阅策略刻意保留差异：

| 策略 | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| 订阅 | `model.subscribe` 过滤通知 | 字段事件通知 React |
| 内联 selector 引用改变 | 重建模型订阅 | 保持事件订阅稳定 |
| 无关字段改变 | 通知 React 前过滤 | React 读取并比较选择值 |
| 适用 | 稳定 `useCallback` selector | 依赖 props 的内联 selector |

```tsx
const selectTotal = useCallback((data: Cart) => data.price * data.qty, []);
const total = useModelSelector(model, selectTotal);
const scaled = useModelComputed(model, (data) => data.price * multiplier);
const summary = useModelComputed(model, (data) => ({ qty: data.qty, price: data.price }), shallow);
```

selector 应保持纯函数，相等比较需符合所选值的语义。
这些 Hook 为读取者派生值；`reaction.computed` 则提交模型字段并触发下游计算。

## 提交流程

业务检查与反馈由应用负责。提交期间暂停编辑，或检查并提交同一份字段快照：

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

`settled()` 等待模型计算和 action 返回的工作，不等待任意应用校验或脱离返回值的请求。
显式等待自身的异步检查。嵌套值是浅共享的，避免原地修改，
需要深度隔离时克隆 payload；最终准入仍以服务端为准。
参见 [提交配方](../examples/react-best-practices/7-6-submission-flow.tsx)。

## SSR 与并发渲染

绑定为调用方提供的 model 读取服务端快照。每个请求创建独立实例并在渲染后销毁，
避免跨用户共享。effect 创建的 owner 在服务端显示 fallback；
需要服务端字段内容时预创建并提供请求拥有的实例。
快照缓存使用当前 selector，formatter 仅发布已提交渲染的更新。
挂载回归覆盖 StrictMode 和 suspended render。

[React 示例](../examples/react-bindings.tsx) 配有独立 [SSR 入口](../examples/react-bindings-runner.tsx)：

```bash
pnpm --filter model-reaction run example:react
```

旧元数据绑定升级方式见 [API 迁移](API_CN.md#移除校验的迁移说明未发布)。
