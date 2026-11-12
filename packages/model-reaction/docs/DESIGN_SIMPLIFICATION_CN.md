# 技术方案：收敛模型契约与内部状态

> 状态：已按确认方案实施，最终检查结果见 §11。  
> 日期：2026-11-12；代码基线：`35cd505`。  
> D2、D3、D4 已采用；D1 未采用，保留 deepEqual。下文方案条目记录本次取舍与实现依据。  
> 当前公开行为以 [API_CN.md](API_CN.md) 和 [REACT_CN.md](REACT_CN.md) 为准。

## 1. 目标与范围

库继续服务以字段模块为中心的模型：显式输入、验证后提交、失败输入留存、派生计算、字段内 action，以及可选 React/DevTools。

本次优化以减少使用规则、状态所有者和执行分支为目标。每项改动应能说明删除了什么，而不是增加适配层来同时保留新旧实现。

| 范围 | 本方案建议 | 状态 |
| --- | --- | --- |
| 字段计算 | 每字段最多一个 reaction；action 仍是数组 | 主方案，破坏性 |
| 直接写入 | setField / setFields 共享准备与候选快照流程 | 主方案，行为变化 |
| 未知字段 | 固定 reject，移除 strictMode；保留错误事件 | 主方案，破坏性 |
| 批量字段预检 | 所有 key 合法后才开始 transform / validation | D3 已实施 |
| 字段内校验 | 固定声明顺序、首错停止，移除 failFast | 主方案，破坏性 |
| action 执行器 | 候选与活动组使用一个集合 | 主方案，内部重构 |
| React selector | 保留两个 Hook，共享现有快照实现 | 已复查，保持 |
| 字段相等性 | 保留 deepEqual，不增加比较策略配置 | D1 未采用 |
| 已确认缺陷 | 修复字段字典、输入并发与 DevTools 问题 | 已实施；输入错误出口采用 D4 |
| 超时、防抖 | 保留 asyncValidationTimeout / debounceReactions | 保持 |

以下不纳入本次主方案：删除类型推导、删除 CommonJS/UMD、JSON-only 数据限制、静态 DAG 强制校验、重写拓扑调度、独立 effects、删除 action 数组、改变 action 错误归属、扩大 DevTools 协议重构。

这些能力可以另行评估；本次不增加运行时开关来预留多种方案。

## 2. 需要保留的契约

1. `data` 是已提交值；`dirtyData` 是失败输入；React draft 是正在编辑的文本。三者保持不同生命周期。
2. 普通验证失败返回 false，不替换 committed 值；合法字段的批量验证仍允许部分成功。
3. 默认值直接播种、不自动验证；初始化仍计算派生字段，相等中间值也要继续初始化下游。
4. computed 保持同步、纯函数；`SKIP_REACTION` 不验证、不提交、不登记 action。
5. action 等待计算落定，计算不等待 action；每一项 action 启动前重新检查计算与宿主版本。
6. `settled()` 覆盖库追踪的校验、计算和 action 返回的 Promise；不能在同一模型的 action 内等待它。
7. validation request ID 决定写入新鲜度；host action version 决定 action 资格，两者不能合并。
8. 保留延迟任务捕获的版本、直接/reaction 提交来源、运行中旧 Promise 的观察和 dispose 防护。
9. 对象字段仍按整体更新，不观察原地修改。Date、数组、普通对象继续支持。
10. core、validation、React、DevTools 保持独立入口；显式 `Model<T>`、schema 推导和 `Reaction<T>` interface 扩展能力保持。

action 的完整执行契约继续沿用 [现有 action 设计记录](DESIGN_EFFECT_DEPS_CN.md)。本方案只替换指定内部结构，不重新定义全部调度语义。

## 3. 公开 API 的目标变化

### 3.1 每字段一个 reaction

保留 `Reaction<T>` 的三个成员：

```ts
type ReactionAction = () => void | PromiseLike<void>;

interface Reaction<T = any> {
  fields: string[];
  computed: (values: Record<string, any>) => T | typeof SKIP_REACTION;
  action?: ReactionAction[];
}
```

[TypedFieldSchema](../src/types.ts) 的 reaction 成员从：

```ts
reaction?: Reaction<ComputedValueMap[K]> | Reaction<ComputedValueMap[K]>[];
```

