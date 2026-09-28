# Model Reaction 库最佳实践指南

[English Version](BEST_PRACTICES.md) | 中文

## 1. 性能优化

### 大型表单处理
- 快速写入会重复触发昂贵派生计算时，使用 `debounceReactions`。
- 无关表单使用独立 model，隔离订阅与生命周期。

### 异步验证优化
- 可安全复用结果时，在服务边界缓存远程校验结果。
- 按后端服务特征设置 `asyncValidationTimeout`。
- 远程 validator 不应在每次按键时执行时，先对输入做防抖，再调用 `setField`。

## 2. 错误处理

### 全局错误处理
```typescript
const unsubscribe = model.on('reaction:error', (error) => {
  console.error('发生错误:', error);
  // 显示全局错误通知
});
// cleanup
unsubscribe();
```

### 字段级错误处理
- 从 `validationErrors[field]` 读取字段错误。
- 使用 `formatValidationErrors(model.validationErrors)` 生成提交错误摘要。

## 3. 复杂业务规则

### 反应系统设计
- 保持 `computed` 为纯函数，把副作用放在 `action`。
- `computed` 读取的每个值都必须声明在 `reaction.fields` 中。
- 优先用一个包含完整依赖的 reaction，避免多个 reaction 竞争写入同一目标。

### 条件验证
- 条件规则使用 `Rule.when(...)`。
- 通过 validator 的 `data` 参数读取其他字段。
- 将共享领域检查提取为具名规则或验证服务。

## 4. 测试策略

### 单元测试
- 测试规则边界、transform 与自定义错误文案。
- 测试 reaction 链、循环与派生值校验失败。
- 测试非法写入只更新 `dirtyData`，不改变 `data`。

### 集成测试
- 使用 `validateAll()` 与 `settled()` 测试完整提交流程。
- 测试过期异步校验结果与防抖 reaction。
- 测试字段级 React 更新与 owner 清理。

## 5. 代码组织

### 大型应用结构
- 每个领域模型使用独立模块。
- 大型 schema 由职责单一的片段组合。
- 将复用的校验规则提取到独立模块。

### 可维护性建议
- 保持模型定义声明式，将编排逻辑放进具名领域函数。
- 只注释不明显的约束与取舍，不复述 schema 已表达的字段含义。

## 6. 类型安全

### 定义接口
- 领域已有明确数据契约时使用 `createModel<Interface>(...)`；小型局部模型可直接
  使用 schema 推导。
- TypeScript 会在编译期检查 schema 字段和 setter 的值类型。
- `FieldSchema.type` 不负责运行时校验；来自无类型边界的值仍需配置内置或自定义
  validator。

### 严格的 Schema 匹配
- 内联 schema 使用 `createModel<Interface>(...)` 时，TypeScript 会报告缺失的必填
  字段和多余字段。
- 运行时校验与这份编译期契约应分别处理。

## 7. React 集成

`model-reaction/react` 入口提供一组基于 `useSyncExternalStore` 的 hook
与组件，下面的实践帮助你在 React 项目中用得更顺。

### 7.1 选对 hook

| 需求 | 用 |
| --- | --- |
| 展示单个字段 | `useModelField` |
| 需要值 / 错误 / pending 状态的受控字段 | `useModelFieldState` |
| 带严格或异步校验的文本输入 | `useDraftField` |
| 稳定的派生 selector | `useModelSelector` |
| 闭包当前 props 的 selector | `useModelComputed` |
| 一次订阅多个字段 | `useModelFields(model, ['a', 'b'])` |

优先选择最具体的 hook：`useModelField` 比 `useModelSelector` 更轻量，
而 `useModelFields` 比手写一个返回新对象的 selector 更高效。把已校验的文本输入
直接绑定到已提交数据之前，请先阅读
[REACT_CN.md](REACT_CN.md#严格--异步校验下的受控输入)。

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

selector 返回新容器时，请配合 `shallow`——selector 仍需保持引用稳定：

```tsx
const selectSlice = useCallback(
    (d: Cart) => ({ qty: d.qty, price: d.price }),
    [],
);
const slice = useModelSelector(cart, selectSlice, shallow);
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
function NameField() {
    const [touched, setTouched] = useState(false);
    return (
        <Field<User, 'name'> name="name">
            {({ value, setValue, meta }) => (
                <label>
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onBlur={() => setTouched(true)}
                        aria-invalid={!!meta.error}
                    />
                    {touched && meta.error && <span>{meta.error}</span>}
                </label>
            )}
        </Field>
    );
}
```

### 7.5 touched 语义

`useModelFieldState` 故意不追踪 `touched` —— 它是纯 UI 关注点，不属于
模型。请在组件本地用 `useState` 管理，并用它来 gate 错误展示，让消息
只在用户离开字段后才出现：

```tsx
const [touched, setTouched] = useState(false);
<input onBlur={() => setTouched(true)} />
{touched && meta.error && <span>{meta.error}</span>}
```

如果表单会被复用，提交成功后把它重置回 `false` 即可。

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

当 reaction 带防抖或校验会触发级联异步工作时，`settled()` 可保证读取
`model.data` 前模型已经稳定。

### 7.7 一个逻辑表单一个 model

每次 `createModel(...)` 互相独立，推荐分层：

- 页面级 UI 状态 → `zustand` / `useState` / context
- 业务实体与表单 → 各自一个 `model-reaction` 模型
- 跨表单状态（向导步骤、草稿 id 等）→ 外层容器

不要为了复用 Provider 把多个无关表单塞进同一个 model；嵌套多个 Provider
即可。

### 7.8 生命周期与清理

`createModel` 持有内部监听器；长生命周期的 SPA 应在所属组件的 effect
中创建 model，并在路由卸载时释放同一个实例：

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { ModelProvider } from 'model-reaction/react';
import { createModel, type ModelReturn } from 'model-reaction';

interface User {
    name: string;
}

function createUserModel() {
    return createModel<User>({ name: { type: 'string', default: '' } });
}

function UserRoute({ children }: { children: ReactNode }) {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    useEffect(() => {
        const owned = createUserModel();
        setModel(owned);
        return () => owned.dispose();
    }, []);
    if (!model) return null;
    return <ModelProvider model={model}>{children}</ModelProvider>;
}
```

应由卸载订阅者的同一个 owner 调用 `dispose()`。被释放的 model 已清空内部状态
和监听器，后续写入会抛错。

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

function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return (
        <UserRoute>
            <UserForm />
        </UserRoute>
    );
}
```

经验法则：zustand 管**应用状态**（开/关、当前用户 id、主题）；
`model-reaction` 管**实体状态**（正在编辑的用户记录及其规则）。
`UserRoute` 沿用 §7.8 的生命周期模式，在抽屉关闭时释放 model。

#### 7.10.3 与 Redux Toolkit 组合

在 Redux 项目里，把 RTK 当应用骨架，凡是为了一个编辑器 / 向导 / 表单
单独写一个 slice 的场景，都换成 `model-reaction`：

```tsx
import { useEffect, useState } from 'react';
import { createModel, type ModelReturn } from 'model-reaction';

interface User {
    id: string;
    name: string;
}

function EditUserPage() {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    const userId = useSelector(selectCurrentUserId);
    const dispatch = useDispatch();
    useEffect(() => {
        const owned = createModel<User>(userSchema);
        setModel(owned);
        return () => owned.dispose();
    }, [userId]);

    if (!model) return null;

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
