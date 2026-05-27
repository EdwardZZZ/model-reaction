# API 参考

`model-reaction` 完整 API 文档。

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
createModel<T>(schema: Model<T>, options?: ModelOptions): ModelManager<T>;
```

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
| `setFields(fields): Promise<boolean>` | 批量设置字段；返回整体验证结果 |

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
| `on(event, callback)` | 订阅模型事件（见 [事件](#事件)） |
| `off(event, callback?)` | 取消订阅 |

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
| `asyncValidationTimeout` | 无 | 异步验证的超时时间（毫秒） |
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

完整类型定义请见 [`src/types.ts`](../src/types.ts)。