收敛为：

```ts
reaction?: Reaction<ComputedValueMap[K]>;
```

这是成员级修改，不重写 FieldSchema 的整个类型体系。root 与 DevTools 的 createModel 类型保持一致。

构造阶段检测 reaction 数组并抛出包含字段名的 TypeError；检查必须先于默认值初始化和异步任务启动。空数组也拒绝，不把它静默当作没有 reaction。

迁移方式：

- 单元素数组直接解包。
- 多个分支共同决定一个结果时，改成一条明确的计算规则。
- 独立结果拆成不同字段。
- 不提供数组兼容转换；不能机械合并依赖并依次执行旧函数，这不保留原来的触发和验证语义。

### 3.2 ModelOptions

主方案的公开配置只保留：

```ts
interface ModelOptions {
  asyncValidationTimeout?: number; // 保持默认 5000ms
  debounceReactions?: number;     // 保持默认 0ms
}
```

移除 strictMode 与 failFast 的类型和运行时分支；字段不存在固定 reject，字段内校验固定首错停止。

不增加 `legacy`、`validationMode`、`comparisonMode` 等替代开关。旧配置调用处必须迁移，不能依赖传入旧属性恢复旧行为。

### 3.3 保留两种 selector

| Hook | 订阅策略 | 推荐用法 |
| --- | --- | --- |
| useModelSelector | model / selector / isEqual 共同决定订阅；模型层先过滤通知 | 稳定、可复用 selector |
| useModelComputed | 只按 model 订阅；快照层比较结果 | 依赖 props/state 的内联 selector |

两者继续使用 [useSelectionSnapshot](../src/react/selectors.ts)，保留 render-local 缓存和 committed 比较基线；不改名、不合成别名、不增加策略参数。useModelFields 保持现有便利包装。

## 4. 统一直接写入流程

### 4.1 两种准备入口，一条校验提交管线

| 入口 | 输入准备 | validator / condition 的 data |
| --- | --- | --- |
| setField | 委托单字段 setFields 流程 | committed + 本次经过 transform 的候选值 |
| setFields | 每个直接输入 transform 一次 | committed + 整批经过 transform 的候选值 |
| validateAll | 读取 committed 与 dirty，不再 transform | committed + dirty |
| reaction 写回 | 继续内部入口，保留 origin、路径与初始化标记 | 本阶段沿用当前 reaction 写回上下文 |

上述快照都浅冻结。候选输入包含本批尚未通过验证的值；它不是已经全体有效的数据。字段仍各自验证、各自提交。

建议在 [ModelManager](../src/core/model-manager.ts) 内先收敛为两段职责：

1. **准备输入**：字段检查、必要的 transform、构造 prepared entries 和共享快照。
2. **验证提交**：各字段分配请求 ID、执行校验、提交或记录 dirty、发事件、收集真实变化。

setFields 和 validateAll 使用同一校验提交基础流程，但保留不同输入准备。不要通过重新调用公共 setFields 实现 validateAll，否则会重复 transform dirty。

本阶段复用现有 runBatch 的任务生命周期；最终检查后，其结果已固定为 boolean，
完成回调收敛为可选通知。不增加通用流水线框架。

### 4.2 直接写入的具体时序

建议顺序如下，批量 key 预检以 D3 采用为前提：

1. 检查模型生命周期，持有整批 compute 任务。
2. 读取输入自有 key，检查所有字段是否属于 schema。
3. 对全部直接输入各执行一次 transform。
4. 构造稳定、浅冻结的共享候选快照。
5. 不同字段可以并行校验；单字段内部按 §5 顺序执行。
6. 通过的最新请求提交到 data；失败的最新请求写入 dirty。
7. 对真实变化字段登记 reaction；validateAll 的总完成事件仍在外层任务释放前发送。
8. 释放整批任务，返回各字段结果的逻辑与；应 reject 的错误在安全收尾后传播。

整批任务必须覆盖候选准备、验证、reaction 注册和对应完成事件，避免某个字段先结束时出现假空闲。

不要只因为固定了未知字段 reject 就把 allSettled 换成 Promise.all。必须先证明其他拒绝不会导致批次任务在兄弟字段收尾前释放。

### 4.3 未知字段与 transform 异常

