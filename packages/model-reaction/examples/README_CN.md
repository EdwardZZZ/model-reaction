# model-reaction 示例

[English Version](README.md) | 中文

这里提供了 `model-reaction` 库的各种使用场景示例。

## 可用示例

### 基本使用示例 (basic-usage.ts)
展示库的基本功能，包括模型创建、字段设置、验证等。

### 反应系统示例 (reaction-system.ts)
展示依赖反应系统，当指定字段变化时自动触发计算和操作。

### 异步验证示例 (async-validation.ts)
展示如何使用异步验证规则，如用户名唯一性检查。

### 事件监听示例 (event-listening.ts)
展示如何监听字段变化和验证完成等事件。

### 复杂表单示例 (complex-form.ts)
展示复杂表单场景下的字段关联、依赖验证和错误处理机制。

### 脏数据与条件校验示例 (dirty-data-conditional.ts)
展示校验失败的输入如何被转存到 `dirtyData`（可通过 `getDirtyData()` 取回、`clearDirtyData()` 清空）而不污染 `data`，以及 `Rule.when(predicate)` 如何让规则仅在满足跨字段条件时才生效。

### React 绑定示例 (react-bindings.tsx)
展示如何使用 `model-reaction/react` 适配层（`useModelField`、`useModelSelector`）实现字段级与 selector 级的组件订阅，以及 Schema 类型推导。可直接拷贝到 React 18+ 项目中使用（不能通过 CLI 直接运行）。

### React 最佳实践片段 (react-best-practices/)
补充了一组面向 React 的片段示例，覆盖稳定 selector、`ModelProvider`、
`Field`、touched 状态处理、提交流程、生命周期清理，以及与 zustand /
Redux 的对比。这些文件更适合作为参考模板，而不是通过 CLI 直接运行。

## 运行示例

使用以下命令运行示例：

```bash
npm run example:basic
npm run example:reaction
npm run example:async
npm run example:event
npm run example:complex
npm run example:dirty
```

> React 示例（`examples/react-bindings.tsx`）是独立片段，请在真实的 React
> 应用中 import，不要用 `ts-node` 直接执行。
>
> `examples/react-best-practices/` 目录下的文件也属于参考片段，建议按需拷贝到
> 实际 React 项目中使用。
