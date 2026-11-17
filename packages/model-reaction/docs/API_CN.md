# API 参考

`model-reaction` 对外公开 API 的参考文档。

[English Version](API.md) | 中文

[← 返回 README](../README_CN.md)

---

## 目录

- [createModel](#createmodel)
- [Model 方法](#model-方法)
- [反应](#反应)
- [事件](#事件)
- [ModelOptions](#modeloptions)
- [验证规则](#验证规则)
- [错误格式化](#错误格式化)
- [类型定义](#类型定义)
- [API 精简迁移](#api-精简迁移unreleased)

---

## createModel

创建模型实例的工厂函数。

```typescript
createModel<T>(schema: Model<T>, options?: ModelOptions): ModelReturn<T>;
createModel<S extends Record<string, FieldSchema>>(
  schema: S,
  options?: ModelOptions
): ModelReturn<InferModelData<S>>;
```

第一个参数是单个扁平 Schema 对象，每个顶层属性对应一个模型字段。大型 Schema
可以先按职责拆成多个片段，再通过对象展开合并后传入。对象、数组等字段值本身仍可
包含嵌套数据，但模型只在顶层跟踪字段变化。

> **默认值不经过校验。** 每个字段的 `default` 在构造时被直接写入 `data`，
> 验证器**不会**对其运行。因此 model 可能一开始就处于非法状态，而
> `validationErrors` 却是空的。在信任初始 `data` 之前，请先
> 先 `await settled()` 等待初始化，再 `await validateAll()`。
>
> **初始化反应会经过未变化的值继续传播。** 非派生字段的默认值启动初始反应流程。
> 派生值通过校验后，即使等于自身默认值，也会继续初始化下游，但不会为未变化的值
> 发送字段变更事件。重新调度不会丢失初始化状态；使用 `await settled()` 等待整条链完成。
>
> **`FieldSchema.type` 是元数据，不是运行时校验器。** 它用于 TypeScript
> 类型推导和工具展示；需要在运行时检查值类型时，请添加对应的
> `ValidationRules` 或自定义 `Rule`。
>
> **反应产物会经过校验。** 字段的 `reaction.computed` 结果会走与 `setField`
> 相同的"先校验再提交"流程。若该派生字段声明了 `validator` 且计算结果未通过，
> `data` 会保留旧值，计算结果被存入 `dirtyData`。通过校验是 `action` 获得执行
> 资格的必要条件；只有宿主字段最新调度的 reaction 能在计算落定后启动一组。
> 结果校验失败时，既不会触发派生字段的变更，也不会执行 `action`。

## Model 方法

### 读取

| 方法 | 说明 |
| --- | --- |
| `getField(field)` | 读取某个字段的当前值 |
| `get data` | 读取字段映射的稳定浅冻结副本；没有默认值的字段可能为 `undefined` |
| `get validationErrors` | 读取按字段分组的只读验证错误 |

错误快照会保留读取时的结果。每个字段的冻结错误数组在该字段的错误被清空或替换前
保持引用稳定；其他字段更新不会重新创建它。

本库只支持浅层数据，按字段替换跟踪变化。对象、数组和 Date 等可变内建对象字段值对模型来说是整体：
原地修改不会被观察，也不会触发校验、reactions 或订阅。值变化时请用 `setField()`
或 `setFields()` 整体替换。`data` 和脏数据记录的外层对象会浅冻结，字段值本身不会被冻结。

替换值为普通对象、数组、`Date` 或 `RegExp` 时按结构判等。`Map`、`Set` 和类实例等
其他对象按引用判等：传入新的实例会被视为变化。

### 写入

| 方法 | 说明 |
| --- | --- |
| `setField(field, value): Promise<boolean>` | 设置单个字段；返回该字段的验证结果 |
| `setFields(fields): Promise<boolean>` | 在一次校验 + 反应流程中批量设置多个字段；返回所有字段结果的逻辑与。跨字段校验看到的是**合并后的批次数据**——每个字段针对已叠加了本次调用全部字段的 `data` 进行校验，因此相互依赖的字段（如 `password` / `confirmPassword`）可在一次调用中一起设置。**非原子**——即使某个字段校验失败，其余通过校验的字段仍会提交到 `data`。 |

`setField()` 委托单项 `setFields()` 流程。条件函数和验证器共享浅冻结候选快照：
已提交数据叠加本次全部经过 transform 的输入，包括正在验证的字段自身。
候选值不代表已经通过验证。`validateAll()` 合并已提交数据与脏数据，不再重复
transform。验证器必须保持纯函数，不能修改快照及其嵌套字段值。
验证器不能 await 同一模型的 `settled()` 或 `validateAll()`，这两个全局等待入口
会包含验证器自身的任务。

全部输入 key 必须是 schema 的自有字段。遇到未知 key，先发送 `field:not-found`
再 reject，整批不开始 transform、validation 或提交；按输入顺序报告首个未知字段。
transform 抛错也会 reject，不转成普通校验错误或 dirty 输入。合法字段的普通校验
失败仍 resolve `false`，其他通过的字段仍可提交。批次在已开始的校验全部收尾、
登记 reaction 后才释放计算任务，异常路径也遵守此规则。

### 反应

每个字段最多配置一个 reaction。`fields` 中任意依赖字段变化时运行。
数组（包括空数组）会在构造阶段抛出包含字段名的 `TypeError`，早于默认值初始化和
异步任务启动：

```ts
total: {
    type: 'number',
    reaction: {
        fields: ['price', 'quantity'],
        computed: ({ price, quantity }) => price * quantity,
    },
}
```

`computed` 必须同步执行且保持纯净：只读取 `fields` 中声明的依赖并返回目标字段的
新值。返回 Promise 时会通过 `reaction:error` 上报，且结果不会提交。运行时无法
检测发请求、写日志或修改外部状态等其他副作用，调用方必须避免这些行为。异步操作
和其他副作用应放在 `action` 无参数函数数组中。每项返回的 PromiseLike 会纳入
`settled()`；拒绝同样通过 `reaction:error` 上报。

需要有条件地终止当前 reaction 时，返回包入口导出的 `SKIP_REACTION`：

```ts
import { SKIP_REACTION } from 'model-reaction';

computed: ({ enabled, source }) =>
  enabled ? String(source).trim() : SKIP_REACTION
```

返回 `SKIP_REACTION` 是正常的 no-op：不会验证或写入目标字段，不会修改
`dirtyData`，也不会触发 `field:change`、下游 reaction 或当前 reaction 的
`action`。本 reaction 的调度也会
取消同一宿主字段较早的 action 资格，即使最终返回跳过。

#### 返回值类型

TypeScript 会按字段的 `type` 检查 `computed` 的返回值：
分别为 `string`、`number`、`boolean`、`Date`、`object`
或只读数组，另外都允许 `SKIP_REACTION`。`enum` 字段的返回值不检查。
`values` 的类型是 `Record<string, any>`，所以直接返回其中的值（`(v) => v.name`）
得到的是 `any`，同样不会被检查。

```ts
total: {
    type: 'number',
    // ❌ 类型错误：number 字段不能派生出字符串
    reaction: { fields: ['price'], computed: ({ price }) => `${price}` },
}
```

检查是严格的：即使数据类型允许，`null` 和 `undefined` 也会报错。单独定义的
reaction 可以用 `Reaction<T>` 声明返回值类型，此时它只能用于该类型的字段。
不带类型参数的 `Reaction`（即 `Reaction<any>`）不做检查，派生值可能为 null 时
用它绕过：

```ts
import type { Reaction } from 'model-reaction';

const label: Reaction = {
    fields: ['price'],
    computed: ({ price }) => (price > 0 ? `$${price}` : null),
};
```

在 schema 外单独声明、返回 `SKIP_REACTION` 的函数，返回类型会被推断为
`symbol`，需要标注为 `(): typeof SKIP_REACTION`。Schema 片段工厂应返回
`FieldSchema<'string'>` 这类单一分支，这样展开片段再添加 reaction 时，
字段仍保留原来的 `type`。

重复触发时，同一 reaction 的多次校验可能重叠。校验请求 ID 决定写入新鲜度，
action 资格另由宿主最新调度版本决定。较晚的 `SKIP_REACTION` 不产生写入，
因此较早有效值仍可能提交，但其 action 已被取消；较晚计算抛错也有相同的分离行为。
防抖时每个宿主只保留一项待执行计算，再次触发会替换它并重新计时。
已开始的 action 可以与后续更新重叠执行；`settled()` 仍等待其返回的 Promise。

#### action 组

```ts
import { createModel } from 'model-reaction';
import type { ReactionAction } from 'model-reaction';

const saveTotal: ReactionAction = async () => {
  const { price, quantity, total } = model.data;
  await saveAmount({ price, quantity, total }); // 业务提供的函数
};

const model = createModel({
  price: { type: 'number', default: 10 },
  quantity: { type: 'number', default: 2 },
  total: {
    type: 'number', default: 0,
    reaction: {
      fields: ['price', 'quantity'],
      computed: ({ price, quantity }) => price * quantity,
      action: [saveTotal, () => { console.log(model.data.total); }],
    },
  },
});
await model.settled();
```

公开签名为 `type ReactionAction = () => void | PromiseLike<void>` 和
`Reaction<T>.action?: ReactionAction[]`。`Reaction<T>` 保留 interface，T 只约束
`computed`。action 不接收依赖投影、结果参数或注入的 `computed` 属性。
闭包读取不会增加依赖，需要触发重跑的字段仍须声明在 `fields` 中。

重叠的入口校验、批量提交、reaction 防抖、计算与计算结果校验构成一个计算阶段。
计算归零时，调度器尝试启动各宿主的有效组。每次实际调度 reaction 都会
替换宿主 action 版本，包括没有 action 或空数组的 reaction。最新者跳过、抛错、
返回 Promise、校验失败或写入过期时，不恢复较早候选。后续独立更新仍可启动新组。

初始化成功及相等计算值仍有执行资格。首次 action 调用晚于 `createModel` 返回，
因此初始化闭包可以读取 model。`setField`、`setFields` 或 `validateAll` 提升脏值时，
成功的直接值变更会取消宿主待执行及剩余项，但不会自行触发 action；相等或失败的
直接写入不取消。computed 写回不会使自己的组失效。

每项（包括首项）都会在无参数调用前检查宿主版本，并等待计算归零；完成该项返回
的 PromiseLike 后再考虑下一项。无关计算会暂停未启动项，新宿主版本会取消这些项。
已经开始的函数继续执行，新有效组从下标零开始，不等待旧函数结束。空数组无操作。

同一模型的待执行函数只保留最后登记组中的最后一个数组位置，旧待执行列表删除
相同引用。例如 `[save, log, save]` 会先执行 `log`，再执行 `save`。不同包装函数
属于不同引用，组调度及已启动调用的规则不变。

同一轮就绪的组按 schema 字段声明顺序尝试启动，各组独立等待自己的 Promise。
同步回写开始新计算时，其他就绪项暂停。抛错或拒绝只停止该组，先向宿主
`validationErrors` 追加 `reaction_error`，再发出 `reaction:error`，即使该 action
版本已经失效。旧错误晚到时可能与新版本成功值并存。`dispose` 后仍观察返回的
Promise 拒绝，但不再记录错误或发送事件，并立即释放挂起的 `settled()`。

屏障只保护每个数组项的进入时刻。函数内部普通 `await` 不保护后续读取：
`await model.setField()` 等待该次写入，下游计算可能仍在进行。将后续操作放在下一
数组项中，才能获得新的计算屏障。单次请求需要一致的顶层值时，在函数入口捕获
`const data = model.data`；该快照包含 transform 后的已提交值，只做浅冻结，
嵌套字段值不能原地修改。

回写推荐 `async () => { await model.setField('field', value); }` 块体。
直接返回 `Promise<boolean>` 不符合 `ReactionAction`，表达式体还可能形成 schema
类型推导循环。action 内不能等待同一模型的 `settled()` 或 `validateAll()`，
因为两者都会等待当前组自身。
只有返回或 await 的业务 Promise 才会被跟踪。请求取消、过期响应保护和回写循环
由业务负责。不需要派生字段的副作用使用 `model.subscribe`，其回调 Promise
不纳入 `settled()`。

### 验证

| 方法 | 说明 |
| --- | --- |
| `validateAll(): Promise<boolean>` | 对全部字段校验一次，等待模型全部追踪工作落定，返回最终结果 |
| `getDirtyData(): Partial<T>` | 获取稳定的浅冻结脏数据快照 |
| `clearDirtyData(): void` | 清空所有脏数据记录 |

提交前先等待已有输入写入与初始化落定，再创建完整校验的候选快照：

```ts
await model.settled();
const valid = await model.validateAll();
if (!valid) return;
await api.save(model.data);
```

`validateAll()` 对已提交值与 dirty 值组成的共享快照校验一次，独立提交有效字段，
再等待受追踪的计算、action 与回写。等待范围是整个模型，包含重叠任务以及宿主版本
失效后仍在运行的旧 action；创建候选快照前没有隐式等待。

只有本轮校验全部通过、落定后没有 dirty 值且全部字段错误数组为空，才返回 `true`。
本轮失败不会因后续修复而转为成功。计算或 action 失败沿用现有错误处理；
收尾时仍存在的错误或失败回写使结果为 `false`。批次异常拒绝时，先等待受追踪工作
收尾，再传播原异常，不发送 `validation:complete`。

这里执行一次完整校验再等待落定，不循环校验最终数据。action 回写只校验写入字段，
不会重验未写字段的跨字段规则。相关修正应在完整校验前完成，或通过 `setFields()`
同批写入相关字段。业务仍需暂停编辑、阻止重复提交，并单独处理输入层写入异常，
见 [提交流程](REACT_CN.md#提交流程)。

正常执行期间销毁会使结果为 `false`，不发送 `validation:complete`。销毁立即释放
落定等待，但不会取消批次已经 await 的字段验证器；该验证器仍需返回或达到
`asyncValidationTimeout`。已销毁后调用仍按现有规则以 disposed 异常拒绝。

### 订阅

| 方法 | 说明 |
| --- | --- |
| `subscribe(selector, callback, isEqual?)` | 观察选中值；默认使用 `Object.is` 比较，回调收到 `(next, prev)`，返回取消订阅函数 |
| `on(event, callback)` | 按事件名观察类型化 payload，包括错误、校验和字段变更事件；返回取消订阅函数 |

单字段与派生值共用 `subscribe`：

```ts
const off = model.subscribe((data) => data.name, (next, prev) => {
  console.log(prev, '→', next);
});
off();
```

需要按字段筛选原始事件时，用 `on('field:change', handler)` 检查 payload 的
`field`。`useModelSelector` 使用模型层过滤，`useModelComputed` 直接订阅字段事件；
两者共享快照比较逻辑。

### 生命周期

| 方法 | 说明 |
| --- | --- |
| `settled(): Promise<void>` | 等待所有挂起或级联的反应、异步 action 与异步验证完成 |
| `dispose(): void` | 释放定时器、监听器与内部状态 |

## 事件

通过 `model.on(eventName, handler)` 订阅。

| 事件 | 触发时机 |
| --- | --- |
| `field:change` | 字段值变化时 |
| `field:validation-complete` | 字段校验完成时触发，包括批量操作和 reactions；即使字段值没有变化也会触发，payload 包含 `field`、`isValid` 和字段是否仍为 dirty |
| `dirty-data:cleared` | `clearDirtyData()` 清除一个或多个脏值时触发；payload 列出受影响字段 |
| `validation:complete` | `validateAll()` 等待追踪工作落定后完成时；`isValid` 与最终 boolean 一致。批次异常拒绝或销毁时不发送 |
| `validation:error` | 某条验证规则失败时 |
| `reaction:error` | 反应执行抛出错误或 Promise 拒绝时 |
| `dependency:error` | reaction 依赖配置错误时 |
| `field:not-found` | `setField` 或 `setFields` 尝试写入 schema 中不存在的字段时 |

最终结果在发送 `validation:complete` 前检查。监听者发起的写入、销毁或新调用
属于后续操作，本轮校验不会再次等待完成事件产生的工作。用该事件观察结果，
提交期间的更新应放在事件之外。

## ModelOptions

```typescript
interface ModelOptions {
  debounceReactions?: number;
  asyncValidationTimeout?: number;
}
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `debounceReactions` | `0` | 反应触发的防抖时间（毫秒） |
| `asyncValidationTimeout` | `5000` | 异步验证的超时时间（毫秒） |

## 验证规则

`ValidationRules` 是一组可复用的内置规则，`Rule` 则是它们背后的类。两者都从
独立入口 `model-reaction/validation` 导出：

```typescript
import { ValidationRules, Rule } from 'model-reaction/validation';
```

每条规则都实现了 `Validator` 接口，可直接放进字段的 `validator` 数组。

按声明顺序执行，每条规则先判断 `condition` 再运行 `validate`；condition 为 false
则跳过。首次 condition 异常、验证失败、异常或超时即停止该字段，后续规则不再执行。
错误仍保持数组形态。单字段异步规则顺序等待，不同字段可以并行验证。优先放置廉价
同步规则；确需并行的独立请求可封装在同一个业务 validator 中。

### 内置规则

| 规则 | 形式 | 通过条件 |
| --- | --- | --- |
| `required` | 常量 | 值不是 `undefined`、`null` 或 `''` |
| `number` | 常量 | 值是有限数字 |
| `integer` | 常量 | 值是有限整数 |
| `boolean` | 常量 | 值是布尔值 |
| `string` | 常量 | 值是字符串 |
| `min(n)` | 工厂 | 数字值 `>= n` |
| `max(n)` | 工厂 | 数字值 `<= n` |
| `minLength(n)` | 工厂 | 字符串/数组长度 `>= n` |
| `maxLength(n)` | 工厂 | 字符串/数组长度 `<= n` |
| `pattern(regex, message?)` | 工厂 | 字符串匹配 `regex` |
| `email` | 常量 | 值是合法邮箱字符串 |

### 规则链式方法

每条规则（常量或工厂结果）都是一个 `Rule` 实例，带有两个链式方法，它们返回
**新的**规则，不修改原规则：

| 方法 | 说明 |
| --- | --- |
| `.withMessage(message)` | 覆盖错误提示信息。 |
| `.when(predicate)` | 仅当 `predicate(data)` 为真时才运行该规则——适合跨字段条件验证。 |

```typescript
createModel({
  discountCode: {
    type: 'string',
    default: '',
    validator: [
      ValidationRules.required
        .withMessage('使用折扣时必须填写折扣码')
        .when((data) => data.hasDiscount === true),
    ],
  },
});
```

## 错误格式化

错误展示与模型状态解耦：

```typescript
import { formatValidationErrors } from 'model-reaction/validation';

const summary = formatValidationErrors(model.validationErrors);
const custom = formatValidationErrors(
  model.validationErrors,
  (error) => `[${error.field}] ${error.message}`
);
```

## 类型定义

当前公开导出的类型包括 `Model`、`ModelOptions`、`ModelReturn`、
`Validator`、`Reaction`、`ReactionAction`、`FieldSchema`、`ValidationError`、`ModelError`、
`ModelErrorCode`、`ModelEventMap`、`InferFieldType` 和 `InferModelData`。

核心入口导出 `createModel`、`ModelEvents` 和 `SKIP_REACTION`。
`model-reaction/validation` 导出 `ValidationRules`、`Rule`、
`formatValidationErrors` 和类型 `ValidationErrorFormatter`。

完整类型定义请见 [`src/types.ts`](../src/types.ts)。

## API 精简迁移（Unreleased）

这组变更不向后兼容，升级时需要修改调用处：

- `validateAll()` 现在在完整校验后等待模型全部追踪工作，并把剩余 dirty 值与错误
  纳入 boolean。提交前保留
  `await model.settled(); const valid = await model.validateAll();`，
  删除第二次等待和重复模型错误检查，保留 UI 写入异常处理与提交锁。
  `validation:complete` 改为落定后发送最终结果。action 与 validator 内不能
  await 同一模型的 `validateAll()` 或 `settled()`，将编排移到外部入口。
  使用 action gate 的调用方必须先释放 gate，再 await 完整校验。
- 单项 `reaction` 数组直接解包；多项按业务改为一条计算规则，或把独立结果拆成不同
  字段。机械合并依赖列表不保留旧语义。
- 删除 `strictMode` 和 `failFast`。未知字段固定在 `field:not-found` 后 reject，
  且整批不开始准备输入；外部 DTO 应先映射字段。单字段固定首错停止，condition
  与 validate 交错执行，不再预筛选全部 condition；原 `failFast: true` 的错误优先级
  也可能改变。
- 单字段 validator 的 `data[field]` 现在是经过 transform 的候选值，不再是旧提交值。
  依赖旧值的前置条件移到业务写入入口，或显式提供业务比较基准。
  `validateAll()` 不再重复 transform dirty 值。
- React `DraftField` 新增必需成员 `writeError: Error | null`；手工构造值的调用方
  需要补齐。消息展示改为 `writeError?.message ?? meta.error`，`showError` 由 touched
  与任一错误来源共同决定，详见 [React 绑定](REACT_CN.md)。
- 字段结构判等和两个 selector Hook 保持原有契约。
- 将 `action: fn` 改为 `action: [fn]`，参数读取改为 model 闭包。直接调用者需要
  遍历数组并无参数调用。action 现在等待计算落定，按宿主最新调度版本合并，
  不再在每次中间计算提交后立即执行。较晚跳过或失败会取消较早 action，即使较早
  值仍提交；新宿主版本也会取消剩余项。需要开始后连续完成的操作应放在同一项内。
- 同一模型的待执行 action 按函数引用只保留最后登记的一项。重复数组位置或
  不同宿主都必须执行同一函数时，使用不同包装函数。
- `ValidationRules`、`Rule`、`formatValidationErrors` 和类型
  `ValidationErrorFormatter` 改从 `model-reaction/validation` 导入。
  使用浏览器 UMD 时，额外加载 `dist/validation.js`，工具位于
  `ModelReactionValidation` 全局对象。
- `model.subscribeField(field, callback)` 改为
  `model.subscribe(data => data[field], callback)`，回调会额外收到上一个值。
  若必须按原始字段事件触发，用 `on('field:change', handler)` 并筛选字段名。
- `reaction.computed` 的返回值现在会按字段 `type` 做类型检查（见
  [返回值类型](#返回值类型)）。可能返回 null 的 reaction 需要改用不带类型参数的
  `Reaction`；单独声明、返回 `SKIP_REACTION` 的函数需要标注
  `(): typeof SKIP_REACTION`。`FieldSchema` 改为按 `type` 区分的联合类型，
  `interface X extends FieldSchema` 不再能编译；改用类型交叉，或
  `FieldSchema<'string'>` 这类单一分支。
