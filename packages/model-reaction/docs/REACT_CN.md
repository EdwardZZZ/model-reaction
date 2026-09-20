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
- [选择决策树](#选择决策树)
- [性能高发场景对照](#性能高发场景对照)

---

## Hooks 与组件

| 导出 | 类型 | 用途 |
| --- | --- | --- |
| `useModelField(model, field)` | hook | 订阅单个字段 |
| `useModelSelector(model, selector, isEqual?)` | hook | 订阅派生值（selector 引用是订阅的一部分，请用 `useCallback` 锁定） |
| `useModelComputed(model, selector, isEqual?)` | hook | 与 `useModelSelector` 形参相同，但 selector / `isEqual` 通过 ref 每次渲染刷新——内联箭头函数与渲染期闭包变量（`id`、`index` 等）无需 `useCallback` |
| `useModelFields(model, fields)` | hook | 一次订阅多个字段（浅比较） |
| `useModelFieldState(model, field)` | hook | `[value, setValue, meta]` 一体化表单绑定，含 `error / dirty / validating` |
| `useDraftField(model, field, options?)` | hook | **可选** 受控输入绑定：在 `useModelFieldState` 之上加本地 draft + `touched`/错误门控。用于严格/异步校验 |
| `shallow` | 函数 | 用于对象/数组选择器的浅比较工具 |
| `<ModelProvider model>` | 组件 | 通过 Context 注入 model |
| `useModel<T>()` | hook | 读取最近 Provider 中的 model |
| `<Field name>` | 组件 | 单字段 render-prop 绑定，自动消费 `<ModelProvider>` |

`react` 声明为可选 peer 依赖（`>=18.0.0`），仅当你使用此入口时需要在应用里安装。

## 基本示例

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createModel, ValidationRules } from 'model-reaction';
import {
    Field,
    ModelProvider,
    shallow,
    useModel,
    useModelField,
    useModelFields,
    useModelFieldState,
    useModelSelector,
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

// 1. 单字段 hook
function NameInput() {
    const cart = useModel<Cart>();
    const name = useModelField(cart, 'name');
    return (
        <input
            value={name}
            onChange={async (e) => {
                await cart.setField('name', e.target.value);
            }}
        />
    );
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

// 4. 一体化表单绑定 —— `touched` 是组件本地 UI 状态
function CouponInput() {
    const cart = useModel<Cart>();
    const [coupon, setCoupon, meta] = useModelFieldState(cart, 'coupon');
    const [touched, setTouched] = useState(false);
    return (
        <label>
            <input
                value={coupon}
                onChange={async (e) => {
                    await setCoupon(e.target.value);
                }}
                onBlur={() => setTouched(true)}
                disabled={meta.validating}
            />
            {touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
        </label>
    );
}

// 5. Provider owner —— 子组件共享同一个 model；cleanup 负责 dispose
function CartModelOwner({ children }: { children: ReactNode }) {
    const [cart] = useState(createCartModel);
    useEffect(() => () => cart.dispose(), [cart]);
    return <ModelProvider model={cart}>{children}</ModelProvider>;
}

// 6. Provider + render-prop Field —— 免 prop 透传
function CartApp() {
    return (
        <CartModelOwner>
            <Field<Cart, 'name'> name="name">
                {({ value, setValue, meta }) => (
                    <input
                        value={value}
                        onChange={async (e) => {
                            await setValue(e.target.value);
                        }}
                        aria-invalid={!!meta.error}
                    />
                )}
            </Field>
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

上面的示例把输入框的 `value` 直接绑定到已提交的字段（`value={name}` +
`onChange={setField}`）。当校验器宽松且同步时，这样没问题——比如 `required`
接受任何非空按键，每次编辑都会立即提交并干净地读回。

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

这个模式已由适配层作为**可选** hook `useDraftField` 提供，构建在
`useModelFieldState` 之上。需要才 import —— 核心绑定（`useModelFieldState`、
`[value, setValue, meta]`）并不依赖它：

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

> 它固化了 `useModelFieldState` 刻意留白的 UI 策略（`touched` 何时翻转、如何播种、
> value→text 方向），所以是**独立、opt-in** 的导出，而非折进 `meta`。想自己拿捏这些
> 取舍时，就用普通的 `useModelFieldState`。可运行的集成示例见 demo 应用
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

一个 `model` 实例会持有 reactions、内部事件监听器和未完成的验证定时器。
这些资源不会因为 JavaScript GC 自动知道该清理什么；如果忘记调用
`dispose()`，model 以及它闭包里引用的值都会继续存活。在 React 里，
最常见的问题是：**把 model 写成模块级 singleton，并在多个路由 / 测试 /
浏览器 tab 之间共享，却没有任何地方负责清理**。

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
- 热更新后 reaction handler 被重复注册。
- 多 tab 应用里看到已经关闭视图留下的幽灵更新。

### 修复 A：Provider owner 管理 dispose

在真正拥有生命周期的组件里创建 model，通过 `useEffect` cleanup 调用
`dispose()`，再用 context 向下传递。

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { ModelProvider } from 'model-reaction/react';
import { createModel } from 'model-reaction';

function UserModelOwner({ children }: { children: ReactNode }) {
    const [model] = useState(() => createModel({ /* ... */ }));
    useEffect(() => () => model.dispose(), [model]);
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
- `useState(() => createModel(...))` 在每次 owner 挂载期间只运行一次，
  所以通过 `useModel()` 读取的子组件共享同一个实例。
- `useEffect` cleanup 会在卸载时触发（热更新导致 owner 重挂载时也会触发），
  保证每个生命周期只调用一次 `dispose()`。
- 相关单测见 [`src/__tests__/react.test.tsx`](../src/__tests__/react.test.tsx)
  中的 "Provider-owned model dispose lifecycle"。

### 修复 B：per-route 实例

如果 model 的数据只属于单个路由（编辑表单、向导、弹窗），就在路由组件内部创建。

```tsx
function EditUserRoute({ userId }: { userId: string }) {
    const [model] = useState(() => createModel({ /* ... */ }));

    useEffect(() => {
        // 可选：挂载时从服务端回填数据。
        model.setFields(loadUser(userId));
        return () => model.dispose();
    }, [model, userId]);

    return (
        <ModelProvider model={model}>
            <EditForm />
        </ModelProvider>
    );
}
```

每次进入 `/users/:id/edit` 都会创建新 model，离开路由时销毁；两个 tab
编辑不同用户时也不会互相影响。

### 模式对比

| 维度 | 模块级 singleton（反例） | 修复 A：Provider + owner | 修复 B：per-route |
| --- | --- | --- | --- |
| 跨路由共享 | 是（意外共享） | 是（限定在子树内的有意共享） | 否 |
| `dispose()` 触发点 | 永不触发 | owner 卸载 | 路由卸载 |
| 测试隔离 | 破坏 | 正常（每个测试重新挂载） | 正常（每个测试重新挂载） |
| 多 tab 安全性 | dev 下容易泄漏 | 每个 tab 拥有自己的树 | 每个 tab 拥有自己的树 |
| 复杂度 | 最低 | 低 | 低 |
| 推荐场景 | 不推荐 | 应用级 / 功能级共享状态 | 路由或弹窗内的局部状态 |

经验法则：**谁调用 `createModel`，谁就负责调用 `dispose()`**。在 React 中，
这个责任应放在带 `useEffect` cleanup 的组件里，而不是模块顶层。

## `useModelSelector` vs `useModelComputed`

两者都返回派生值并支持自定义 `isEqual`，差异完全在 `selector` 引用的处理方式：

| 维度 | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| selector 引用 | 进入 `subscribe` 依赖；引用一旦改变即触发**取消订阅 + 重新订阅 + 多渲染一帧** | 写入 ref，每次渲染刷新；引用变化**完全免费** |
| 推荐写法 | 用 `useCallback` 锁定（或提到模块作用域） | 直接写内联箭头函数 |
| 渲染期闭包变量 | 必须加进 `useCallback` 依赖（否则读到旧值） | 始终是最新一次渲染的闭包 |
| 等值比较位置 | 在模型订阅里——模型层可在到达 React 前去重 | 在 `getSnapshot` 里——模型层全量推送，hook 自己缓存/去重 |
| selector 调用频次 | 每次 **commit** 跑一次 | 每次 **render** 跑一次（`getSnapshot` 在每次渲染都会调用） |
| selector **每次调用返回新引用**（默认 `Object.is`） | 安全——快照仅在模型事件时更新，两次 commit 之间 `getSnapshot` 返回稳定引用 | ⚠️ **无限重渲染**。`getSnapshot` 每次渲染都算出新引用，`Object.is` 永远判不等 → React 抛出 *"Maximum update depth exceeded"*。**必须**传入结构化 `isEqual`（如导出的 `shallow`） |
| 适用场景 | 派生体固定、稳定路径上的派生值 | selector 依赖渲染期变量（`id`、`index`、分页游标…），或追求少写 `useCallback` 的短生命周期组件 |

```tsx
// useModelSelector —— selector 引用必须稳定。
const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
const total = useModelSelector(cart, selectTotal);

// useModelComputed —— 内联箭头即可，且 `id` 始终最新。
function Row({ id }: { id: string }) {
    const item = useModelComputed(cart, (d) => d.items[id]);
    return <span>{item?.name}</span>;
}
```

> ⚠️ **`useModelComputed` 需要稳定的快照。** 如果它的 selector 每次调用都返回
> 新的对象/数组（`(d) => d.items.map(...)`、`(d) => ({...})`），你**必须**传入
> `isEqual`——常用导出的 `shallow`。否则每次渲染都产生新引用，渲染期缓存永远命
> 中不了，React 会以 *"Maximum update depth exceeded"* 卸载组件。selector 返回基
> 元值或本就稳定的引用则不受影响。`useModelSelector` **没有**这个陷阱，因为它的
> 快照只在模型发出 `field:change` 时才变化。

<details>
<summary><strong>为什么 <code>isEqual</code> 不默认成 <code>shallow</code>？</strong></summary>

把 `shallow` 设为默认只能盖住一部分陷阱，因此刻意不这么做：

- **只能救扁平 selector。** `shallow` 只比一层，所以
  `(d) => ({ rows: d.items.map(...) })` 里嵌套的 `rows` 每次仍是新引用，照样
  死循环。默认 `shallow` 会把「必崩」变成「偶发崩」，比显式要求更难排查。
- **破坏对称性。** `useModelSelector`、`useModelComputed`、`model.subscribe`、
  `subscribeField` 全部默认 `Object.is`。只改一个 hook 的默认值会造成「同签名、
  不同默认」，更难记而非更好记。
- **偏离生态惯例。** react-redux 的 `useSelector` 与 zustand 的 selector 都默认
  引用相等；浅比较一律显式 opt-in（如 zustand 的 `useShallow`）。

因此选择保持 `Object.is`，并让错误**可见**（本警告 + hook 的 JSDoc），而不是用
一个不完整的默认值把它藏起来。
</details>

经验法则：默认用 `useModelSelector`；只要 selector 闭包了渲染期会变的变量，就改用 `useModelComputed`。

## 选择决策树

```
1. selector 是否闭包了渲染期会变的变量
   （如 `id`、`index`、分页游标、搜索关键字）？
   ├── 是 → useModelComputed
   │        （正确性：无需 useCallback 即可避免闭包陈旧）
   │        ⚠ 若它同时返回新的对象/数组，必须传 `isEqual`
   │           （如 `shallow`），否则会因 "Maximum update depth" 死循环
   └── 否 → 继续 ↓

2. selector 体计算是否昂贵
   （深 map / 聚合 / 序列化 / 逐行 diff）？
   ├── 是 → useModelSelector + 稳定引用
   │        （selector 每次 commit 跑一次，而非每次 render）
   └── 否 → 继续 ↓

3. 是否处于高频更新路径
   （高频字段、订阅扇出大、父组件经常因无关原因重渲染）？
   ├── 是 → useModelSelector + 稳定引用
   │        （模型层 isEqual 直接挡住变更，不进 React 调度）
   └── 否 → 继续 ↓

4. selector 是否需要跨组件复用，或希望被中间件 / devtools 观测？
   ├── 是 → useModelSelector
   │        （selector 身份位于模型层，可被插桩；
   │         useModelComputed 的 selector 只活在 React 渲染中，
   │         无法被库捕获）
   └── 否 → 继续 ↓

5. 你愿意为 selector 写 useCallback 吗？
   ├── 愿意 → useModelSelector
   └── 不愿 → useModelComputed
              （便利：ref 锁死语义，零 useCallback 心智负担）
```

## 性能高发场景对照

| 场景 | 关键差异 | 选择 |
| --- | --- | --- |
| 100+ 行列表，每行各自订阅派生值 | `useModelComputed` 的 selector 会在**父组件每次渲染**时对每行各跑一次 | `useModelSelector` |
| selector 体计算昂贵（深 map / 克隆 / 聚合） | `getSnapshot` 每次渲染都会调用，并发/StrictMode 下还会再多一次 | `useModelSelector` |
| 高频字段（动画、鼠标、防抖）扇出到不相关订阅者 | 模型层 `isEqual` 能直接挡掉无关变更，不进 React 调度 | `useModelSelector` |
| selector 闭包了 `id` / `index` 等渲染期变量 | `useModelSelector` 要么读到旧值，要么每次 render 都重订阅 | `useModelComputed` |
| 一次性原型 / 短生命周期组件，selector 很轻 | `useCallback` 的纪律成本超过每次 render 跑一次 selector 的开销 | `useModelComputed` |
| selector 需要被中间件 / devtools 观测 | 身份必须存在于模型层 | `useModelSelector` |
| selector 包含副作用或非纯逻辑（`console.log`、计数、调试日志） | `useSyncExternalStore` 要求 `getSnapshot` 必须纯 | `useModelSelector` |

> 一句话总结：`useModelSelector` 是 **性能上限**（模型层去重，**每次 commit** 跑一次）；`useModelComputed` 是 **便利下限**（组件层去重，**每次 render** 跑一次）。二者**不可互相替代**，请同时保留并按场景选用。
