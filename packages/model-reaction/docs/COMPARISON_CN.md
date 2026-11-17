# model-reaction、zustand 与 Redux Toolkit

[English Version](COMPARISON.md) | [文档导航](README_CN.md)

`model-reaction` 通过同步写入和 action 组管理字段依赖图。
Redux Toolkit 与 zustand 提供应用状态容器。三者的业务校验均依赖应用或独立库。

## 能力与边界

| 关注点 | Redux Toolkit | zustand | model-reaction |
| --- | --- | --- | --- |
| 建模 | Slice、reducer、action | `set`/`get` store | 平面字段 schema |
| 更新 | 基于 Immer 的 reducer | 按约定不可变更新 | 同步转换并替换字段 |
| 派生值 | selector / `createSelector` | selector / 应用逻辑 | 声明依赖并提交 computed 字段 |
| 异步工作 | Thunk、middleware、RTK Query | 应用 action / 集成 | `reaction.action` 返回的工作 |
| 业务校验 | 应用或表单库 | 应用或表单库 | 应用或表单库 |
| React 读取 | React Redux selector | Store selector | 字段绑定与两个 selector 策略 |
| 完成判断 | 取决于集成 | 取决于应用 | `settled()` 等待计算和 action 组 |
| 持久化 | 应用/集成 | Persist middleware | 应用序列化 |
| 调试 | Redux DevTools | DevTools middleware | 专用扩展 |

selector 为读取者派生值；model reaction 转换并提交派生字段，再传播到下游。
模型保留字段结构比较和浅冻结快照，不观察深层原地修改。
循环诊断覆盖声明的计算递归，不覆盖任意 action 闭包回写。

## 如何划定边界

字段具有计算图和共同生命周期的编辑器/实体可使用 model；
直接管理 UI 状态可使用 zustand；需要 reducer、action 追踪、middleware
或查询集成时可使用 Redux Toolkit。服务端缓存保留在查询层。
独立编辑器有独立模型，大型 schema 可组合聚焦片段。

## 同一字段的三种写法

三个方案的必填检查都位于应用层。
[完整对比片段](../examples/react-best-practices/7-10-5-cheat-sheet.ts)
展示 reducer、zustand action 和如下领域写入入口：

```ts
const userModel = createModel<{ name: string }>({
  name: { type: 'string', default: '' },
});
function setName(value: string): string {
  userModel.setField('name', value);
  return value ? '' : 'Name is required';
}
```

应用也可以先预检再写入。错误存储/显示保持显式；
模型生命周期和文本格式见 [React 绑定](REACT_CN.md)。

## Store 与 model 组合

Store 决定打开哪个编辑器，编辑器持有字段模型。
业务检查和服务端接受后，把接受的实体发布到应用 store。
避免同一字段有两份独立可编辑副本。

| 集成 | 配方 |
| --- | --- |
| zustand 管 UI，model 管编辑字段 | [zustand](../examples/react-best-practices/7-10-2-with-zustand.tsx) |
| Redux 管实体，model 管编辑 | [Redux](../examples/react-best-practices/7-10-3-with-redux.tsx) |

这些集成是可选的，库不安装任一 store。

## 性能测量

安装 `tsx` 与 `zustand` 后：

```bash
pnpm --filter model-reaction exec tsx benchmarks/model-vs-zustand.ts
```

探索脚本报告创建、同步写入、应用必填反馈、订阅和派生计算的中位数。
model reaction 与读取 selector 的语义不同，不能据此作普遍性能结论。
记录运行时、版本、机器和 schema，测量实际应用的渲染与异步路径。
