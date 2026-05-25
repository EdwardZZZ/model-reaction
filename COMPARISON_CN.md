# model-reaction vs zustand vs Redux

[English Version](COMPARISON.md) | 中文

本文档系统对比 `model-reaction` 与社区两大主流状态方案 **Redux (Toolkit)**、
**zustand**，帮助你在选型时做出合适决策。

> 三者解决的是**不同抽象层级**的问题：Redux 与 zustand 是「state container」，
> 而 `model-reaction` 是「model layer」。前者管"数据放哪里"，后者管"数据该
> 满足什么规则、怎样联动"。它们并不互斥，组合使用反而更顺手。

---

## 1. 一句话定位

| 库 | 定位 |
|----|------|
| **Redux (Toolkit)** | 单一全局 store + 不可变更新 + 严格单向数据流的**应用级状态容器** |
| **zustand** | 极简 hook-based 的**通用状态容器**，可多 store、可变更新 |
| **model-reaction** | Schema 驱动的**领域模型/表单层**，自带校验+反应+脏数据+错误体系 |

---

## 2. 核心维度对比

| 维度 | Redux Toolkit | zustand | model-reaction |
|------|---------------|---------|----------------|
| 包体积 | ~12KB（RTK 完整） | ~1KB | ~6KB |
| API 复杂度 | 中（store/reducer/action/slice/selector） | 极低（`create`/`set`/`get`） | 中（schema-first，集中声明） |
| 数据建模 | reducer 命令式 | store 命令式 | **schema 声明式** |
| 不可变性 | 强制（Immer 内置） | 默认可变 | 内部 `deepEqual` + 替换 |
| 状态范围 | 单一全局 | 多 store / slice | **每模型一份**，按领域切分 |
| 校验 | ❌ 无 | ❌ 无 | ✅ 同步/异步/条件/跨字段 |
| 派生值 | reselect | selector + middleware | ✅ **schema 内 reaction** |
| 副作用 | redux-thunk / saga / observable | 手写 / middleware | ✅ `reaction.action` |
| 脏数据 | 自己实现 | 自己实现 | ✅ `getDirtyData()` |
| 异步流程协调 | 中间件生态 | 自行处理 | ✅ `settled()` 内置 |
| 事件订阅粒度 | 整体 subscribe + selector | subscribe + selector | ✅ **字段级 + 派生级** |
| DevTools | ✅ Redux DevTools 一等公民 | ✅ middleware | ❌ 暂无 |
| 持久化 | redux-persist | persist middleware | ❌ 暂无 |
| TypeScript | RTK 重型推导 | 简洁 | **schema 推导 data 类型** |
| 学习曲线 | 中-高 | 低 | 中 |
| 生态 | 极大 | 大 | 小 |

---

## 3. 心智模型差异

```
Redux:           action -> reducer (pure) -> new state -> view
zustand:         set(state) -> view
model-reaction:  setField -> [transform] -> [validate] -> commit -> [reaction] -> view
```

- **Redux**：所有变更必须经过 action，强约束、可追溯、可时间旅行。
- **zustand**：你怎么写都行，函数式或命令式都支持，几乎没有约束。
- **model-reaction**：每个变更天然带「校验 → 提交 / 进脏数据 → 触发依赖」的领域语义。

---

## 4. 优劣势矩阵

### 4.1 Redux Toolkit

**优势**
- 大型团队的纪律性最强：任何变更必有 action，便于审计、回放、测试。
- DevTools 与插件生态最成熟（time travel、persist、saga、observable）。
- 跨组件、跨模块、跨页面的复杂状态机首选。

**劣势**
- 代码量大（即便 RTK 简化后仍多于 zustand）。
- 不适合表单：每个字段都写 action / reducer 是噩梦。
- 默认不带校验、派生（需 reselect）、异步（需中间件）。

### 4.2 zustand

**优势**
- 极简：`create((set) => ({...}))` 即用。
- 多 store、slice 模式、middleware 生态成熟（persist / immer / devtools / subscribeWithSelector）。
- 心智负担最低，迁移成本最低。

**劣势**
- 没有约束 → 大型项目容易写飞。
- 无校验、无 schema、无脏数据、无事件分类。
- 表单 / 领域模型场景需自己搭一整套。

