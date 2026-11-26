# 示例

[English Version](README.md) | 中文 | [文档导航](../docs/README_CN.md)

## 可运行示例

所有命令都在仓库根目录执行。

| 示例 | 内容 | 命令 |
| --- | --- | --- |
| [基本使用](basic-usage.ts) | 创建、写入与校验 | `pnpm --filter model-reaction run example:basic` |
| [Reaction](reaction-system.ts) | 依赖计算与 action | `pnpm --filter model-reaction run example:reaction` |
| [异步校验](async-validation.ts) | 模拟远端查重 | `pnpm --filter model-reaction run example:async` |
| [事件](event-listening.ts) | 字段变更与校验事件 | `pnpm --filter model-reaction run example:event` |
| [复杂表单](complex-form.ts) | 跨字段规则与错误 | `pnpm --filter model-reaction run example:complex` |
| [脏数据](dirty-data-conditional.ts) | 被拒输入与条件规则 | `pnpm --filter model-reaction run example:dirty` |
| [深层依赖链](multi-record-deep-deps.ts) | 100 条记录、五层计算 | `pnpm --filter model-reaction run example:multi-record` |
| [Schema 组合](schema-composition/runner.ts) | 精确枚举、独立默认值、顶层替换；[Recipe](SCHEMA_COMPOSITION_CN.md) | `pnpm --filter model-reaction run example:schema` |
| [React 绑定](react-bindings.tsx) | 字段、selector、draft 与所有权 | `pnpm --filter model-reaction run example:react` |
| [按需扩展字段元数据](react-field-meta.tsx) | 派生 UI 属性，并把 `setMeta` 传给业务函数 | `pnpm --filter model-reaction run example:react` |

React 命令执行独立的 [SSR runner](react-bindings-runner.tsx)；导入组件文件不会运行它。
元数据示例通过开关控制配送选项的显示和可用状态；runner 验证可编辑、禁用与隐藏
三种状态。限制按钮把 `setMeta` 传给组件外的业务函数。

## 参考场景

| 主题 | 参考 |
| --- | --- |
| 稳定与内联 selector | [稳定 selector](react-best-practices/7-2-stable-selector.tsx)、[computed selector](react-best-practices/7-2bis-model-computed.tsx) |
| Provider 与已提交值控件 | [Provider](react-best-practices/7-3-model-provider.tsx)、[Field](react-best-practices/7-4-field-render-prop.tsx) |
| 错误展示、提交与清理 | [Touched](react-best-practices/7-5-touched.tsx)、[提交](react-best-practices/7-6-submission-flow.tsx)、[生命周期](react-best-practices/7-8-lifecycle.tsx) |
| 应用 store | [zustand](react-best-practices/7-10-2-with-zustand.tsx)、[Redux](react-best-practices/7-10-3-with-redux.tsx)、[对比](react-best-practices/7-10-5-cheat-sheet.ts) |
| 广告创编 | [Schema 组合、提审 DTO 与草稿恢复](AD_CREATION_CN.md) |

这些文件为参考模式，不是独立 CLI 程序。模块级模型 fixture 为简洁省略了所有权
配置，应用中需采用 [owner 生命周期](../docs/REACT_CN.md#react-中的-model-生命周期)。
React 契约统一见 [REACT_CN.md](../docs/REACT_CN.md)，store 集成见
[COMPARISON_CN.md](../docs/COMPARISON_CN.md)。

## 验证

示例从公开包入口导入。仓库 runner 通过 `tsconfig.examples.json` 映射到源码；
复制到应用后使用已安装的包。

`pnpm --filter model-reaction run typecheck` 检查源码、测试和独立的示例项目；
lint 包含 `.ts` / `.tsx` 示例。三份可选 store 片段（`7-10-2`、`7-10-3`、`7-10-5`）
及聚合 `index.ts` 不纳入示例类型检查，因为没有安装对应依赖和应用接入代码。
Markdown 场景不在该检查范围内。
