# React 绑定

包内置了 React 适配层，入口为 `model-reaction/react`，提供一组 hook 与组件，每个订阅者只在自己关心的切片真正变化时重渲染。

[← 返回 README](../README_CN.md)

---

## 目录

- [Hooks 与组件](#hooks-与组件)
- [基本示例](#基本示例)
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
| `useModelFieldState(model, field)` | hook | `[value, setValue, meta, helpers]` 一体化表单绑定，含 `error / dirty / touched / validating` |
| `shallow` | 函数 | 用于对象/数组选择器的浅比较工具 |
| `<ModelProvider model>` | 组件 | 通过 Context 注入 model |
| `useModel<T>()` | hook | 读取最近 Provider 中的 model |
| `<Field name>` | 组件 | 单字段 render-prop 绑定，自动消费 `<ModelProvider>` |

`react` 声明为可选 peer 依赖（`>=18.0.0`），仅当你使用此入口时需要在应用里安装。

## 基本示例

```tsx
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

const cart = createModel<Cart>({
    qty:    { type: 'number', default: 1 },
    price:  { type: 'number', default: 100 },
    coupon: { type: 'string', default: '' },
    name:   { type: 'string', default: '', validator: [ValidationRules.required] },
});

// 1. 单字段 hook
function NameInput() {
    const name = useModelField(cart, 'name');
    return <input value={name} onChange={(e) => cart.setField('name', e.target.value)} />;
}

// 2. 派生值 hook
function Total() {
    const total = useModelSelector(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

// 3. 多字段 hook（浅比较）
function PriceLine() {
    const { qty, price } = useModelFields(cart, ['qty', 'price']);
    return <span>{qty} x {price}</span>;
}

// 4. 一体化表单绑定
function CouponInput() {
    const [coupon, setCoupon, meta, helpers] = useModelFieldState(cart, 'coupon');
    return (
        <label>
            <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                onBlur={() => helpers.setTouched()}
                disabled={meta.validating}
            />
            {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
        </label>
    );
}

// 5. Provider + render-prop Field —— 免 prop 透传
function CartApp() {
    return (
        <ModelProvider model={cart}>
            <Field<Cart, 'name'> name="name">
                {({ value, setValue, meta }) => (
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        aria-invalid={!!meta.error}
                    />
                )}
            </Field>
            <Total />
            <PriceLine />
            <CouponInput />
        </ModelProvider>
    );
}

// 6. 自定义选择器返回新对象时，请配合 `shallow`
function Snapshot() {
    const m = useModel<Cart>();
    const slice = useModelSelector(
        m,
        (d) => ({ qty: d.qty, price: d.price }),
        shallow
    );
    return <span>{slice.qty * slice.price}</span>;
}
```

完整示例见 [`examples/react-bindings.tsx`](../examples/react-bindings.tsx)。

## `useModelSelector` vs `useModelComputed`

两者都返回派生值并支持自定义 `isEqual`，差异完全在 `selector` 引用的处理方式：

| 维度 | `useModelSelector` | `useModelComputed` |
| --- | --- | --- |
| selector 引用 | 进入 `subscribe` 依赖；引用一旦改变即触发**取消订阅 + 重新订阅 + 多渲染一帧** | 写入 ref，每次渲染刷新；引用变化**完全免费** |
| 推荐写法 | 用 `useCallback` 锁定（或提到模块作用域） | 直接写内联箭头函数 |
| 渲染期闭包变量 | 必须加进 `useCallback` 依赖（否则读到旧值） | 始终是最新一次渲染的闭包 |
| 等值比较位置 | 在模型订阅里——模型层可在到达 React 前去重 | 在 `getSnapshot` 里——模型层全量推送，hook 自己缓存/去重 |
| selector 调用频次 | 每次 **commit** 跑一次 | 每次 **render** 跑一次（`getSnapshot` 在每次渲染都会调用） |
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

经验法则：默认用 `useModelSelector`；只要 selector 闭包了渲染期会变的变量，就改用 `useModelComputed`。

## 选择决策树

```
1. selector 是否闭包了渲染期会变的变量
   （如 `id`、`index`、分页游标、搜索关键字）？
   ├── 是 → useModelComputed
   │        （正确性：无需 useCallback 即可避免闭包陈旧）
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