主方案保留 `field:not-found` 事件，然后 reject；普通 validator 失败继续 resolve false。

D3 已采用：发现未知 key 时，该批次不读取输入值、不开始 transform、validation 或字段提交。按输入 key 顺序报告首个未知字段并拒绝；不声称事件监听器自身发起的其他写入也被回滚。

这与当前 strict 批次“合法字段提交后再拒绝”不同，是独立的行为迁移，不能隐含在删除 strictMode 中。

transform 抛错继续作为异常传播，不伪装成正常校验失败，也不把未转换文本放进含义不同的 dirtyData。React 对 rejected setter 的处理见 §8.2。

### 4.4 跨字段读取的迁移

单字段写入的 data 自字段值由旧 committed 变为候选新值。例如旧规则：

```ts
validate: (value, data) => value > data!.amount
```

可能依赖 `data.amount` 表示旧值。迁移后它会比较新值与自身。此类“必须递增”的操作前置条件应移到业务写入入口，或由业务显式提供比较基准。

不向 validator 再增加 previousData 参数；否则会用新 API 抵消本次语义收敛。

## 5. 固定字段内校验策略

建议使用一个顺序循环，按 schema 中的规则顺序执行：

1. 使用该字段请求的候选快照判断当前 condition。
2. condition 为 false：跳过当前规则。
3. condition 抛错：报告当前 condition_error，结束该字段。
4. 执行 validate；同步或异步结果均遵守现有请求过期处理。
5. 结果失败、异常或超时：报告对应错误，结束该字段。
6. 当前规则通过后再进入下一条；全部通过才允许提交。

删除 applicable 预筛选数组、conditionFailed 聚合标记、failFast 分支和并行全收集路径。错误仍用既有只读数组表示，不连带修改 React/DevTools 的错误类型。

注意迁移差异：

- 原 failFast=true 也先扫描全部 condition；新方案是 condition / validate 交错执行，错误优先级会改变。
- 原全收集模式可能展示同字段多个错误；新方案只执行到首错。
- 多条异步规则全部通过时会依次等待，可能比并行模式慢。廉价同步规则应排在前面；确需并行的独立请求可封装在同一个业务 validator 内。

timeout 继续仅作用于异步规则，并在完成后清理定时器。保留迟到结果忽略、错误回调重入、同步结果的异步完成边界及 dispose 保护，不以重写成单循环为理由改变这些行为。

## 6. Reaction 与 action 的内部结构

### 6.1 以宿主字段确定计算身份

[ReactionSystem](../src/reaction/reaction-system.ts) 每个宿主只创建一个 ReactionJob，保留这个小型内部结构承载 field 与 reaction，不强求删除文件。

具体变化：

- jobsByField 不再保存字段内的 Reaction → Job 二级映射。
- reactionTimeouts 每个宿主只保留一个待执行记录，不再包含 jobs Map。
- 同宿主重复调度替换该记录；定时器闭包捕获本次调度的 actionVersion 和 reactionStack，
  等待记录只保留 timeoutId 与 endTask。
- 不同宿主即使复用同一个 reaction 对象，也仍是独立任务。
- 保留反向依赖索引、每次触发的宿主去重和当前调度顺序。

防抖替换时先取得新任务，再取消旧等待记录；定时器触发后先摘除等待记录，防止重入调度误用正在执行的记录。记录的任务覆盖 computed、写回校验和 action 登记后再结束。

继续使用 [eachReaction / eachReactionEdge](../src/reaction/reaction-graph.ts) 作为依赖解释的共同入口。保留运行时路径循环检测和缺失依赖诊断；本次不同时改成构造期 DAG 校验。

### 6.2 一个 action 组集合

[ActionExecutor](../src/reaction/action-executor.ts) 的状态建议收敛为：

```text
fieldActionVersion: Map<field, version>
groups: Set<ActionGroup>
fieldOrder: Map<field, schemaOrder>
flushScheduled / disposed / compute-idle subscription
```

ActionGroup 继续保存 job、捕获版本、当前 index、running 和幂等任务释放函数。

删除 pendingActions Map 和 handoff 的集合搬运：

