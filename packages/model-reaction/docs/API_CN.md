# API 参考

[English Version](API.md) | [文档导航](README_CN.md)

## 入口与类型

| 入口 | 运行时导出 |
| --- | --- |
| `model-reaction` | `createModel`、`ModelEvents`、`SKIP_REACTION` |
| `model-reaction/react` | Hook、`ModelProvider`、`Field`、`shallow` |
| `model-reaction/devtools` | 可选启用调试的 `createModel` |

根入口类型导出：`Model`、`FieldSchema`、`Reaction`、`ReactionAction`、
`ModelReturn`、`ModelError`、`ModelErrorCode`、`ModelEventMap`、
`InferFieldType`、`InferModelData`。内部协调类型不导出。
核心入口不导入 React 或 DevTools 集成。

## 创建模型

```ts
import { createModel, type Model } from 'model-reaction';

interface Person { name: string; age: number }
const schema: Model<Person> = {
  name: { type: 'string', default: '' },
  age: { type: 'number', default: 18 },
};
const person = createModel<Person>(schema);
const inferred = createModel({ name: { type: 'string', default: '' } });
```

Schema 是自有字段名组成的平面映射；字段值可以嵌套。
`constructor`、`__proto__` 等自有键可用，构造后者时使用
`['__proto__']` 或 `Object.fromEntries`。

| 字段属性 | 契约 |
| --- | --- |
| `type` | 必填：`string`、`number`、`boolean`、`object`、`array`、`date`、`enum` |
| `default` | 可选初值，克隆后直接播种 |
| `values` | 可选枚举字面量，用于推断，不检查运行时成员 |
| `transform` | 可选同步 `(value: any) => any`，用于直接写入和计算结果 |
| `reaction` | 可选单个 `{ fields, computed, action? }` |

`type` 是元数据，不执行运行时校验。transform 必须同步返回目标值，
不支持 Promise。默认值不经过 transform，缺失或 `undefined` 默认值不播种。
构造时先播种全部默认值，再从有默认值的非 reaction 字段触发可达计算。
没有输入触发的 reaction（包括 `fields: []`）不会自动执行。
初始化 action 延迟调用，因此闭包可以安全引用构造后的 model。

Schema 推断在没有默认值时包含 `undefined`，从有用的默认值保留对象/数组形状，
从只读 `values` 保留枚举联合，同时包含实际默认值类型。
显式 `createModel<T>` 要求调用方正确初始化 `T`。

`createModel` 仅接受 schema，没有构造配置参数；所有字段计算同步执行。

## 读取与订阅

| API | 返回 |
| --- | --- |
| `model.data` | 稳定、浅冻结的 `Readonly<T>` 快照 |
| `model.getField(key)` | 存储值；运行时缺失读取为 `undefined` |
| `model.subscribe(selector, callback, isEqual?)` | 取消订阅函数 |
| `model.on(event, callback)` | 取消订阅函数 |

字段未改变时 `data` 保持引用。旧快照保留字段映射，但嵌套值仍共享且可变；
必须整体替换嵌套值，原地修改不会被观察。

订阅先计算初始选择值但不调用 callback，之后每次字段事件用 `Object.is`
或自定义比较判断选择值是否改变，回调参数是 `(value, previous)`。
监听器异常被日志记录并隔离，不回滚写入；生命周期清理时取消订阅。

## 写入

```ts
model.setField('name', 'Ada');             // void
model.setFields({ name: 'Ada', age: 36 }); // void
```

两个 setter 都同步执行，`setField` 复用批量路径。

1. 读取值和运行 transform 前检查所有键；未知键发出 `field:not-found` 并抛错。
2. 全部读取并转换后再提交；getter 或 transform 抛错时本批次不提交。
3. 按对象键顺序提交；结构上改变的值推进宿主 action 版本并发出 `field:change`。
4. 从改变的输入集合触发依赖计算，在 `finally` 中释放批次任务。

同步级联计算在 setter 返回前结束。action 总在之后启动，setter 不等待它。

这是先准备、再逐项提交，不是原子事务。事件在各项提交后执行，
可能观察中间状态或重入 setter；外层剩余候选仍按顺序提交。
监听器内销毁模型会终止后续写入。

保留既有字段比较：基础值严格相等，数组/普通对象递归比较，`Date` 比较时间戳，
`RegExp` 比较 source/flags，
`Map`、`Set` 等其他实例按引用比较。相等替换不更换存储值，也不触发事件和计算；
`NaN` 视为改变，`+0`/`-0` 视为相等。selector 的相等规则独立配置。

## Reactions

```ts
import { SKIP_REACTION } from 'model-reaction';

const reaction = {
  fields: ['price', 'qty'],
  computed: ({ price, qty }: Record<string, any>) =>
    qty > 0 ? price * qty : SKIP_REACTION,
};
```

`computed` 必须同步且纯粹，所有模型输入都在 `fields` 中声明。
依赖是顶层键，不是嵌套路径。TypeScript 按宿主 `type` 检查返回类型；
枚举成员不检查，未指定类型参数的 `Reaction` 使用 `any`。

计算输出经过宿主 transform 和同步提交。计算值相等仍可启动 action；
普通下游传播要求宿主改变，初始化播种计算允许相等值继续传播。
`SKIP_REACTION` 跳过本次宿主转换/提交、action 和下游传播。
跳过的后继调度仍淘汰旧的未启动 action 组。

