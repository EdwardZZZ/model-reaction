# DevTools

一个用于在运行时检视 `model-reaction` 模型的浏览器扩展：实时数据树、字段依赖关系图，以及变更时间线。

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
- [不存在时零开销](#不存在时零开销)
- [已知限制](#已知限制)

---

## 能得到什么

安装扩展并打开其面板后，通过 `model-reaction/devtools` 入口创建的模型会出现在
浏览器 DevTools 的 **Model Reaction** 标签页中，面板包含三个视图：

1. **数据树（Data Tree）** —— 模型的三个层次，均可折叠：
   - `data` —— 已提交的数据源（schema 默认值会未经校验直接写入）
   - `dirtyData` —— 每个字段最近一次校验失败的输入
   - `errors` —— 每个字段当前的校验错误
2. **依赖关系（Dependencies）** —— reaction 依赖关系图。实线箭头**从依赖字段指向
   由 reaction 计算出的字段**（读作「`from` 供给 `to`」）。只被一个字段使用的 action
   在宿主模块内部展示，用虚线连接。同一函数引用只展示一个 action 节点；多个字段
   共用时，节点放在字段模块右侧，标注 `shared · N fields`，各声明字段的虚线汇入
   这个节点。同名但引用不同的函数仍分别展示。具名 action 显示函数名，匿名 action 保留
   `r0 · action[下标]` 标签。虚线表示归属与计算落定后的执行，
   不表示闭包读写依赖，也不要求宿主值变化；下标表示声明位置，提示文字列出全部声明。
   悬停字段会高亮其相关边；悬停共享 action 会高亮全部声明字段及其汇入的虚线。
   字段按依赖层次从上到下排列，同层保留 schema 顺序并对齐；
   每增加一级依赖就向右移动一列，计算箭头从源字段块右侧连接到目标字段块左侧。
   字段数量增加时沿纵向展开，图宽随依赖深度增加；共享 action 占用独立列。
   每个字段只为模块内展示的 action 预留高度，共享 action 不在声明字段中留下空行。
3. **时间线（Timeline）** —— 按时间倒序排列的字段提交变更列表。选中某一项会并排显示该
   字段此刻的值与其上一个值。

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
panel           （React UI：数据树 · 依赖关系图 · 时间线）
```

按需开启的包装入口和内部 hook 契约统一位于
[src/devtools.ts](../src/devtools.ts)，该文件只导出 `createModel`；扩展位于
[packages/devtools](../../devtools)。包根（`model-reaction`）不引用 DevTools
集成代码。

## 在应用中启用

只需切换 import，其它不变。`model-reaction/devtools` 导出的 `createModel` 与包根的那个
签名、行为完全一致，只是在检测到 hook 时额外注册到 DevTools。

```ts
// import { createModel } from 'model-reaction';
import { createModel } from 'model-reaction/devtools';

const model = createModel(schema); // 现在会出现在面板中
```

未安装扩展时，包装层只查询一次全局 hook，然后返回未注册、未订阅的模型。若希望生产包
完全移除集成代码，可在生产构建配置中把 `model-reaction/devtools` alias 到
`model-reaction`。

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
页面中继断线后会重连；面板断线后每隔 250 ms 重试，主动关闭面板会取消重连。
任一侧重新连接都会重新同步当前实例、快照和页面 agent 保留的时间线，
以恢复断线期间遗漏的状态更新。后台 worker 无需保存或重放消息。
若重新加载或更新扩展导致页面的扩展上下文失效，需要刷新被检查的页面并重新打开 DevTools。

## 使用面板

- 如果一个页面承载了**多个**模型，面板头部会出现实例选择器，可切换检视对象。
  选择属于面板本地状态，选中的实例消失后会回退到仍存在的实例。
- `NaN`、`Infinity`、`-Infinity` 和 `-0` 通过显式 number 标记经过 JSON 传输，
  数据树保留其显示，不会被变成 null 或零；普通有限数继续使用 primitive 表示。
- **时间线**由环形缓冲区限制大小（默认每个实例 100 条），因此长时间运行、变更频繁的
  页面也不会无限占用内存。
- 被拒输入、校验完成、dirty 清理和 reaction 错误都会自动刷新数据树。
  同步通知共用一次排队的快照刷新，只有已提交的字段变更进入时间线。
- 每份快照的 `data`、`dirtyData` 和 `errors` 共享 2,000 个节点和保守的
  256 KiB UTF-8 JSON 字节预算；时间线中的每个值拥有独立预算。
  默认深度上限为 6，每个容器或 record 最多 100 项，字符串前缀最多 10,000 个字符。
- 预算耗尽后停止遍历并显示截断标记；值、字段或错误被省略或裁剪时，
  面板显示快照截断提示。兄弟分支中的共享对象仍可读取，真正的循环引用会被标记。

## DevTools Hook 契约

`model-reaction/devtools` 入口通过一个全局对象与扩展通信。它是一条**私有的、仅用于开发期
的通道** —— **不**属于公开的 `ModelReturn` API，也不会从包根重新导出。参见 AGENTS.md §5：
库刻意不提供 `model.describe()` 这类内省方法，而本 hook 并不改变这一约定。包装层只通过模型
的公共 API（`data` / `getDirtyData()` / `validationErrors` / `on`）以及它收到的 schema 来
读取模型 —— 无需访问 `ModelManager` 的任何内部。

内部契约定义（见 [src/devtools.ts](../src/devtools.ts)）：

```ts
interface ModelReactionDevtoolsHook {
  register(instance: DevtoolsModelInstance): void;
  unregister(id: number): void;
}
```

每个已注册实例暴露拉取式读取接口（`getFields`、`getDependencyGraph`、`getSnapshot`），
外加用于已提交变更的 `subscribe`，以及可选的 `subscribeSnapshot`，
用于校验、dirty 与错误状态更新。旧实例没有 `subscribeSnapshot` 时，
agent 仍会在已提交变更后刷新。注销或释放时移除两种订阅。
扩展的页面 agent 实现该 hook，DevTools 入口负责消费它。

依赖图由 schema 经一个共享原语 [`eachReactionEdge`](../src/reaction/reaction-graph.ts) 推导，它是
「如何把 `reaction.fields` 读成边」的唯一定义处。核心的 reaction 调度器（`collectReactions`）
使用同一个原语，且有一个锁定测试
（[reaction-graph.test.ts](../src/__tests__/reaction-graph.test.ts)）断言：原语、运行时索引、
DevTools 图在覆盖的 Schema 中一致。图只表达声明的计算依赖，不代表 action 闭包
读写或实时执行状态。
每个已注册模型只构建一次字段元数据，依赖图直接从同一份依赖列表投影，
后续读取复用这两个结构。
字段元数据循环同时提供可选 `actions` 元数据：
`{ reactionIndex, actionIndex, name, functionId }[]`，为空时省略。
`functionId` 在每个已注册模型内按函数引用分配，可经 JSON 传输。面板把同一 ID 的
声明合并为一个 action 节点，包括同一字段中重复引用的函数。旧版元数据缺少 ID 时，
各声明保持独立，不按函数名猜测是否共享。
这些声明不暴露候选、版本、屏障或执行状态；action 节点及虚线属于独立展示层，
不改变计算图的节点或计算依赖边。

## 不存在时零开销

若从包根（`model-reaction`）导入，这些代码根本不会被打包。若通过 `model-reaction/devtools`
开启但未安装 hook（例如生产环境没装扩展），`createModel` 只会常量时间查询
`globalThis.__MODEL_REACTION_DEVTOOLS_HOOK__`，随后直接返回，不创建实例描述，也不建立订阅。

## 已知限制

- **写回式时间旅行（write-back time-travel）**。时间线为**只读**。把旧值回放进模型会
  重新触发 reaction，并可能污染 `dirtyData`（库刻意不提供 `resetDirty` —— 见
  AGENTS.md §5），因此扩展不提供恢复操作。
- **可配置的上限**。时间线环形缓冲区大小，以及值序列化的深度 / 宽度 /
  字符串 / 节点 / 字节上限均使用固定默认值。预算按快照或时间线中的单个值计算，
  不限制跨全部模型聚合的 `init` 消息或 schema 元数据。
- **多帧 / 跨域 iframe**。agent 仅注入到顶层帧。