### 4.3 model-reaction

**优势**
- **Schema-first**：字段类型 / 校验 / 默认值 / 反应 / 转换集中声明，一目了然。
- **校验内置**：同步 / 异步 / 条件 / 跨字段，附 `dirtyData` + `validationErrors` + `getValidationSummary`。
- **Reaction 内置**：`fields → computed → action`，依赖图自动管理，循环依赖检测。
- **字段级订阅**：`subscribeField` / `useModelField` 比 selector + memo 更精确。
- **异步协调**：`settled()` 一行等齐所有 reaction + validation。
- **错误分类**：`ErrorType` 枚举 + `ErrorHandler`，比 reducer 里 try-catch 整洁。

**劣势**
- **不是通用 store**：不适合管 UI 状态 / 路由 / 全局共享。
- **生态薄**：无 DevTools、无 persist、无中间件。
- **多 store 协调弱**：跨 model 联动需自行编排。
- **写入需 await**：`setField` 返回 Promise（因校验异步）。
- **React 集成虽已加强（`ModelProvider` / `Field` / `useModelFieldState`）**，但社区资源远不如 RTK / zustand。

---

## 5. 同一需求的代码风格对比

需求：`name` 字段，必填校验，错误信息渲染。

### 5.1 Redux Toolkit

```ts
// slice
const userSlice = createSlice({
  name: 'user',
  initialState: { name: '', errors: {} as Record<string, string> },
  reducers: {
    setName: (s, a: PayloadAction<string>) => {
      s.name = a.payload;
      if (!a.payload) s.errors.name = 'required';
      else delete s.errors.name;
    },
  },
});

// 组件
const name = useSelector((s: RootState) => s.user.name);
const error = useSelector((s: RootState) => s.user.errors.name);
dispatch(setName(value));
```

### 5.2 zustand

```ts
const useUser = create<{
  name: string;
  errors: Record<string, string | undefined>;
  setName: (v: string) => void;
}>((set) => ({
  name: '',
  errors: {},
  setName: (v) =>
    set((s) => ({
      name: v,
      errors: v
        ? { ...s.errors, name: undefined }
        : { ...s.errors, name: 'required' },
    })),
}));

// 组件
const name = useUser((s) => s.name);
const error = useUser((s) => s.errors.name);
useUser.getState().setName(value);
```

### 5.3 model-reaction

```ts
const userModel = createModel<{ name: string }>({
  name: { type: 'string', default: '', validator: [ValidationRules.required] },
});

// 组件
const [name, setName, meta] = useModelFieldState(userModel, 'name');
// meta.error 自动来源于 validator
```

校验逻辑、错误状态、字段订阅都内置，且类型全自动。

---

## 6. 选型决策树

```
是表单 / 领域实体 / 含校验联动？
├─ 是 → model-reaction
│       └─ 同时需要全局 UI 状态？组合：model-reaction + zustand
│
└─ 否（通用状态） →
    ├─ 团队大 / 强审计 / 复杂状态机 → Redux Toolkit
    ├─ 中小项目 / 追求简洁 → zustand
    └─ 已有 Redux 项目，仅加表单 → 在 Redux 之外引入 model-reaction
```

---

## 7. 三者并不互斥

实际项目里更常见的是**组合**：

| 项目类型 | 推荐组合 |
|---------|---------|
| 中小型 SPA + 复杂表单 | **zustand**（全局）+ **model-reaction**（每个表单 / 领域对象） |
| 大型企业应用 | **Redux Toolkit**（应用骨架）+ **model-reaction**（业务表单层） |
| 仅是表单密集型应用 | **model-reaction** 单独足矣，配合 `ModelProvider` |
| 极简 demo / 内部工具 | **zustand** 单独 |

---

## 8. 一句话总结

- **想要纪律和生态** → Redux
- **想要轻和快** → zustand
- **想要 schema、校验、反应、脏数据这一套领域能力开箱即用** → model-reaction

它们解决的是**不同抽象层级**的问题：Redux / zustand 是「state container」，
`model-reaction` 是「model layer」。前者管"数据放哪里"，后者管"数据该满足什么
规则、怎样联动"。把它们组合起来用，反而比强行二选一更顺手。
