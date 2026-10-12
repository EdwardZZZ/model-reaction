# React 绑定

包内置了 React 适配层，入口为 `model-reaction/react`，提供一组 hook 与组件，每个订阅者只在自己关心的切片真正变化时重渲染。

[← 返回 README](../README_CN.md)

---

## 目录

- [Hooks 与组件](#hooks-与组件)
- [基本示例](#基本示例)
- [严格 / 异步校验下的受控输入](#严格--异步校验下的受控输入)
- [React 中的 Model 生命周期](#react-中的-model-生命周期)
- [`useModelSelector` vs `useModelComputed`](#usemodelselector-vs-usemodelcomputed)

---

## Hooks 与组件

| 导出 | 类型 | 用途 |
| --- | --- | --- |
| `useModelField(model, field)` | hook | 订阅单个字段 |
| `useModelSelector(model, selector, isEqual?)` | hook | 订阅派生值（selector 引用是订阅的一部分，请用 `useCallback` 锁定） |
| `useModelComputed(model, selector, isEqual?)` | hook | 与 `useModelSelector` 形参相同，但订阅不依赖 selector 引用；当前 render 的 selector 可直接闭包 `id`、`index` 等 props，无需 `useCallback` |
| `useModelFields(model, fields)` | hook | 一次订阅多个字段（浅比较） |
| `useDraftField(model, field, options?)` | hook | **默认推荐的文本输入绑定**，包含本地 draft、`touched`、错误门控和 model 校验 |
| `useModelFieldState(model, field)` | hook | 更低层的 committed value 绑定，返回 `[value, setValue, meta]`；用于非文本控件或自定义策略 |
| `shallow` | 函数 | 用于对象/数组选择器的浅比较工具 |
| `<ModelProvider model>` | 组件 | 通过 Context 注入 model |
| `useModel<T>()` | hook | 读取最近 Provider 中的 model |
| `<Field name>` | 组件 | 单字段 render-prop 绑定，自动消费 `<ModelProvider>` |

`react` 声明为可选 peer 依赖（`>=18.0.0`），仅当你使用此入口时需要在应用里安装。

## 基本示例

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createModel } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';
import {
    Field,
    ModelProvider,
    shallow,
    useModel,
    useModelField,
    useModelFields,
    useModelSelector,
    useDraftField,
} from 'model-reaction/react';

interface Cart {
    qty: number;
    price: number;
    coupon: string;
    name: string;
}

function createCartModel() {
    return createModel<Cart>({
        qty:    { type: 'number', default: 1 },
        price:  { type: 'number', default: 100 },
        coupon: { type: 'string', default: '' },
        name:   { type: 'string', default: '', validator: [ValidationRules.required] },
    });
}

// 1. 单字段展示 hook
function NameValue() {
    const cart = useModel<Cart>();
    const name = useModelField(cart, 'name');
    return <span>{name}</span>;
}

// 2. 派生值 hook —— selector 引用是订阅的一部分，请用 useCallback 锁定
function Total() {
    const cart = useModel<Cart>();
    const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
    const total = useModelSelector(cart, selectTotal);
    return <span>Total: {total}</span>;
}

// 3. 多字段 hook（浅比较）
function PriceLine() {
    const cart = useModel<Cart>();
    const { qty, price } = useModelFields(cart, ['qty', 'price']);
    return <span>{qty} x {price}</span>;
}

// 4. 默认推荐的文本输入绑定
function CouponInput() {
    const cart = useModel<Cart>();
    const { draft, setDraft, meta, onBlur, showError } =
        useDraftField(cart, 'coupon');
    return (
        <label>
            <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
                disabled={meta.validating}
            />
            {showError && <span style={{ color: 'red' }}>{meta.error}</span>}
        </label>
    );
}

// 5. Provider owner —— commit 后创建，cleanup 释放同一个实例
function CartModelOwner({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<ReturnType<typeof createCartModel> | null>(null);
    useEffect(() => {
        const owned = createCartModel();
        setCart(owned);
        return () => owned.dispose();
    }, []);
    if (!cart) return null;
    return <ModelProvider model={cart}>{children}</ModelProvider>;
}

// 6. Provider + render-prop Field —— 免 prop 透传
function CartApp() {
    return (
        <CartModelOwner>
            <Field<Cart, 'coupon'> name="coupon">
                {({ value, setValue, meta }) => (
                    <select
                        value={value}
                        onChange={(e) => void setValue(e.target.value)}
                        aria-invalid={!!meta.error}
                    >
                        <option value="">不使用优惠券</option>
                        <option value="SAVE10">SAVE10</option>
                    </select>
                )}
            </Field>
            <NameValue />
            <Total />
            <PriceLine />
            <CouponInput />
        </CartModelOwner>
    );
}

// 7. 自定义选择器返回新对象时，请配合 `shallow`
function Snapshot() {
    const m = useModel<Cart>();
    const selectSlice = useCallback((d: Cart) => ({ qty: d.qty, price: d.price }), []);
    const slice = useModelSelector(m, selectSlice, shallow);
    return <span>{slice.qty * slice.price}</span>;
}
```

完整示例见 [`examples/react-bindings.tsx`](../examples/react-bindings.tsx)。

## 严格 / 异步校验下的受控输入

把输入框的 `value` 直接绑定到已提交字段（`value={name}` +
`onChange={setField}`），只适用于校验不会拒绝任何编辑中间态、也不会异步返回的情况。

但只要校验会**拒绝**某个中间态按键，或**异步**返回结果，这种直连就会失效。
根源是库的 verify-then-commit 契约（见 [AGENTS.md §1](../AGENTS.md)）：

- **被拒的中间态会回弹。** 在 `minLength(3)` 或 `email` 下输入 `"a"` 校验失败，
  于是它进入 `dirtyData` 而不会进入 `data`。读取已提交值的输入框会在每一个
  「暂时非法」的按键上被清空——字段变得根本没法打字。
- **异步提交有延迟，被取代的还会丢失。** 异步校验器只在往返*完成后*才提交，
  所以在途窗口内输入框会保持空白；更糟的是，某次按键的校验若被更新的一次取代，
  它会被直接丢弃（竞态守卫提前返回），连 `dirtyData` 都进不去。

解法是引入**本地 draft**：把「正在编辑的文本」放进组件本地 state，让它随每次按键
即时更新，同时在后台触发 `setField` 校验并提交，错误则通过 `meta` 单独展示。
这与库把 `touched` 排除在 model 之外的理由一致——「正在编辑的文本」属于 UI
生命周期状态，而非 model 真理（见 [AGENTS.md §5](../AGENTS.md)）。

适配层通过 `useDraftField` 提供这个模式，它是**受控文本输入的默认推荐用法**。
它构建在 `useModelFieldState` 之上，因此核心 model 仍然只保存已提交和被拒绝的
领域值：

```tsx
import { useDraftField } from 'model-reaction/react';
import type { ModelReturn } from 'model-reaction';

function UsernameInput({ model }: { model: ModelReturn<{ username: string }> }) {
    const { draft, setDraft, onBlur, showError, meta } = useDraftField(model, 'username');
    return (
        <label>
            <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
                aria-invalid={showError}
            />
            {meta.validating && <span>validating…</span>}
            {showError && <span role="alert">{meta.error}</span>}
        </label>
    );
}
```

`useDraftField(model, field, options?)` 返回 `{ draft, setDraft, meta, touched,
onBlur, showError, committed }`：

- `draft` / `setDraft` —— 本地编辑文本及其更新器；接到输入框的 `value` / `onChange`。
- `touched` / `onBlur` / `showError` —— 失焦门控的错误展示，免得每个输入框各写一遍。
- `meta` / `committed` —— 底层 `useModelFieldState` 的元数据与最后提交的值。
- `options.format` —— 回填时已提交/待定值如何渲染成文本（默认 `String`），见下方字段类型契约。

> 需要 committed value 语义或绑定非文本控件时，使用更低层的
> `useModelFieldState`。可运行的集成示例见 demo 应用
> （`packages/demo/src/TextField.tsx`）。

### 字段类型契约

draft 建模的是「受控 `<input>` 里的文本」，所以它永远是 `string`。这限定了
这个 hook 适配哪些字段：

- **string 字段** —— 天然适配，无需额外处理。
- **number（或其他非 string）字段** —— 必须声明 schema `transform`
  （如 `transform: Number`），提交时把字符串 draft 转回真实类型。否则字符串会
  被直接写进 `data`，成为一个静默的类型谎言。
- **绑到 checkbox / select / date picker 的 boolean / enum / date 字段** ——
  **不**适配；它们的控件 `value` 不是字符串。请改用普通的 `useModelFieldState`
  绑定。

value→text（回填）方向上有两个边界情况，`useDraftField` 内部已处理（nullish /
非有限数收敛）加上可选的 `format`：

- **无法解析的数字。** number 字段存进 `"12a"` 会得到 `NaN`；直接 `String(NaN)`
  会把字面文本 `"NaN"` 显示出来。把非有限数（及 nullish）收敛为 `''`，让输入框
  显示空白。
- **丢失的显示格式。** 模型只存已提交的值，所以以整数分提交的字段回填时会丢掉
  `"3.50"`。传一个 `format`（如 `(cents) => (cents / 100).toFixed(2)`）把它补回；
  解析方向仍交给 schema `transform`。

## React 中的 Model 生命周期

一个 `model` 实例会持有 reaction 定时器、订阅和未完成的验证任务；
`dispose()` 用于确定性地取消或释放这些资源。在 React 中，常见的所有权问题是：
**把 model 写成模块级 singleton，在多个路由或测试之间共享，却没有对应的清理**。

### 反例：模块级 singleton

```tsx
// model.ts
import { createModel } from 'model-reaction';
export const userModel = createModel({ /* ... */ });
// dispose() 永远不会被调用；所有 import `userModel` 的路由都共享同一个实例，
// 会在路由切换后泄漏 reactions，也会破坏测试隔离。
```

典型症状：
- 测试之间互相污染状态（jest worker 读到旧的 `data`）。
- 同时挂载的多个编辑器意外共享状态。
- 带防抖的异步任务在发起它的视图卸载后继续执行。

### 修复 A：Provider owner 管理 dispose

在真正拥有生命周期的组件的 effect 中创建 model，并在 cleanup 中释放同一个
实例，再用 context 向下传递。这也能正确处理 StrictMode 在开发环境增加的
setup/cleanup 周期：每次 setup 创建新 model，对应 cleanup 释放该实例。
这个 owner 模式用于客户端渲染；SSR 请按[SSR 与并发渲染](BEST_PRACTICES_CN.md#79-ssr-与并发渲染)
创建请求作用域的 model，因为服务端渲染不会运行 effect。

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { ModelProvider } from 'model-reaction/react';
import { createModel, type ModelReturn } from 'model-reaction';

interface User {
    name: string;
}

function UserModelOwner({ children }: { children: ReactNode }) {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    useEffect(() => {
        const owned = createModel<User>({ /* ... */ });
        setModel(owned);
        return () => owned.dispose();
    }, []);
    if (!model) return null;
    return <ModelProvider model={model}>{children}</ModelProvider>;
}

// 挂在需要共享 model 的子树顶部。
function App() {
    return (
        <UserModelOwner>
            <ProfilePage />
            <SettingsPage />
        </UserModelOwner>
    );
}
```

为什么有效：
- React commit 后才创建 model，因此被 React 放弃的 render 不会遗留 model。
- 每次 effect setup 创建一个 model，对应 cleanup 释放同一个实例；model
  就绪后子组件才会挂载。
- 相关单测见 [`src/__tests__/react.test.tsx`](../src/__tests__/react.test.tsx)
  中的 "Provider-owned model dispose lifecycle"。

### 修复 B：per-route 实例

如果 model 的数据只属于单个路由（编辑表单、向导、弹窗），就在路由组件内部创建。

```tsx
function EditUserRoute({ userId }: { userId: string }) {
    // 路由标识变化时，创建新的 owner 和 model 生命周期。
    return <UserModelOwner key={userId}><EditForm userId={userId} /></UserModelOwner>;
}
```

按 `userId` 给 owner 设置 key 后，每个路由标识都会拥有独立的 model 生命周期，
离开时销毁旧实例；在 Provider 挂载后由表单加载路由数据。两个 tab 编辑不同用户时
也会使用不同 model。

### 模式对比

| 维度 | 模块级 singleton（反例） | 修复 A：Provider + owner | 修复 B：per-route |
| --- | --- | --- | --- |
| 跨路由共享 | 是（意外共享） | 是（限定在子树内的有意共享） | 否 |
| `dispose()` 触发点 | 永不触发 | owner 卸载 | 路由卸载 |
| 测试隔离 | 破坏 | 正常（每个测试重新挂载） | 正常（每个测试重新挂载） |
| 并行编辑器 | 共享同一实例 | 仅在 owner 子树内共享 | 各自拥有独立实例 |
| 复杂度 | 最低 | 低 | 低 |
| 推荐场景 | 不推荐 | 应用级 / 功能级共享状态 | 路由或弹窗内的局部状态 |

经验法则：**谁调用 `createModel`，谁就负责调用 `dispose()`**。在 React 中，
这个责任应放在带 `useEffect` cleanup 的组件里，而不是模块顶层。

## `useModelSelector` vs `useModelComputed`

两者都从已提交的 `model.data` 选择派生值，默认使用 `Object.is`，并缓存快照。
主要差异是订阅如何处理 selector 引用：

| 维度 | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| 订阅依赖 | model、selector 和比较函数；任一引用变化都会重新订阅 | 仅依赖 model；selector 变化不会重新订阅 |
| 推荐 selector | 提到模块作用域，或使用依赖完整的 `useCallback` | 内联函数，可直接闭包 `id`、`index` 等 props |
| 变更过滤 | 模型订阅先比较，快照 getter 也会保留等价结果 | 每次字段变更通知 hook，由快照 getter 比较 |
| 常见用途 | 可复用的 selector，或需要模型层过滤的高频更新 | 依赖渲染期变量、希望少维护 `useCallback` 依赖的 selector |

```tsx
// 保持 selector 引用稳定，避免重新订阅。
const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
const total = useModelSelector(cart, selectTotal);

// 当前 render 提供最新的 id，无需 useCallback。
function Row({ id }: { id: string }) {
    const item = useModelComputed(cart, (d) => d.items[id]);
    return <span>{item?.name}</span>;
}
```

返回新对象或数组本身不会造成无限重渲染：两种 hook 都会为相同的数据快照和
selector 缓存结果。若希望模型或 selector 变化后的等价结果仍保持引用，可传
`shallow` 或适合业务的比较函数：

```tsx
const summary = useModelComputed(
    cart,
    (d) => ({ total: d.qty * d.price, count: Object.keys(d.items).length }),
    shallow,
);
```

`shallow` 只比较一层，嵌套对象按引用比较。自定义 equality 是可选项，也不会省掉
下一次结果的计算。两者都不保证每次 commit 或 render 恰好调用 selector 一次：
订阅和快照读取都可能求值。selector 应保持纯函数，昂贵派生先测量再添加缓存。
