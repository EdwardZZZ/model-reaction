# API 参考

`model-reaction` 对外公开 API 的参考文档。

[← 返回 README](../README_CN.md)

---

## 目录

- [createModel](#createmodel)
- [Model 方法](#model-方法)
- [事件](#事件)
- [ModelOptions](#modeloptions)
- [ErrorHandler](#errorhandler)
- [ErrorType 枚举](#errortype-枚举)
- [类型定义](#类型定义)

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

> **默认值不经过校验。** 每个字段的 `default` 在构造时被直接写入 `data`，
> 验证器**不会**对其运行。因此 model 可能一开始就处于非法状态，而
> `validationErrors` 却是空的。在信任初始 `data` 之前，请先
> `await validateAll()`。
>
> **反应产物会经过校验。** 字段的 `reaction.computed` 结果会走与 `setField`
> 相同的"先校验再提交"流程。若该派生字段声明了 `validator` 且计算结果未通过，
> `data` 会保留旧值，计算结果被存入 `dirtyData`。

## Model 方法

### 读取

| 方法 | 说明 |
| --- | --- |
| `getField(field)` | 获取某个字段的当前值 |
| `get data` | 获取所有字段值组成的对象 |
| `get validationErrors` | 获取按字段分组的当前验证错误 |

### 写入

| 方法 | 说明 |
| --- | --- |
| `setField(field, value): Promise<boolean>` | 设置单个字段；返回该字段的验证结果 |
| `setFields(fields): Promise<boolean>` | 在一次校验 + 反应流程中批量设置多个字段；返回所有字段结果的逻辑与。**非原子**——即使某个字段校验失败，其余通过校验的字段仍会提交到 `data`。 |

### 验证

| 方法 | 说明 |
| --- | --- |
| `validateAll(): Promise<boolean>` | 验证所有字段，返回是否全部通过 |
| `getValidationSummary(): string` | 获取人类可读的验证摘要 |
| `getDirtyData(): Partial<T>` | 获取验证失败的脏数据 |
| `clearDirtyData(): void` | 清空所有脏数据记录 |

### 订阅

| 方法 | 说明 |
| --- | --- |
| `subscribeField(field, callback)` | 订阅单个字段变化，返回取消订阅函数 |
| `subscribe(selector, callback, isEqual?)` | 订阅派生值；默认使用 `Object.is` 比较，返回取消订阅函数 |
| `on(event, callback)` | 订阅模型事件（见 [事件](#事件)）。返回取消订阅函数，与 `subscribe` / `subscribeField` 一致 |
| `off(event, callback?)` | 取消订阅 |

#### 两个层级：事件总线 vs. 数据订阅

这四个方法处于**两个不同的抽象层级**，互为补充而非冗余：

- **`on` / `off` —— 事件总线。** 底层。`on` 按**事件名**订阅，收到的是原始事件
  payload。它是观察非值类事件的**唯一途径**，例如 `validation:error`、
  `validation:complete`、`reaction:error`、`dependency:error`、
  `field:not-found`（见 [事件](#事件)）。`off(event)` 不传 callback 时会移除该事件
  的**所有**监听器——这是单个取消订阅函数做不到的。

- **`subscribe` / `subscribeField` —— 数据订阅。** 构建在 `on('field:change', …)`
  之上的便利层。两者都观察**值变化**，且仅在被观察值真正改变时才触发：
  - `subscribeField(field, cb)` —— 过滤到单个字段；回调收到 `(value)`。
  - `subscribe(selector, cb, isEqual?)` —— 观察派生值；回调收到 `(next, prev)`，
    通过 `isEqual`（默认 `Object.is`）去重。

**如何选择：** 响应式地观察值变化时用 `subscribeField` / `subscribe`（常见场景，
也是 React 适配器所用）；需要错误/校验事件或对原始事件流的完全控制时，再降到
`on`。

### 生命周期

| 方法 | 说明 |
| --- | --- |
| `settled(): Promise<void>` | 等待所有挂起的反应与异步验证完成 |
| `dispose(): void` | 释放定时器、监听器与内部状态 |

## 事件

通过 `model.on(eventName, handler)` 订阅。

| 事件 | 触发时机 |
| --- | --- |
| `field:change` | 字段值变化时 |
| `validation:complete` | 一轮验证完成时 |
| `validation:error` | 某条验证规则失败时 |
| `reaction:error` | 反应执行抛出错误或 Promise 拒绝时 |
| `dependency:error` | reaction 依赖配置错误时 |
| `field:not-found` | 访问未声明的字段时 |

## ModelOptions

```typescript
interface ModelOptions {
  debounceReactions?: number;
  asyncValidationTimeout?: number;
  errorFormatter?: (error: ValidationError) => string;
  errorHandler?: ErrorHandler;
  strictMode?: boolean;
  failFast?: boolean;
}
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `debounceReactions` | `0` | 反应触发的防抖时间（毫秒） |
| `asyncValidationTimeout` | `5000` | 异步验证的超时时间（毫秒） |
| `errorFormatter` | — | 自定义验证错误消息格式化函数 |
| `errorHandler` | 新实例 | 注入共享的 `ErrorHandler` |
| `strictMode` | `false` | 为 `true` 时，设置未在 schema 中声明的字段会抛错 |
| `failFast` | `false` | 为 `true` 时，单字段在第一条规则失败后即停止后续验证 |

## ErrorHandler

统一的错误管理。

| 方法 | 说明 |
| --- | --- |
| `onError(type, callback)` | 订阅指定类型的错误 |
| `offError(type, callback)` | 取消订阅 |
| `triggerError(error)` | 手动触发错误 |
| `createValidationError(field, message)` | 构造验证错误对象 |
| `createFieldNotFoundError(field)` | 构造"字段不存在"错误对象 |

## ErrorType 枚举

| 成员 | 含义 |
| --- | --- |
| `VALIDATION` | 验证规则失败 |
| `REACTION` | 反应处理函数报错 |
| `FIELD_NOT_FOUND` | 字段未在 schema 中声明 |
| `DEPENDENCY_ERROR` | 反应依赖配置错误 |
| `CIRCULAR_DEPENDENCY` | 反应图存在循环依赖 |
| `UNKNOWN` | 未分类错误 |

## 类型定义

当前公开导出的类型包括 `Model`、`ModelOptions`、`ModelReturn`、
`Validator`、`Reaction`、`FieldSchema`、`ValidationError`、`AppError`、
`ValidateFieldOptions`、`InferFieldType`、`InferModelData` 和 `ModelEvents`。

完整类型定义请见 [`src/types.ts`](../src/types.ts)。
