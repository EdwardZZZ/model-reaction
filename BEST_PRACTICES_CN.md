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

## 7. React 集成

`model-reaction/react` 入口提供一组基于 `useSyncExternalStore` 的 hook
与组件，下面的实践帮助你在 React 项目中用得更顺。

### 7.1 选对 hook

| 需求 | 用 |
| --- | --- |
| 单个字段的受控输入 | `useModelField` 或 `useModelFieldState` |
| 派生值（求和、格式化等） | `useModelSelector` |
| 一次订阅多个字段 | `useModelFields(['a', 'b'])` |
| 含 error / dirty / validating 的表单绑定 | `useModelFieldState` |

优先选择最具体的 hook：`useModelField` 比 `useModelSelector` 更轻量，
而 `useModelFields` 比手写一个返回新对象的 selector 更高效。

### 7.2 selector 引用要稳定

`useModelSelector` 在订阅时一次性捕获 `selector` 与 `isEqual`。每次渲染
传入新函数会触发重新订阅并多渲染一次：

```tsx
// ❌ 每次渲染都会重新订阅
const total = useModelSelector(cart, (d) => d.qty * d.price);

// ✅ 引用稳定
const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
const total = useModelSelector(cart, selectTotal);
```

selector 返回新容器时，请配合 `shallow`：

```tsx
const slice = useModelSelector(
    cart,
    (d) => ({ qty: d.qty, price: d.price }),
    shallow,
);
```

### 7.3 用 `<ModelProvider>` 避免 prop 透传

在表单根节点包一次，后代直接取出 model：

```tsx
<ModelProvider model={userModel}>
    <NameField />
    <AddressFields />
    <SubmitButton />
</ModelProvider>
```

后代任意位置：

```tsx
const model = useModel<User>();
const [name, setName, meta] = useModelFieldState(model, 'name');
```

### 7.4 用 `<Field>` 写声明式输入

叶子组件只做受控输入加错误展示时，优先用 `<Field>` render-prop 形式，
隐藏 model 引用，让绑定关系一目了然：

```tsx
<Field<User, 'name'> name="name">
    {({ value, setValue, meta, helpers }) => (
        <label>
            <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => helpers.setTouched()}
                aria-invalid={!!meta.error}
            />
            {meta.touched && meta.error && <span>{meta.error}</span>}
        </label>
    )}
</Field>
```

### 7.5 touched 语义

`useModelFieldState` 不会自动翻转 `touched`，需要在 `onBlur` 上手动触发，
这样错误信息只在用户离开字段后才出现：

```tsx
<input onBlur={() => helpers.setTouched()} />
```

提交成功后调用 `helpers.reset()` 清理本地 hook 状态。

### 7.6 提交流程

校验是异步的，提交回调里务必 `await validateAll()`：

```tsx
async function onSubmit() {
    const ok = await model.validateAll();
    if (!ok) return;
    await model.settled();      // 等待所有挂起的反应
    await api.save(model.data);
}
```

当反应或异步校验有防抖时，`settled()` 才是读取 `model.data` 前模型已稳定
的唯一保证。

### 7.7 一个逻辑表单一个 model

每次 `createModel(...)` 互相独立，推荐分层：

- 页面级 UI 状态 → `zustand` / `useState` / context
- 业务实体与表单 → 各自一个 `model-reaction` 模型
- 跨表单状态（向导步骤、草稿 id 等）→ 外层容器

不要为了复用 Provider 把多个无关表单塞进同一个 model；嵌套多个 Provider
即可。

### 7.8 生命周期与清理

`createModel` 持有内部监听器；长生命周期的 SPA 应在所属路由卸载时
`dispose`：

```tsx
useEffect(() => {
    return () => model.dispose();
}, [model]);
```

切勿对仍有挂载订阅者的 model 调用 `dispose`，否则下一次读取会抛错。

### 7.9 SSR 与并发渲染

所有 hook 基于 `useSyncExternalStore`，并发渲染下安全。SSR 场景下把
model 当作请求作用域：在请求处理函数里 `createModel`，`renderToString`
完成后 `dispose()`，**不要**跨请求复用同一个 model 实例。