计算/transform 抛错会发出 `reaction:error`，保留宿主值并阻止本次 action。
Promise-like 计算结果被视为契约错误，同时观察其拒绝以免未处理异常。
缺失依赖发出 `dependency:error` 并传入 `undefined`；
计算递归在运行时发出 `circular_dependency` 的 `reaction:error`。
核心不静态检查任意 action 回写循环。

## Action 组

```ts
reaction: {
  fields: ['source'],
  computed: ({ source }) => source * 2,
  action: [
    () => { model.setField('other', model.data.target); },
    async () => { await save(model.data); },
  ],
}
```

`ReactionAction` 是 `() => void | PromiseLike<void>`，不传参，
通过闭包读取 model。成功处理的计算可以注册组，包括初始化和相等计算值。

- 注册携带调度时捕获的宿主版本，只有最新版本可以启动或继续。
- 全部计算任务结束后，在微任务中首次调用；后续项调用前再次检查计算屏障。
- 组内按数组顺序等待各项返回的工作；组间按 schema 顺序尝试启动，独立等待。
- 数组内重复函数保留最后位置；待执行项中的共享函数归最后注册的宿主。
- 新的宿主计算或改变宿主值的直接写入取消未启动项；已运行项和返回的
  Promise 继续跟踪。
- 抛错/拒绝发出 `reaction:error` 并只停止所在组；
  模型存活时，旧项的晚到错误仍会报告。

调度器不会取消请求，也不会拦截已运行 action 内的回写。
过期响应、超时与销毁保护由应用使用版本号或 AbortController 处理。
返回或等待异步工作才能被跟踪。不要在 action 内等待本 model 的 `settled()`，
否则会等待 action 自己。

## 等待与销毁

`settled(): Promise<void>` 等待受跟踪的批次、计算链和 action 组。
它不校验数据，也不因 reaction 错误拒绝；另行观察错误事件或业务状态。
它不跟踪脱离返回值的任务、未来写入或任意应用检查。

`dispose(): void` 幂等执行：取消未启动 action，释放等待者，
清空订阅与数据。已运行 action 的拒绝仍被观察；应用需阻止销毁后回写。
销毁后 setter 抛错，读取为清空数据，`settled()` 正常完成。

## 事件

| `ModelEvents` 键 | 事件 | 载荷 |
| --- | --- | --- |
| `FIELD_CHANGE` | `field:change` | `{ field, value }` |
| `FIELD_NOT_FOUND` | `field:not-found` | `ModelError` |
| `DEPENDENCY_ERROR` | `dependency:error` | `ModelError` |
| `REACTION_ERROR` | `reaction:error` | `ModelError` |

`ModelError` 包含 `code`、可选 `field`、`message`、可选 `originalError`。
错误码为 `field_not_found`、`dependency_error`、`circular_dependency`、
`reaction_error`。模型不保存错误状态，请在待观察操作前订阅；
构造时的计算可能早于订阅。

## 移除校验的迁移说明（未发布）

此次直接移除内置校验，不保留兼容适配层。

| 移除/变更 | 迁移 |
| --- | --- |
| `FieldSchema.validator`、`Validator`、`ValidationError` | 应用检查或独立校验库 |
| `model-reaction/validation`、`Rule`、`ValidationRules`、`formatValidationErrors` | 应用工具；原子路径不再导出 |
| `asyncValidationTimeout` | 请求/服务超时 |
| `debounceReactions`、`ModelOptions`、`createModel` 配置参数 | 改用 `createModel(schema)`；请求/输入节流由应用负责 |
| `setField`/`setFields: Promise<boolean>` | 同步 `void`，移除布尔分支，捕获异常 |
| `validateAll()` | 等待模型工作后检查业务快照 |
| `validationErrors`、`getDirtyData()`、`clearDirtyData()` | 应用/UI 错误与拒绝草稿 |
| 校验与 dirty-data 事件 | 应用状态或事件 |
| `FieldMeta`、`[value, setter, meta]`、`<Field>` 的 `meta` | `[value, setter]` 与业务反馈 |
| `useDraftField`、`DraftField`、`UseDraftFieldOptions` | 直接使用 `useModelFieldState`；文本/blur/错误策略由应用控件负责 |
| DevTools dirty/error 快照、validator 数量、快照订阅 | 提交数据与变更订阅 |

以前被拒绝的直接值和 computed 值现在在转换后提交。
以前由 `debounceReactions` 延迟的计算现在在每次输入改变时同步执行，
包括构造初始化；setter 返回后可读到完整计算链结果。
action 仍延迟执行，由 `settled()` 跟踪。
类型标签与枚举字面量不能替代已删除的检查。若提交数据必须有效，
将准入规则移至写入前。可在模型外保留未完成文本，或接受不完整编辑值并在提交时检查。
React 适配器不再提供草稿文本、formatter 同步、touched 或本地写入异常存储。

```ts
model.setFields(input);
await model.settled();
const snapshot = model.data;
const errors = checkBusinessData(snapshot);
if (Object.keys(errors).length === 0) await save(snapshot);
```

保留单字段单 reaction、action 数组、结构比较、两个 selector Hook 策略、
批量键预检。更早删除的 `strictMode`、`failFast`、reaction 数组仍不支持。