1. 最新有效计算登记 action 时，立即建立唯一组任务并加入 groups。
2. compute 归零时只安排 flush；已空闲时登记组也安排 flush。
3. flush 先固定 ready 快照，按现有字段声明顺序尝试启动。
4. 每项调用前同步检查未销毁、版本匹配、compute 空闲；检查与调用之间不 await。
5. Promise 完成后，下一项重新经过检查；失败停止本组并按当前错误规则报告。
6. 版本失效时立即移除非 running 旧组；running 旧组继续观察已开始 Promise，结束后释放。

同一次调度最多登记一次组。一个字段可同时有旧的 running 组和新的有效组，因此不能把 groups 简化为“每字段只存一个组”。

所有路径保持一组一个 action 任务。登记组先于计算任务释放；新计算持有任务先于取消旧组。初始化第一次 action 仍通过微任务延迟到 createModel 返回之后。

### 6.3 调度兼容边界

以下行为继续存在：

- 较新的 SKIP 可以取消较早 action 资格，但不必取消较早仍有效的写入。
- 相等 computed 值也可登记 action；初始化成功也可登记。
- 直接真实变更使宿主旧组失效，但不自行启动该宿主的新 action。
- 无关字段计算只形成屏障，不改变宿主版本。
- 新组不等待旧组已经开始的请求。
- 旧 action 拒绝仍按当前规则进入宿主错误状态；不在此次集合重构中改为 event-only。

## 7. D1：Object.is 评估（未采用）

本次保留 deepEqual，以下对照仅记录未采用的备选方案。结构去重、NaN 与带符号零的模型传播行为不变。

该项独立于单 reaction、配置删减和组集合重构。评审应选定一种长期契约，不增加全局或字段级 comparator 模式。

若采用，commitValid 的变化判断固定为：

```ts
const dataChanged = !Object.is(previousValue, value);
```

随后删除 deep-equal.ts 及其内部依赖；原地修改仍不受观察，Date/数组等字段类型继续支持。

| 情况 | 当前行为 | Object.is 方案 |
| --- | --- | --- |
| 内容相同的新对象或数组 | 不提交新引用 | 提交新引用并触发字段变化 |
| 同时间的新 Date、同表达式的新 RegExp | 不变 | 变化 |
| 同一个对象引用 | 不变 | 不变 |
| NaN → NaN | 变化 | 不变 |
| +0 → -0 | 不变 | 变化 |

相等判断仍在验证之后，不跳过 transform / validator。dirty 清除、字段完成事件和初始化传播按其各自规则处理。

评审需接受两项传播后果：

- 内容相同的新派生对象也会触发下游计算、校验和 action；订阅层 shallow 无法撤销这些模型工作。
- 直接设置内容相同的新对象会使宿主旧 action 剩余项失效。宿主自身已触发的成功 reaction 原本就允许执行 action，不能把所有 action 增量归因于相等性变化。

选择建议：若业务自然遵循“新引用代表新值”，可采用；若迁移后需要在大量计算与入口补深比较、补缓存，则保留当前结构比较更省总体成本。比较函数只有约 100 行，行数不是唯一选择依据。

cloneDefault 的隔离、循环处理和 DevTools 遍历预算保持；不以删除比较分支为理由删除复制或展示保护。

## 8. 配套修复与局部去重

### 8.1 字段字典

dirty / schema 成员检查统一使用自有属性语义，修复 toString 被当成 dirty 值的问题。

字段名不新增保留字黑名单。内部以字段名索引的可变 record 使用无原型字典，或等价的安全自有属性写入；公开快照保持原有浅冻结 record 形态。构造候选快照时使用对象展开、Object.fromEntries 等安全创建自有属性的方式，避免 `__proto__` setter 改变对象原型。

覆盖 toString、constructor、作为自有 key 的 `__proto__`；不要只修一个 `in` 判断而保留其他不一致路径。

### 8.2 React draft

保留 draft 会话、未完成请求、内部/外部提交区分、dirty 播种和原始编辑文本保护。

formatter 只在 render 提交后发布给异步回调，避免 Suspense 中未提交的 formatter 污染当前输入。使用 commit 阶段更新，兼顾 SSR；单独改变 format 不重新播种正在编辑的文本。验证“format 与外部值一起更新”和“挂起的新 render 与旧请求完成交错”。

**D4 已采用：rejected setter 的错误出口如下：**

