# Model Reaction 库最佳实践指南

[English Version](BEST_PRACTICES.md) | 中文

## 1. 性能优化

### 大型表单处理
- 使用 `debounceReactions` 选项减少频繁触发的反应
- 考虑使用虚拟滚动处理大型列表数据

### 异步验证优化
- 实现验证结果缓存，避免重复验证相同值
- 使用 `asyncValidationTimeout` 控制验证超时
- 对用户输入使用防抖处理，减少验证请求次数

## 2. 错误处理

### 全局错误处理
```typescript
const errorHandler = new ErrorHandler();
errorHandler.onError(ErrorType.UNKNOWN, (error) => {
  console.error('发生错误:', error);
  // 显示全局错误通知
});
```

### 字段级错误处理
- 使用 `validationErrors` 对象获取特定字段的错误
- 结合 UI 显示每个字段的错误信息
- 使用 `getValidationSummary()` 获取错误摘要

## 3. 复杂业务规则

### 反应系统设计
- 保持 `computed` 函数纯净，只用于计算值
- 在 `action` 中处理副作用
- 使用依赖图优化复杂反应链

### 条件验证
- 使用自定义 `Rule` 实现复杂条件验证
- 利用验证器的 `data` 参数访问其他字段值
- 对于复杂逻辑，考虑封装为独立验证服务

## 4. 测试策略

### 单元测试
- 测试每个字段的验证规则
- 测试反应系统的正确性
- 测试错误处理流程

### 集成测试
- 测试完整表单提交流程
- 测试异步验证集成
- 测试与 UI 组件的交互

## 5. 代码组织

### 大型应用结构
- 按功能模块组织模型定义
- 将通用验证规则提取为共享库
- 使用组合而非继承扩展模型功能

### 可维护性建议
- 为每个模型添加清晰的文档注释
- 保持模型定义简洁，避免过度复杂
- 定期重构和优化反应系统

## 6. 类型安全

### 定义接口
- 始终为您的数据模型定义 TypeScript 接口。
- 使用 `createModel<Interface>(...)` 来强制进行 Schema 验证。
- 这可以防止因缺少字段或类型错误而导致的运行时错误。

### 严格的 Schema 匹配
- 库强制要求您的 Schema 与您的 Interface 完全匹配。
- Interface 中的所有必填字段都必须存在于 Schema 中。
- 不允许在 Schema 中出现 Interface 中未定义的额外字段。
