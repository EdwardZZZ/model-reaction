# DevTools

一个用于在运行时检视 `model-reaction` 模型的浏览器扩展：实时数据树、字段依赖关系图，以及变更时间线。

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
- [已知限制（TBD）](#已知限制tbd)

---

## 能得到什么

安装扩展并打开其面板后，任何调用 `createModel(...)` 创建模型的页面都会在浏览器
DevTools 中出现一个 **Model Reaction** 标签页，包含三个视图：

1. **数据树（Data Tree）** —— 模型的三个层次，均可折叠：
   - `data` —— 已通过校验的数据源（source of truth）
   - `dirtyData` —— 每个字段最近一次校验失败的输入
   - `errors` —— 每个字段当前的校验错误
2. **依赖关系（Dependencies）** —— reaction 依赖关系图。每个节点是一个字段；每条箭头
   **从依赖字段指向由 reaction 计算出的字段**（读作「`from` 供给 `to`」）。悬停节点会
   高亮其相关边。
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

按需开启的包装入口见 [src/devtools.ts](../src/devtools.ts)，其使用的 hook 契约见
[src/devtools-hook.ts](../src/devtools-hook.ts)；扩展整体位于 [devtools/](../../devtools)
目录下。包根（`model-reaction`）**不引用**其中任何代码，因此从不开启的应用打包里没有任何
DevTools 代码。

## 在应用中启用

只需切换 import，其它不变。`model-reaction/devtools` 导出的 `createModel` 与包根的那个
签名、行为完全一致，只是在检测到 hook 时额外注册到 DevTools。

```ts
// import { createModel } from 'model-reaction';
import { createModel } from 'model-reaction/devtools';

const model = createModel(schema); // 现在会出现在面板中
```

未安装扩展时，包装层只做一次属性读取便原样返回模型 —— 不注册、不订阅。常见做法是按构建
环境切换，让生产环境永不使用它：

```ts
import { createModel } from
  process.env.NODE_ENV === 'development' ? 'model-reaction/devtools' : 'model-reaction';
```

## 构建扩展

扩展是 `devtools/` 下一个自包含的子包，不影响库自身的构建。

```bash
cd devtools
node build.mjs
```

该命令会把四个扩展执行环境（页面 agent、content 中继、background worker、React 面板）
打包进 `devtools/dist/`，并连同静态资源（`manifest.json`、`devtools.html`、
`panel.html`、`panel.css`）一起复制过去。

## 在 Chrome 中加载

1. 打开 `chrome://extensions`。
2. 打开右上角的 **开发者模式（Developer mode）**。
3. 点击 **加载已解压的扩展程序（Load unpacked）**，选择 `devtools/dist` 目录。
4. 在任意使用 `model-reaction` 的页面打开 DevTools，选择 **Model Reaction** 标签页。

> 面板在打开时会主动拉取当前状态，因此即使模型在面板打开之前就已创建，也能正常显示。

## 使用面板

- 如果一个页面承载了**多个**模型，面板头部会出现实例选择器，可切换检视对象。
- **时间线**由环形缓冲区限制大小（默认每个实例 100 条），因此长时间运行、变更频繁的
  页面也不会无限占用内存。
- 数据树中的大对象会被保守截断（限制深度、宽度与字符串长度），避免超大数据卡死面板。

## DevTools Hook 契约

`model-reaction/devtools` 入口通过一个全局对象与扩展通信。它是一条**私有的、仅用于开发期
的通道** —— **不**属于公开的 `ModelReturn` API，也不会从包根重新导出。参见 AGENTS.md §5：
库刻意不提供 `model.describe()` 这类内省方法，而本 hook 并不改变这一约定。包装层只通过模型
的公共 API（`data` / `getDirtyData()` / `validationErrors` / `on`）以及它收到的 schema 来
读取模型 —— 无需访问 `ModelManager` 的任何内部。

契约定义（见 [src/devtools-hook.ts](../src/devtools-hook.ts)）：

```ts
interface ModelReactionDevtoolsHook {
  register(instance: DevtoolsModelInstance): void;
  unregister(id: number): void;
}
```

每个已注册实例暴露拉取式读取接口（`getFields`、`getDependencyGraph`、`getSnapshot`），
外加一个推送式的 `subscribe` 用于变更时间线。扩展的页面 agent 实现该 hook；DevTools 入口
只负责**消费**它。

依赖图由 schema 经一个共享原语 [`eachReactionEdge`](../src/reaction-graph.ts) 推导，它是
「如何把 `reaction.fields` 读成边」的唯一定义处。核心的 reaction 调度器（`collectReactions`）
使用同一个原语，且有一个锁定测试
（[reaction-graph.test.ts](../src/__tests__/reaction-graph.test.ts)）断言：原语、运行时索引、
DevTools 图三者一致 —— 因此面板永远不会显示与运行时行为不符的依赖图。

## 不存在时零开销

若从包根（`model-reaction`）导入，这些代码根本不会被打包。若通过 `model-reaction/devtools`
开启但未安装 hook（例如生产环境没装扩展），`createModel` 只做一次属性读取
（`globalThis.__MODEL_REACTION_DEVTOOLS_HOOK__`），发现为空后原样返回模型 —— 不创建实例
对象，不建立订阅。除非你正在主动调试，否则 DevTools 集成几乎零成本。

## 已知限制（TBD）

以下为刻意推迟、标注为 TBD 的项：

- **写回式时间旅行（write-back time-travel）**。时间线为**只读**。把旧值回放进模型会
  重新触发 reaction，并可能污染 `dirtyData`（库刻意不提供 `resetDirty` —— 见
  AGENTS.md §5），因此暂未实现「恢复此值」。
- **可配置的上限**。时间线环形缓冲区大小，以及值序列化的深度 / 宽度 / 字符串上限均使用
  固定默认值；将它们暴露为用户设置的能力暂缓。
- **多帧 / 跨域 iframe**。agent 仅注入到顶层帧。
