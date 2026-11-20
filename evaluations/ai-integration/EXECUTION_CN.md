# 运行 AI 接入评测

[English](EXECUTION.md) | 中文

任务与计分契约见 [基线](README_CN.md)。本运行器评估独立消费项目中的
Codex CLI 接入实现，未调用库测试充当 agent 成绩。

框架与 [结果摘要](SUMMARY_CN.md)入库；`runs/` 的报告、包、日志和会话取证由
Git 忽略，不随克隆交付。以下命令会为新实验生成这些本地产物。

从仓库根目录执行：

```bash
node evaluations/ai-integration/lib/environment.mjs
node evaluations/ai-integration/calibrate.mjs
node evaluations/ai-integration/preflight.mjs
node evaluations/ai-integration/freeze.mjs
node evaluations/ai-integration/run.mjs AI-01 all
```

对 AI-01 至 AI-12 分别执行最后一行，每项 `all` 表示三次全新上下文。
也可用 `1`、`2`、`3` 指定重复编号。已有 `result.json` 的尝试不会重复运行；
发现没有最终结果的同名项目时会停下，要求评测者核查原始记录，避免静默重采样。

完成全部尝试后，逐份复核交付代码与诊断，将人工复核记录保存为
`runs/baseline-v1/review.json`，再执行：

```bash
node evaluations/ai-integration/report.mjs
```

该命令检查冻结文件、提示、源码快照与会话独立性，生成 `RESULTS.json`、
`REPORT_CN.md` 和 `REPORT.md`。Token 使用每次尝试最后阶段的会话累计值，
不累加修复前后的累计计数。报告脚本与人工复核独立于已冻结的评分器，
不会重新评分或改变原始结果。若人工复核发现已规定的接入约束被自动检查漏报，
原 `result.json` 保留；裁决与剩余修复阶段写入 `reviewed-result.json`，报告优先读取后者。
本轮 AI-05-r1 的隐式 `any` 按此方式处理，没有增加重复样本或突破两轮修复预算。

`review-types.mjs` 使用 TypeScript 检查器记录公开值导出的推导类型；
`continue-reviewed.mjs` 在原会话、原权限和原验收器下反馈该约束诊断。
这是对既有人工复核规则的辅助取证，正式采样后才添加，必须在报告中披露。
运行时使用的初始检查器源码保存在 `runs/baseline-v1/review-tool-sources/`；
后续全量检查排除了没有运行时值的类型导出，避免把接口本身误报为 `any`。

已有实测证据时不要在同一输出目录重跑环境准备、校准或冻结。新实验应使用新的
输出目录，并传给各命令；`run.mjs` 的目录参数位于重复编号之后。

需要已认证的 Codex CLI、Node、npm、pnpm，以及 CLI 对 named filesystem
permission profiles 的支持。首轮固定版本见 `runs/baseline-v1/manifest.json`。
CLI 模型别名固定为 `gpt-6-luna`，推理配置为 `medium`；服务商没有暴露不可变模型
快照，报告必须保留这个复现限制。

`environment.mjs` 构建当前 checkout 的包并安装 tarball。准备完成后须核对
`environment.json.source_commit` 是否是基线提交；更换源码属于另一次实验。
消费项目、CLI 会话和 node_modules 位于独立临时目录；报告和取证保存在本目录
`runs/baseline-v1/`。每个消费项目使用相同锁文件和只读工具链，不映射到库源码。

`calibrate.mjs` 对 12 份参考实现执行相同的类型、运行与静态约束检查。
`preflight.mjs` 实际验证工具可写源码、可编译、不可读取仓库/参考解、不可修改固定
文件及 node_modules、不可访问外网，并验证修复轮可恢复同一会话。
它不计入 36 次业务评测。macOS 使用 CLI 原生权限策略，避免叠加两个 Seatbelt
沙箱使工具无法启动；没有使用 full-access 或跳过沙箱的选项。

每次 agent 首次交付后冻结 `src/`，运行隐藏验收。失败仅反馈原始编译/断言诊断，
至多修复两轮；隐藏类型断言及其编译产物在修复前移除。任务提示仅从中文版基线的
公共提示与“任务提示”抽取，并附上公开 starter 接口，不含验收或典型误用。

文件职责：

| 路径 | 内容 |
| --- | --- |
| `lib/tasks.mjs`、`fixtures/` | 公共 starter、服务接口、提示提取 |
| `references/` | 评测者参考实现，不给被测 agent |
| `checks/` | 隐藏类型、核心行为、实际 React 挂载验收 |
| `lib/grader.mjs` | 固定文件与静态约束检查、编译和验收编排 |
| `lib/agent.mjs` | 权限、会话、预算、原始事件与 token 记录 |
| `run.mjs` | 独立尝试及两轮诊断修复 |
| `report.mjs` | 校验取证完整性，汇总指标并生成双语报告 |
| `review-types.mjs`、`continue-reviewed.mjs` | 人工类型复核证据与原会话内剩余诊断修复 |
| `runs/*/manifest.json` | 版本、包、提示、fixture、检查和配置指纹 |
| `runs/*/review.json` | 人工复核、失败归因、覆盖边界与后续建议 |
| `runs/*/attempts/*/stage-*` | 每轮提交、原始事件、编译/运行诊断 |

自动静态检查覆盖常见类型逃逸、非公开导入和异步/有副作用 computed；
纯函数、正常库能力使用及迁移说明仍需结合提交代码复核，不能仅凭 PASS 日志作结。
测试用可控 Promise 作为服务 barrier；AI-04 用虚拟时钟推进 10ms 防抖。
20 秒验收 watchdog 仅用于暴露未到达的 barrier，不作为异步完成的证明。
