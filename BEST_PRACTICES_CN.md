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

### 7.10 与 zustand、Redux 的取舍

`model-reaction` 是**模型层（model layer）**，而 zustand 与 Redux 是
**状态容器（state container）**，它们处于不同抽象层级，**并不互斥**。
完整对比表见 [COMPARISON_CN.md](COMPARISON_CN.md)。React 项目中的速查
建议：

| 需求 | 推荐 |
| --- | --- |
| 含校验、反应、脏数据的表单 / 领域实体 | **model-reaction** |
| 全局 UI 状态、路由旗标、主题、草稿 id | **zustand**（或 Redux） |
| 强审计、时间旅行、复杂全局状态机 | **Redux Toolkit** |
| 表单密集型应用 | **model-reaction** 单独配 `<ModelProvider>` |

#### 7.10.1 不要为了表单字段而堆 `useState`

如果一个表单存在两个以上互相联动的字段（校验、派生总计、异步唯一性
检查等），直接用 `model-reaction` 比一连串 `useState` 更合适，否则你会
手写一遍校验、脏数据与副作用。

#### 7.10.2 与 zustand 组合管全局状态

```tsx
// 全局 UI store —— zustand
const useUI = create<{ drawerOpen: boolean; toggle: () => void }>((set) => ({
    drawerOpen: false,
    toggle: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));

// 业务表单 —— model-reaction
const userModel = createModel<User>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
    email: { type: 'string', default: '', validator: [ValidationRules.email] },
});

function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return (
        <ModelProvider model={userModel}>
            <UserForm />
        </ModelProvider>
    );
}
```

经验法则：zustand 管**应用状态**（开/关、当前用户 id、主题）；
`model-reaction` 管**实体状态**（正在编辑的用户记录及其规则）。

#### 7.10.3 与 Redux Toolkit 组合

在 Redux 项目里，把 RTK 当应用骨架，凡是为了一个编辑器 / 向导 / 表单
单独写一个 slice 的场景，都换成 `model-reaction`：

```tsx
function EditUserPage() {
    const userId = useSelector(selectCurrentUserId);
    const dispatch = useDispatch();
    const model = useMemo(() => createModel<User>(userSchema), []);

    useEffect(() => () => model.dispose(), [model]);

    async function onSave() {
        if (!(await model.validateAll())) return;
        await model.settled();
        dispatch(saveUser(model.data));
    }

    return (
        <ModelProvider model={model}>
            <UserForm onSubmit={onSave} />
        </ModelProvider>
    );
}
```

这样既能避免「每个字段一个 action / reducer」的繁琐，又保留了 Redux
对应用其余部分的统一治理。

#### 7.10.4 哪些场景**不要**用 `model-reaction`

`model-reaction` 刻意保持在模型层，下列场景请别硬塞：

- 全局 UI 旗标（模态框、主题、语言）→ 用 zustand / Redux。
- 跨路由缓存 / 查询结果 → 用 TanStack Query / RTK Query。
- 多 store 编排（saga 式流程）→ 用 Redux 中间件。

#### 7.10.5 同一需求的代码风格速览

同样一句话需求：`name` 字段必填。

```ts
// Redux Toolkit
createSlice({ /* setName reducer + 手写 errors */ });
// zustand
create((set) => ({ name: '', errors: {}, setName: (v) => /* 手写 */ }));
// model-reaction
createModel<{ name: string }>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
});
```

`model-reaction` 把校验、错误状态、脏数据、字段订阅都做成内置；其他两者
则需要逐项手写。