- 保持 setDraft 返回 void，在内部完整处理 setter 拒绝及其收尾链，不再产生无人处理的 Promise 拒绝。
- 在 DraftField 返回值中增加 `writeError: Error | null`，只表示当前编辑会话的写入异常；保留 Error 实例，其他抛出值转为带相应消息的 Error，不写入 model.validationErrors 或 dirtyData。
- 只允许当前会话最新 edit 的错误更新该值；新编辑或切换 model/field 时清空。
- 保留失败文本；外部提交的回填仍遵守原有协调规则。
- showError 改为 touched 且存在 writeError 或 meta.error；展示消息优先使用 writeError.message，再使用 meta.error。
- 规范示例与 demo 同步处理该字段。新增返回成员会影响手工构造 DraftField 类型的调用方，门控语义变化也需写入 React 迁移说明。

此次只收敛错误出口，不引入 parse/format codec、onChange/onBlur 校验模式或 UI 状态进入核心。

### 8.3 DevTools

- 用户选择作为 panel reducer 的本地 action；删除 selectedOverride，实例删除后回退到有效选择。这个 action 不进入浏览器传输协议。
- 非有限数与负零统一使用 `{ t: 'number', v: 'NaN' | 'Infinity' | '-Infinity' | '-0' }`，避免 JSON 丢失数值表示，普通有限数继续走 primitive；serializer、wire 类型和 ValueTree 已同步。该显示修复不改变模型相等性。
- 单 reaction 后，现有 action 元数据中的 reactionIndex 暂固定为 0，保留协议形状；不借此删除旧 hook 支持。
- 图方向、孤立字段、action 下标、时间线容量、节点/字节预算以及 error/dirty-only 刷新保持。

### 8.4 小型内部整理

EventEmitter.on 可直接返回 disposer，ModelManager 转发；删除没有生产调用的整事件 off 分支。保留派发快照、异常隔离和同一回调重复注册的既有取消语义。

validateField 收窄为内部协作者，选项默认值由 model 统一决定；错误过期过滤集中到 model 回调，但提交前检查保持。保留同步/异步结果边界，不能因收窄可选参数而让过期错误可见。

Rule 复用 Validator 的签名，保持普通对象规则和便利构建器兼容。其余快照存储、React 字段订阅合并和打包去重暂不混入主改造。

## 9. 文件职责与实施顺序

| 顺序 | 工作单元 | 主要位置 | 完成条件 |
| --- | --- | --- | --- |
| 阶段 0 | 已确认缺陷 | model-manager、draft-field、DevTools panel/serialize | 定向复现变成回归保障；D4 已确定 |
| 阶段 1 | 单字段计算身份 | types、reaction-graph、reaction-system、DevTools 元数据 | 数组声明被明确拒绝；依赖图与运行时一致 |
| 阶段 2 | 固定校验与直接写入 | model-manager、validate-field、types | D2/D3 的行为成立，保留批次任务和请求过期保护 |
| 阶段 3 | action 单集合 | action-executor | 保持全部 action 屏障、取消、重入和收尾契约 |
| 阶段 4 | 可选引用相等 | model-manager、deep-equal、文档 | D1 未采用，不实施 |
| 阶段 5 | 迁移与发布验证 | 双语 API/README/REACT、examples、导出检查 | 示例可运行，类型与各入口一致，完整检查通过 |

阶段 1/2/3 分别验证，避免同时改变调度身份、写入上下文和执行组存储后无法区分回归来源。缺陷修复与契约收口也分开记录。

坚持一个文件一个职责。必要时抽出输入准备或内部提交类型，但不新增通用 scheduler、SnapshotStore、兼容中间件或 schema 编译框架。

## 10. 兼容与迁移清单

| 调用方 | 要做的修改 |
| --- | --- |
| reaction 数组 | 单项解包，多项按业务结果重构；不能使用自动并集转换 |
| strictMode / failFast | 删除选项，适配固定 reject / 首错契约 |
| 使用 validator data 自字段旧值 | 将旧值相关前置条件移到业务入口 |
| 混有未知 key 的 setFields | 调用前映射 DTO 字段；不再依赖合法字段部分落地 |
| 同字段多错误展示 | 适配首错结果；保留错误数组消费接口 |
| 非 string 文本输入与 transform 抛错 | 显示 writeError 并保留输入 |
| 依赖结构去重的对象写入 | 无迁移；继续结构判等 |
| React selectors | 无迁移；两个 Hook 均保持 |
| DevTools | serializer / renderer 同步升级；单 reaction 仍保留 reactionIndex=0 |

