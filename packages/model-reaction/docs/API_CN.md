# API 参考

`model-reaction` 对外公开 API 的参考文档。

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
> `await validateAll()`。
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

条件函数和验证器读取浅冻结的数据快照。`setFields()` 的所有字段共享一份经过
transform 的候选快照；`validateAll()` 共享一份合并已提交数据与脏数据的快照。
`setField()` 捕获当前已提交数据的快照。验证器必须保持纯函数，不能修改快照及其
嵌套字段值。

### 反应

字段可以配置一个 reaction，也可以配置 reaction 数组。`fields` 中任意依赖字段变化时，
对应 reaction 会运行。数组中的匹配项按声明顺序调度：

```ts
total: {
    type: 'number',
    reaction: [
        { fields: ['price'], computed: ({ price }) => price * 1.1 },
        { fields: ['price'], computed: ({ price }) => price * 1.2 },
    ],
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
`action`。reaction 数组中的后续项仍会按声明顺序执行。本 reaction 的调度也会
取消同一宿主字段较早的 action 资格，即使最终返回跳过。

#### 返回值类型

TypeScript 会按字段的 `type` 检查每个 `computed` 的返回值（reaction 数组中的
每一项都会检查）：分别为 `string`、`number`、`boolean`、`Date`、`object`
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

多个 reaction 因同一个依赖字段变化而写入同一目标时，最后调度的写入具有最终效力，
之前的写入会被更新的写入覆盖。因此上例中，如果第二个结果通过校验，`total` 由第二个
reaction 决定；如果它校验失败，结果会进入 `dirtyData`，不会回退采用前一个 reaction
的值。action 资格与值提交分开：只有宿主最新调度的 reaction，才能在自身写入
成功提交后登记一组 action。

匹配的 reaction 按调度顺序计算并开始校验。`SKIP_REACTION` 不产生写入，也不会
取代前一个写入。写入同一目标的防抖 reaction 会合并到一次回调中，该目标再次被触发
时会重新计时。较晚计算跳过或抛错时，较早值仍可能提交，但其 action 已被取消。
已开始的 action 可以与后续更新重叠执行；`settled()` 仍等待其返回的 Promise。

`setFields()` 批量修改多个依赖字段时，变更字段的处理顺序也会影响调度顺序。如果一个
结果依赖多个输入，建议用一个包含这些依赖字段的 reaction 计算，避免多个 reaction 竞争
写入同一目标。

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
计算归零时，调度器交接每个宿主至多一组有效候选。每次实际调度 reaction 都会
替换宿主 action 版本，包括没有 action 或空数组的 reaction。最新者跳过、抛错、
返回 Promise、校验失败或写入过期时，不恢复较早候选。后续独立更新仍可启动新组。

初始化成功及相等计算值仍有执行资格。首次 action 调用晚于 `createModel` 返回，
因此初始化闭包可以读取 model。`setField`、`setFields` 或 `validateAll` 提升脏值时，
成功的直接值变更会取消宿主待执行及剩余项，但不会自行触发 action；相等或失败的
直接写入不取消。computed 写回不会使自己的组失效。

每项（包括首项）都会在无参数调用前检查宿主版本，并等待计算归零；完成该项返回
的 PromiseLike 后再考虑下一项。无关计算会暂停未启动项，新宿主版本会取消这些项。
已经开始的函数继续执行，新有效组从下标零开始，不等待旧函数结束。重复函数引用
按数组位置分别执行，空数组无操作。

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
类型推导循环。action 内不能等待同一模型的 `settled()`，因为它会等待当前组自身。
只有返回或 await 的业务 Promise 才会被跟踪。请求取消、过期响应保护和回写循环
由业务负责。不需要派生字段的副作用使用 `model.subscribe`，其回调 Promise
不纳入 `settled()`。

### 验证

| 方法 | 说明 |
| --- | --- |
| `validateAll(): Promise<boolean>` | 验证所有字段，返回是否全部通过 |
| `getDirtyData(): Partial<T>` | 获取稳定的浅冻结脏数据快照 |
| `clearDirtyData(): void` | 清空所有脏数据记录 |

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
| `validation:complete` | 一轮验证完成时 |
| `validation:error` | 某条验证规则失败时 |
| `reaction:error` | 反应执行抛出错误或 Promise 拒绝时 |
| `dependency:error` | reaction 依赖配置错误时 |
| `field:not-found` | `setField` 或 `setFields` 尝试写入 schema 中不存在的字段时 |

## ModelOptions

```typescript
interface ModelOptions {
  debounceReactions?: number;
  asyncValidationTimeout?: number;
  strictMode?: boolean;
  failFast?: boolean;
}
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `debounceReactions` | `0` | 反应触发的防抖时间（毫秒） |
| `asyncValidationTimeout` | `5000` | 异步验证的超时时间（毫秒） |
| `strictMode` | `false` | 为 `true` 时，设置未在 schema 中声明的字段会抛错 |
| `failFast` | `false` | 为 `true` 时，单字段在第一条规则失败后即停止后续验证 |

## 验证规则

`ValidationRules` 是一组可复用的内置规则，`Rule` 则是它们背后的类。两者都从
独立入口 `model-reaction/validation` 导出：

```typescript
import { ValidationRules, Rule } from 'model-reaction/validation';
```

每条规则都实现了 `Validator` 接口，可直接放进字段的 `validator` 数组。

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

- 将 `action: fn` 改为 `action: [fn]`，参数读取改为 model 闭包。直接调用者需要
  遍历数组并无参数调用。action 现在等待计算落定，按宿主最新调度版本合并，
  不再在每次中间计算提交后立即执行。较晚跳过或失败会取消较早 action，即使较早
  值仍提交；新宿主版本也会取消剩余项。需要开始后连续完成的操作应放在同一项内。
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
