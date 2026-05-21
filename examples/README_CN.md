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

### React 绑定示例 (react-bindings.tsx)
展示如何使用 `model-reaction/react` 适配层（`useModelField`、`useModelSelector`）实现字段级与 selector 级的组件订阅，以及 Schema 类型推导。可直接拷贝到 React 18+ 项目中使用（不能通过 CLI 直接运行）。

## 运行示例

使用以下命令运行示例：

```bash
npm run example:basic
npm run example:reaction
npm run example:async
npm run example:event
npm run example:complex
```

> React 示例（`examples/react-bindings.tsx`）是独立片段，请在真实的 React
> 应用中 import，不要用 `ts-node` 直接执行。