本方案按包含破坏性变更的发布处理，不能作为普通补丁悄然改变行为。现有 [action 迁移](API_CN.md#action-组)继续有效；本文不恢复旧 action 参数或单函数兼容。

已同步中英文 API、README、REACT、BEST_PRACTICES、DevTools 文档、AGENTS 与可运行示例。action 设计记录已注明被替换的历史内部结构，公开执行规则在 API 中维护。

## 11. 验收矩阵

| 范围 | 必须覆盖的场景 |
| --- | --- |
| API / 类型 | 单 reaction 推导与显式泛型；Reaction interface 扩展；数组编译失败与 JS 构造失败；root/DevTools 类型一致；旧选项迁移 |
| 输入准备 | setField 与单项 setFields 的候选上下文一致；全部输入只 transform 一次；validateAll 不重复转换 dirty；快照浅冻结 |
| 批量结果 | 普通验证部分成功；D3 未知 key 在准备前拒绝；transform 抛错；任务不提前释放；validation:complete 顺序保持 |
| 校验 | condition false/异常；首错停止；同步与异步规则；timeout；快速连续输入；错误监听器重入；dispose 后迟到结果 |
| 默认与初始化 | 默认值不自动验证；相等派生值继续初始化；SKIP；防抖重排回到默认值 |
| 调度 | 重复依赖去重；同对象用于不同宿主；防抖版本捕获；较新 SKIP 不恢复旧 action；direct/reaction 来源 |
| action | 初始化闭包安全；逐项屏障；回写后的下游落定；旧运行中 Promise 与新组并行；组内失败；组间隔离；销毁与 settled |
| 相等性（D1 未采用） | 保留 deepEqual 回归及当前结构去重行为，不引入新的 action 传播 |
| React | 两种 selector 订阅差异；equality/model 切换；Suspense；格式变更；拒绝处理；切换字段；原始数字文本；StrictMode 与 SSR |
| DevTools | 选中实例删除后回退；非有限数 JSON 往返；图与实际依赖一致；错误/dirty 更新；截断预算不退化 |

React 当前不具备完整 composition 协议；上述回归不能被描述为已经解决 IME。本次不得以输入期间一律禁用控件来规避异步或组合输入问题。

代码落地后的完整检查从仓库根运行：

```sh
pnpm --filter model-reaction run lint
pnpm run typecheck
pnpm --filter model-reaction run test --runInBand --silent
pnpm --filter model-reaction run example:react
pnpm --filter model-reaction-devtools run test --runInBand --silent
pnpm -r run build
pnpm --filter model-reaction run verify:exports
```

最终验证（2026-11-12，含最终检查后的四处局部收敛）：

- 核心库 15 个测试套件、474 项全部通过，包含 React 77 项及保留的 deepEqual 回归。
- DevTools 6 个测试套件、66 项全部通过。
- lint、全仓类型检查（含可运行示例）、React SSR 检查、全仓构建全部通过。
- ESM / CommonJS 导出检查通过；核心、validation、React、DevTools 继续独立入口。

本次按 Unreleased 破坏性迁移记录，未调整发布版本号。上述结果为最终实现的回归结果，
不叠加原型或早期定向检查的测试数量。

## 12. 评审决策

| 编号 | 评审选择 | 实施决定 |
| --- | --- | --- |
| D1 | 是否采用 Object.is，并接受对象引用与 NaN/带符号零的传播变化 | 未采用；保留 deepEqual，不新增模式开关 |
| D2 | 是否接受单 reaction、固定首错，以及 setField 候选快照语义 | 采用主方案，按破坏性变更迁移 |
| D3 | 未知字段是否在整批准备前拒绝；是否保留错误广播 | 已采用预检，保留 field:not-found；此项独立于删除 strictMode |
| D4 | draft 的 rejected setter 是否以本地 writeError 暴露 | 已采用 §8.2；API 与展示门控变化单列，不进入核心错误状态 |

已确定保留的边界不再作为合并候选：两个 selector Hook、action 数组、异步超时、reaction 防抖、Date/数组支持及可选功能入口。
