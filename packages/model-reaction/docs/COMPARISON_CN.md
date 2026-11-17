# model-reaction、zustand 与 Redux Toolkit

[English Version](COMPARISON.md) | 中文 | [文档导航](README_CN.md)

`model-reaction` 为领域实体提供字段校验、派生值与被拒输入跟踪。
Redux Toolkit 和 zustand 提供应用状态容器。根据管理的状态选择工具；
表单模型可以与应用 store 并用。

## 能力与边界

| 关注点 | Redux Toolkit | zustand | model-reaction |
| --- | --- | --- | --- |
| 建模 | slice、reducer、action | 提供 `set` / `get` 的 store | 扁平字段 Schema |
| 更新 | Immer 支持的不可变 reducer 更新 | 约定不可变更新，可选 Immer | 校验后整体替换字段，浅冻结快照 |
| 派生值 | selector，提供 `createSelector` | selector 或应用逻辑 | 声明 `reaction.fields`，纯函数 `computed` |
| 异步工作 | thunk、listener middleware、RTK Query | 应用 action 或集成 | 异步 validator 与 `reaction.action` 组 |
| 字段校验与脏数据 | 应用或表单库实现 | 应用或表单库实现 | 内置 validator、`validationErrors`、`getDirtyData()` |
| React 订阅 | React Redux selector | store selector | 字段绑定与 selector Hook |
| 完成时机 | 取决于异步集成 | 取决于应用 action | `settled()` 覆盖模型校验、计算与 action |
| 持久化 | 应用逻辑或集成 | persist middleware | 应用负责序列化与恢复 |
| 观测 | Redux DevTools 集成 | DevTools middleware | [专用扩展](DEVTOOLS_CN.md) |

selector 为读取方计算结果；模型 reaction 会验证并提交派生字段，进而触发下游
reaction。二者语义和成本不同。循环诊断针对声明的计算依赖，不涵盖任意 action
闭包回写。

## 如何划分

- 编辑实体需要校验、dirty input 或计算依赖图时，使用 model。
- 抽屉开关、主题、当前选中实体等直接管理的应用状态，可以使用 zustand。
- 应用需要 reducer 更新、action 追踪及配套中间件、查询集成时，可以使用 Redux Toolkit。
- 服务端缓存交给 RTK Query、TanStack Query 等查询层。

大型表单可以保持单个 model，通过 Schema 片段组合。owner 生命周期独立时使用
不同模型，它们之间的协调由应用负责。

## 同一字段的三种写法

下面的片段展示必填名称规则放在哪里。Redux 和 zustand 示例会把被拒文本写入
`name`；model 将它保存在 `dirtyData`，由 `useDraftField` 回显编辑文本。
这些片段不代表语义等价的完整表单实现；省略了 import 与应用装配。

### Redux Toolkit

```ts
const userSlice = createSlice({
  name: 'user',
  initialState: { name: '', errors: {} as Record<string, string> },
  reducers: {
    setName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
      if (!action.payload) state.errors.name = 'required';
      else delete state.errors.name;
    },
  },
});

const name = useSelector((state: RootState) => state.user.name);
const error = useSelector((state: RootState) => state.user.errors.name);
dispatch(userSlice.actions.setName(value));
```

### zustand

```ts
const useUser = create<{
  name: string;
  error: string | undefined;
  setName: (value: string) => void;
}>((set) => ({
  name: '',
  error: undefined,
  setName: (value) => set({ name: value, error: value ? undefined : 'required' }),
}));

const name = useUser((state) => state.name);
const error = useUser((state) => state.error);
useUser.getState().setName(value);
```

### model-reaction

```ts
const userModel = createModel<{ name: string }>({
  name: { type: 'string', default: '', validator: [ValidationRules.required] },
});

const { draft, setDraft, meta, writeError, onBlur, showError } =
  useDraftField(userModel, 'name');
// 绑定 draft/setDraft；showError 时显示 writeError?.message ?? meta.error。
```

完整[对比片段](../examples/react-best-practices/7-10-5-cheat-sheet.ts)需要额外安装
Redux 与 zustand。模型所有权和输入绑定统一见 [React 绑定](REACT_CN.md)。

## 组合 Store 与 Model

应用 store 决定打开哪个编辑器，编辑器 owner 创建和销毁自己的 model。
完成[提交检查](REACT_CN.md#提交流程)并收到服务端成功响应后，再把已接受实体
发布到应用 store。

| 集成方式 | 参考 |
| --- | --- |
| zustand 管理全局 UI 状态，model 管理编辑器字段 | [zustand 片段](../examples/react-best-practices/7-10-2-with-zustand.tsx) |
| Redux Toolkit 管理应用实体，model 处理表单编辑 | [Redux 片段](../examples/react-best-practices/7-10-3-with-redux.tsx) |

避免维护两份可以独立编辑的相同表单字段。编辑文本和 UI 标记按需保留在局部，
具体见[受控输入](REACT_CN.md#严格--异步校验下的受控输入)。
这些集成为可选项，库不安装对应 store。

## 性能测量

仓库提供探索性的 [model-vs-zustand benchmark](../benchmarks/model-vs-zustand.ts)。
确保 `tsx` 与 `zustand` 可用后，在仓库根目录执行：

```bash
pnpm --filter model-reaction exec tsx benchmarks/model-vs-zustand.ts
```

脚本统计创建、写入、订阅和派生工作的中位耗时，但两侧没有实现等价的校验、
dirty data 与 reaction 完成语义。报告耗时时应记录运行时、依赖版本、机器和 Schema。
按应用的实际 Schema、异步工作和渲染路径测量；不需要模型语义的
高频原始数据可以放在表单模型之外。
