# DevTools

一个用于在运行时检视 `model-reaction` 模型的浏览器扩展：实时数据树、React 派生值、字段依赖关系图，以及变更时间线。

[English Version](DEVTOOLS.md) | 中文

[← 返回 README](../README_CN.md)

---

## 目录

- [能得到什么](#能得到什么)
- [工作原理](#工作原理)
- [在应用中启用](#在应用中启用)
- [构建扩展](#构建扩展)
- [在 Chrome 中加载](#在-chrome-中加载)
- [使用面板](#使用面板)
- [DevTools Hook 契约](#devtools-hook-契约)
- [未安装 hook 时的行为](#未安装-hook-时的行为)
- [已知限制](#已知限制)

---

## 能得到什么

安装扩展并打开其面板后，通过 `model-reaction/devtools` 入口创建的模型会出现在
浏览器 DevTools 的 **Model Reaction** 标签页中，面板包含三个视图：

1. **数据树（Data Tree）** —— 模型的三个层次：
   - `data` —— 已提交的数据源（schema 默认值会未经校验直接写入）
   - `dirtyData` —— 每个字段最近一次校验失败的输入
   - `errors` —— 每个字段当前的校验错误
2. **依赖关系（Dependencies）** —— reaction 依赖关系图与 React 派生值。实线箭头**从依赖字段指向
   由 reaction 计算出的字段**（读作「`from` 供给 `to`」）。只被一个字段使用的 action
   在宿主模块内部展示，用虚线连接。同一函数引用只展示一个 action 节点；多个字段
   共用时，节点放在字段模块右侧，标注 `shared · N fields`，各声明字段的虚线汇入
   这个节点。同名但引用不同的函数仍分别展示。具名 action 显示函数名，匿名 action 保留
   `r0 · action[下标]` 标签。虚线表示归属与计算落定后的执行，
   不表示闭包读写依赖，也不要求宿主值变化；下标表示声明位置，提示文字列出全部声明。
   悬停字段会高亮其相关边；悬停共享 action 会高亮全部声明字段及其汇入的虚线。
   字段块使用蓝色底色，action 节点使用紫色底色；模块内 action、共享 action 及其
   悬停高亮均保持这一区分。
   `useModelSelector` / `useModelComputed` 的观测值显示为绿色底色的圆角终端节点，
   悬停高亮也保持绿色系。
   名称优先取自 `selector.name`，其次使用匿名 selector 源码，最后回退为 Hook 类型加编号。
   源码标签显示单行摘要，悬停显示序列化上限内的原始源码。实线依照自动采集的
   顶层字段读取连接到派生节点，悬停时高亮来源和连线。不支持采集的旧版集成显示依赖不可用。
   图下方显示完整值、Hook 类型和编号，见 [React 绑定](REACT_CN.md#devtools-派生值)。
   字段按依赖层次从上到下排列，同层保留 schema 顺序并对齐；
   每增加一级依赖就向右移动一列，计算箭头从源字段块右侧连接到目标字段块左侧。
   字段数量增加时沿纵向展开，图宽随依赖深度增加；共享 action 和派生节点
   共用右侧终端列，彼此不重叠。
   每个字段只为模块内展示的 action 预留高度，共享 action 不在声明字段中留下空行。
3. **时间线（Timeline）** —— 按时间倒序排列的字段提交变更列表。选中某一项可查看
   字段在该次提交前后的值。

## 工作原理

扩展采用与 React / Redux / Vue DevTools 相同的架构：在应用启动前安装一个全局 hook，
模型在检测到该 hook 存在时（且仅在存在时）把自己注册进去。注册是**按需开启（opt-in）**
的：你通过从 `model-reaction/devtools`（而非包根）导入 `createModel` 来启用，详见
[在应用中启用](#在应用中启用)。

```
[你的应用]
   │  import { createModel } from 'model-reaction/devtools'
   │  createModel() 检测到 hook → 注册（schema / 依赖图 / 快照 / 订阅）
   ▼
window.__MODEL_REACTION_DEVTOOLS_HOOK__     ← DevTools 入口唯一触点
   │  init / change / dispose
   ▼
page-agent.js   （注入到页面 MAIN world）
   │  window.postMessage（+ 环形缓冲区承载变更时间线）
   ▼
content.js      （ISOLATED world 中继）
   │  chrome.runtime 长连接端口
   ▼
background.js   （MV3 service worker，按 tab 路由）
   ▼
panel           （React UI：数据树 · 含派生值的依赖关系图 · 时间线）
```

按需开启的包装入口和内部 hook 契约统一位于
[src/devtools.ts](../src/devtools.ts)，该文件只导出 `createModel`；扩展位于
[packages/devtools](../../devtools)。包根（`model-reaction`）不引用 DevTools
集成代码。

## 在应用中启用

切换 import 即可启用。`model-reaction/devtools` 导出的 `createModel` 保持包根入口的
签名、校验与 reaction 调度语义，并向已安装的 DevTools hook 注册。

```ts
// import { createModel } from 'model-reaction';
import { createModel } from 'model-reaction/devtools';

const model = createModel(schema); // 现在会出现在面板中
```

hook 支持自动 selector 观测时，`model.data` 会使用稳定的浅层 Proxy，保留普通读取、
嵌套值引用和快照引用的一致性。原生结构化克隆不能克隆 Proxy，传给 `structuredClone`
或 `postMessage` 前需要先复制外层对象：

```ts
const copy = structuredClone({ ...model.data });
```

嵌套值本身仍须支持结构化克隆。面板使用自己的受限序列化器，应用无需为面板做这次复制。

未安装扩展时，包装层只查询一次全局 hook，然后返回未注册、未订阅的模型。若希望生产包
移除包装层及其 Proxy 采集代码，可在生产构建配置中把 `model-reaction/devtools`
alias 到 `model-reaction`；React 入口仍包含轻量上报检查。

## 构建扩展

在仓库根目录执行：

```bash
pnpm --filter model-reaction-devtools run build
```

该命令会把四个主要扩展执行环境（页面 agent、content 中继、background worker、
React 面板）及注册面板的 DevTools 页面打包进 `packages/devtools/dist/`，
并连同静态资源（`manifest.json`、`devtools.html`、
`panel.html`、`panel.css`）一起复制过去。

## 在 Chrome 中加载

1. 打开 `chrome://extensions`。
2. 打开右上角的 **开发者模式（Developer mode）**。
3. 点击 **加载已解压的扩展程序（Load unpacked）**，选择 `packages/devtools/dist`。
4. 在任意使用 `model-reaction` 的页面打开 DevTools，选择 **Model Reaction** 标签页。

> 面板在打开时会主动拉取当前状态，因此即使模型在面板打开之前就已创建，也能正常显示。

面板与页面中继的端口配对成功后，由后台请求完整 `init` 状态，不依赖两侧的连接顺序。
两侧在断线或临时连接失败后均每隔 250 ms 重试；即使断开回调尚未到达，
发送到关闭端口时也会进入恢复流程，后台会释放发送失败的端口。
主动关闭面板会取消该面板的重连。
任一侧重新连接都会重新同步当前实例、快照和页面 agent 保留的时间线，
以恢复断线期间遗漏的状态更新。后台 worker 无需保存或重放消息。
若重新加载或更新扩展导致页面的扩展上下文失效，中继会停止重试并移除监听；
需要刷新被检查的页面并重新打开 DevTools，才能恢复这个上下文。

## 使用面板

- 如果一个页面承载了**多个**模型，面板标题下方会出现一排模型按钮，
  每个按钮显示实例编号、字段数量及 schema 中前三个字段名，悬停可查看全部字段名。
  点击即可直接切换，选中模型会高亮，并保留当前视图；数量较多时可横向滚动，
  只剩一个模型时隐藏这一排按钮。
  选择属于面板本地状态，选中的实例消失后会回退到仍存在的实例。
- `NaN`、`Infinity`、`-Infinity` 和 `-0` 通过显式 number 标记经过 JSON 传输，
  数据树保留其显示，不会被变成 null 或零；普通有限数继续使用 primitive 表示。
- **时间线**由环形缓冲区限制大小（默认每个实例 100 条），因此长时间运行、变更频繁的
  页面也不会无限占用内存。
  Timeline 标签行右侧的 **Clear** 清空当前模型保存的历史，时间线为空时禁用。
  模型数据和其他模型的历史不受影响，之后的新变更继续记录，序号持续递增；
  重连后已清空的记录不会重新出现。
- 每条时间线记录保存本次提交前的字段值；首次变更、**Clear** 后的变更，
  以及前序记录已被淘汰的变更仍可查看 **previous**。
- 被拒输入、校验完成、dirty 清理和 reaction 错误都会自动刷新数据树。
  同步通知共用一次排队的快照刷新，只有已提交的字段变更进入时间线。
- **Dependencies** 中的派生节点和数值随 React 提交刷新，包括仅 props/state 改变的情况。
  同名或共享 selector 的 Hook 仍分项展示；卸载、切换模型或 dispose 后清理原条目及连线。
  观测到的依赖改变时，即使结果相等也会刷新连线。它们不进入 Timeline 或调度器的 reaction 图。
  空列表和观测不可用的提示放在图下方。
- 每份快照的 `data`、`dirtyData`、`errors` 和 React 派生值共享 2,000 个节点和保守的
  256 KiB UTF-8 JSON 字节预算；时间线中提交前、提交后的每个值各有独立预算。
  默认深度上限为 6，每个容器、record 或派生值列表最多 100 项，字符串前缀最多 10,000 个字符。
- 预算耗尽后停止遍历并显示截断标记；值、字段或错误被省略或裁剪时，
  面板显示快照截断提示，派生值、名称（包含匿名 selector 源码）及观测到的来源列表也受此限制。来源列表最多 100 项；
  超出剩余预算的字段名会被省略，不截断成其他名称；派生连线省略也由该提示覆盖。
  兄弟分支中的共享对象仍可读取，
  真正的循环引用会被标记。无法读取的值显示标记，保留其余快照。
- `Map` 的键值、`Set` 的元素、`RegExp` 的源码与 flags 保留类型和内容，
  并遵守相同预算。对象条目包含可枚举的自有 Symbol 属性，以 Symbol 标签显示。

## DevTools Hook 契约

`model-reaction/devtools` 入口通过一个全局对象与扩展通信。它是一条**私有的、仅用于开发期
的通道** —— **不**属于公开的 `ModelReturn` API，也不会从包根重新导出。参见 AGENTS.md §5：
库刻意不提供 `model.describe()` 这类内省方法，而本 hook 并不改变这一约定。包装层只通过模型
的公共 API（`data` / `getDirtyData()` / `validationErrors` / `on`）以及它收到的 schema 来
读取模型 —— 无需访问 `ModelManager` 的任何内部。

模型注册契约见 [src/devtools.ts](../src/devtools.ts)，React 上报契约见
[src/react/selectors.ts](../src/react/selectors.ts)，采集实现及私有类型见
[src/devtools-observer.ts](../src/devtools-observer.ts)：

```ts
interface ModelReactionDevtoolsHook {
  register(instance: DevtoolsModelInstance, model?: object): void;
  unregister(id: number): void;
  getDerivedObserver?(model: object): SelectorObserver | undefined;
  updateDerived?(model: object, token: object, selection: {
    kind: 'useModelSelector' | 'useModelComputed';
    value: unknown;
    debugName?: string;
    fields?: string[];
  } | null): void;
}

type SelectorObserver = <T extends Record<string, any>, R>(
  data: Readonly<T>, selector: (data: Readonly<T>) => R
) => { value: R; fields?: string[] };
```

每个已注册实例暴露拉取式读取接口（`getFields`、`getDependencyGraph`、`getSnapshot`），
外加用于已提交变更的 `subscribe`，以及可选的 `subscribeSnapshot`，
用于校验、dirty 与错误状态更新。旧实例没有 `subscribeSnapshot` 时，
agent 仍会在已提交变更后刷新。注销或释放时移除两种订阅。
扩展的 page-agent 实现全局 hook。DevTools 入口注册时同时提供 model 对象，
agent 通过 WeakMap 关联模型身份；该对象不进入扩展消息。
同一页面的多个模块副本（包含 ESM 和 CommonJS）共享实例 ID 分配。
注册失败会释放已建立的订阅和身份关联；释放一个模型不会注销另一个模型。
两个 React 派生 Hook 在提交后的 effect 中直接调用 `updateDerived`，
每个 Hook 使用独立 token，`selection: null` 表示卸载或切换模型后的移除通知。
旧版 hook 没有该方法时跳过上报；未注册或已注销模型的上报由 agent 忽略。

hook 支持 `getDerivedObserver` 时，包装层在注册实例上提供可选的 `observeSelector`
能力，agent 只为已注册模型返回该能力。包装层内部缓存浅层 Proxy，每份底层快照
对应一个公开的 `data` 对象：Hook 输入、`model.data` 和 `model.subscribe` 输入
共享同一引用，嵌套值和冻结的属性描述符保持不变。没有此能力时（包括旧版 hook），
包装层沿用原始快照。Proxy 用于页面内观测，原生结构化克隆不支持 Proxy；
直接使用 `structuredClone` 或 `postMessage` 时应先复制快照。

React 在原有 selector 求值点调用 observer，不为调试额外求值。采集同步进行，
通过 `try/finally` 限定作用域，selector 异常正常传播。只有已提交的 selector
缓存会安装依赖更新监听，因此试探性渲染的 selector 无法发布结果。当读取依赖
改变且结果与已提交结果相等时，监听器使用保留的已提交值上报新依赖，无需重渲染
或重新订阅。新结果和依赖 props 的 selector 在 React 提交后发布。
枚举、延迟读取等采集边界见 [React 绑定](REACT_CN.md#devtools-派生值)。

派生值及实例编号统一由 page-agent 管理，不在 model 或库侧另建注册表。
agent 将列表附加到发送给面板的快照：
`derivedValues: { id, kind, debugName?, fields?, value }[]`，复用已有快照调度和重连同步。
注销模型时释放列表；不提供 model 身份的旧版注册不提供 `derivedValues`，面板显示不可用提示。
上报仅传递已得到的结果和观测到的顶层模型依赖，不传递 selector。
observer 采集去重后的字符串键，包括数字属性名。面板叠加派生节点和连线，不修改 schema 图；
未知字段会被忽略，同一来源只生成一条箭头。

依赖图由 schema 经一个共享原语 [`eachReactionEdge`](../src/reaction/reaction-graph.ts) 推导，它是
「如何把 `reaction.fields` 读成边」的唯一定义处。核心的 reaction 调度器（`collectReactions`）
使用同一个原语，且有一个锁定测试
（[reaction-graph.test.ts](../src/__tests__/reaction-graph.test.ts)）断言：原语、运行时索引、
DevTools 图在覆盖的 Schema 中一致。图的 Schema 部分表达声明的计算依赖，
React 观测再叠加采集到的输入；二者均不推断 action 闭包读写或实时执行状态。
每个已注册模型只构建一次字段元数据，依赖图直接从同一份依赖列表投影，
后续读取复用这两个结构。
字段元数据循环同时提供可选 `actions` 元数据：
`{ reactionIndex, actionIndex, name, functionId }[]`，为空时省略。
`functionId` 在每个已注册模型内按函数引用分配，可经 JSON 传输。面板把同一 ID 的
声明合并为一个 action 节点，包括同一字段中重复引用的函数。旧版元数据缺少 ID 时，
各声明保持独立，不按函数名猜测是否共享。
这些声明不暴露候选、版本、屏障或执行状态；action 节点及虚线属于独立展示层，
不改变计算图的节点或计算依赖边。

## 未安装 hook 时的行为

核心入口（`model-reaction`）不引用 DevTools 集成代码。若通过 `model-reaction/devtools`
启用但未安装 hook，`createModel` 只会常量时间查询
`globalThis.__MODEL_REACTION_DEVTOOLS_HOOK__`，随后直接返回，不创建实例描述、
不包装 `data`，也不建立订阅。

React selector Hooks 包含可选 observer 查询、标签查询和提交/清理上报检查，
这些是少量运行成本，并非零开销。上报方法不存在时，不读取 selector 源码或创建
agent 记录；方法存在时，agent 忽略未注册模型。观测不增加模型订阅或 selector
求值，注册表由 page-agent 持有，不进入库或核心状态。

## 已知限制

- **写回式时间旅行（write-back time-travel）**。时间线为**只读**。把旧值回放进模型会
  重新触发 reaction，并可能污染 `dirtyData`（库刻意不提供 `resetDirty` —— 见
  AGENTS.md §5），因此扩展不提供恢复操作。
- **可配置的上限**。时间线环形缓冲区大小，以及值序列化的深度 / 宽度 /
  字符串 / 节点 / 字节上限均使用固定默认值。预算按快照或时间线中的单个值计算，
  不限制跨全部模型聚合的 `init` 消息或 schema 元数据。
- **多帧 / 跨域 iframe**。agent 仅注入到顶层帧。
