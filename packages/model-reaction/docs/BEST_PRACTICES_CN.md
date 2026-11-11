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
- 保持 `computed` 为同步纯函数，不要返回 Promise；异步操作和其他副作用放在 `action`。
- `computed` 读取的每个值都必须声明在 `reaction.fields` 中。
- 优先用一个包含完整依赖的 reaction，避免多个 reaction 竞争写入同一目标。

### 条件验证
- 从 `model-reaction/validation` 导入规则构建和格式化工具。
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

React 的技术契约与完整 Recipe 统一维护在 [REACT_CN.md](REACT_CN.md)。
下面保留原有章节锚点，应用状态库的组合建议继续维护在本页。

### 7.1 选对 hook

见 [Hooks 与组件](REACT_CN.md#hooks-与组件)。

### 7.2 selector 引用要稳定

见 [`useModelSelector` vs `useModelComputed`](REACT_CN.md#usemodelselector-vs-usemodelcomputed)。

### 7.2bis 内联 selector 使用 `useModelComputed`

见 [`useModelSelector` vs `useModelComputed`](REACT_CN.md#usemodelselector-vs-usemodelcomputed)。

### 7.3 用 `<ModelProvider>` 避免 prop 透传

见 [基本示例](REACT_CN.md#基本示例)。

### 7.4 用 `<Field>` 绑定 committed value 控件

见 [基本示例](REACT_CN.md#基本示例)。

### 7.5 touched 语义

见 [受控输入](REACT_CN.md#严格--异步校验下的受控输入)。

### 7.6 提交流程

见 [提交流程](REACT_CN.md#提交流程)。

### 7.7 一个逻辑表单一个 model

无关表单使用独立 owner，见 [Model 生命周期](REACT_CN.md#react-中的-model-生命周期)。

### 7.8 生命周期与清理

见 [Model 生命周期](REACT_CN.md#react-中的-model-生命周期)。

### 7.9 SSR 与并发渲染

见 [SSR 与并发渲染](REACT_CN.md#ssr-与并发渲染)。

### 7.10 与 zustand、Redux 的取舍

`model-reaction` 是**模型层**，zustand 与 Redux 是**状态容器**，可以组合使用。
完整对比见 [COMPARISON_CN.md](COMPARISON_CN.md)。

| 需求 | 推荐 |
| --- | --- |
| 含校验、反应、脏数据的表单 / 领域实体 | **model-reaction** |
| 全局 UI 状态、路由旗标、主题、草稿 id | **zustand**（或 Redux） |
| 强审计、时间旅行、复杂全局状态机 | **Redux Toolkit** |
| 表单密集型应用 | **model-reaction** 单独配 `<ModelProvider>` |

#### 7.10.1 不要为了表单字段而堆 `useState`

对于带校验、派生总计或异步检查的联动字段，用 model 管理领域状态；
编辑文本与 UI 旗标留在 React。边界见 [受控输入](REACT_CN.md#严格--异步校验下的受控输入)。

#### 7.10.2 与 zustand 组合管全局状态

```tsx
const useUI = create<{ drawerOpen: boolean; toggle: () => void }>((set) => ({
    drawerOpen: false,
    toggle: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));

function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return <UserRoute><UserForm /></UserRoute>;
}
```

zustand 管应用状态，model 管正在编辑的实体及其规则。
`UserRoute` 遵循 [owner 生命周期](REACT_CN.md#react-中的-model-生命周期)。
见 [组合示例](../examples/react-best-practices/7-10-2-with-zustand.tsx)。

#### 7.10.3 与 Redux Toolkit 组合

保留 RTK 作为应用状态库，为编辑器、向导或表单使用 model。
每个编辑对象有独立 owner，通过 [提交检查](REACT_CN.md#提交流程)
后，将 model 的已提交数据 dispatch 到应用状态库，避免每个表单字段都写 action 和 reducer。

见 [组合示例](../examples/react-best-practices/7-10-3-with-redux.tsx)。

#### 7.10.4 哪些场景**不要**用 `model-reaction`

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

见 [对比示例](../examples/react-best-practices/7-10-5-cheat-sheet.ts)。
这些组合示例需要额外安装第三方依赖，库本身不会安装它们。
