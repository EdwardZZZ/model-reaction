# 运行 AI 接入评测

[English](EXECUTION.md) | 中文

任务与计分契约见 [基线](README_CN.md)。本运行器评估独立消费项目中的
Codex CLI 接入实现，未调用库测试充当 agent 成绩。

框架与 [结果摘要](SUMMARY_CN.md)入库；`runs/` 的报告、包、日志和会话取证由
Git 忽略，不随克隆交付。以下命令生成新的历史目标实验产物；
这些修复不会重跑或改写原实测结果与 SUMMARY 数字。

## 历史目标

冻结的 v1 参考解针对本地版本 **1.2.0**，源码提交
`8678594c9f0b6f828d97258f6b01a4aaf0f785fa`，不是 npm 同版本或当前 2.0 API。
从当前仓库根目录创建独立源码 checkout，并选择全新输出目录。
准备前须单独安装历史 checkout 的构建依赖；准备步骤会构建、打包并安装消费工具链。
以下是操作者命令，不属于后文的离线回归探针：

```bash
SOURCE=/tmp/model-reaction-v1-source
OUT="$PWD/evaluations/ai-integration/runs/reproduction-v1-20261127"
git worktree add --detach "$SOURCE" 8678594c9f0b6f828d97258f6b01a4aaf0f785fa
pnpm --dir "$SOURCE" install --frozen-lockfile
node evaluations/ai-integration/lib/environment.mjs "$OUT" "$SOURCE"
node evaluations/ai-integration/calibrate.mjs "$OUT"
node evaluations/ai-integration/preflight.mjs "$OUT"
node evaluations/ai-integration/freeze.mjs "$OUT"
node evaluations/ai-integration/run.mjs AI-01 all "$OUT"
```

`prepare(output, sourceRepo = repo)` 在创建输出、构建或安装之前拒绝非 1.2.0 包，
因此默认使用当前 checkout 会立即失败。版本号不足以确认目标：采样前仍需核对
`source_commit`、`source.diff` 和全部 12 份校准结果。当前 API 评测需另立版本，
不能原地修改这些 v1 参考解。

对 AI-01 至 AI-12 分别执行最后一行，每项 `all` 表示三次全新上下文。
也可用 `1`、`2`、`3` 指定重复编号。已有 `result.json` 的尝试不会重复运行；
发现没有最终结果的同名项目时会停下，要求评测者核查原始记录，避免静默重采样。

完成全部尝试后，逐份复核交付代码与诊断，将人工复核记录保存为
`$OUT/review.json`，再执行：

```bash
node evaluations/ai-integration/report.mjs "$OUT"
```

该命令检查冻结文件、提示、源码快照与会话独立性，生成 `RESULTS.json`、
`REPORT_CN.md` 和 `REPORT.md`。Token 使用每次尝试最后阶段的会话累计值，
不累加修复前后的累计计数。报告断言初始/最终状态与首末阶段一致，并拒绝覆盖已有报告。
运行器已有改动；历史检查、fixture、任务验收、参考解和分数不变，
不会重新评分或改变原始结果。若人工复核发现已规定的接入约束被自动检查漏报，
原 `result.json` 保留；裁决与剩余修复阶段写入 `reviewed-result.json`，报告优先读取后者。
本轮 AI-05-r1 的隐式 `any` 按此方式处理，没有增加重复样本或突破两轮修复预算。

`review-types.mjs` 现在在评分沙箱中用可信工具链 TypeScript 记录公开值导出的推导类型；
`continue-reviewed.mjs` 在原会话、原 agent 权限和当前评分边界下反馈约束诊断。
人工拒绝后即使修复预算已耗尽，最终状态仍为 FAIL。历史人工复核辅助取证是在
正式采样后添加的，应与本次隔离/状态修复分别披露。
运行时使用的初始检查器源码保存在 `runs/baseline-v1/review-tool-sources/`；
后续全量检查排除了没有运行时值的类型导出，避免把接口本身误报为 `any`。

已有实测证据时不要在同一输出目录重跑环境准备、校准或冻结。新实验应使用新的
输出目录，并传给各命令；`run.mjs` 的目录参数位于重复编号之后。

需要 Node、npm、pnpm，以及 Codex CLI 对原生 named filesystem permission
profiles 的支持。评分和离线探针不需要认证或 AI 调用；agent 预检与采样需要认证。
首轮固定版本见 `runs/baseline-v1/manifest.json`。
CLI 模型别名固定为 `gpt-6-luna`，推理配置为 `medium`；服务商没有暴露不可变模型
快照，报告必须保留这个复现限制。

`environment.mjs` 构建显式选择的历史 checkout 并安装 tarball，记录真实包版本和
npm pack 文件名；项目创建与报告使用 `tarball_name`。旧清单没有该字段时根据
`package_version` 推导 `model-reaction-${package_version}.tgz`，版本字段也缺失
则使用历史 1.2.0。准备完成后须核对
`environment.json.source_commit` 是否是基线提交；更换源码属于另一次实验。
消费项目、CLI 会话和 node_modules 位于独立临时目录；报告和取证保存在本目录
指定的输出目录。每个消费项目使用相同锁文件和只读工具链，不映射到库源码。

`calibrate.mjs` 对 12 份参考实现执行相同的类型、运行与静态约束检查。
`preflight.mjs` 实际验证工具可写源码、可编译、不可读取仓库/参考解、不可修改固定
文件及 node_modules、不可访问外网，并验证修复轮可恢复同一会话。
它不计入 36 次业务评测。agent 预检会实际调用 AI 和发起网络拒绝探针，
不是下文的离线脚本。

## 评分边界

全部约束、语义检查、编译（120 秒）和验收（25 秒）在独立的 macOS 原生
`codex sandbox -P evaluation` worker 中执行，不调用 AI。父进程限制总耗时
180 秒、输出 8 MiB，终止进程组，并自行写入证据；不存在普通宿主执行回退。

策略默认拒绝文件访问，只授权规范化的项目目录可写（固定文件只读）、已核实的工具链与 suite
`lib/`、`checks/` 只读，以及启动所需的 Node 可执行文件、系统库和设备。
拒绝指向工具链之外的依赖符号链接。清理环境变量并创建全新本地 home，CLI 在
提交与仓库之外解析权限配置，避免继承凭据和配置；网络关闭。
接触提交源码前，worker 检查允许访问、外部/参考解读取拒绝、符号链接逃逸拒绝、
外部/工具链写入拒绝和环境清理。启动/探针失败在编译或运行提交前记 BLOCKED，
将原始退出码、信号和 stderr 写入 `sandbox.json`。不可通过扩大权限或绕过环境控制启动。

检查与提交共享运行时，且可以在 worker 内读取：**并非隐藏检查，也不能证明能抵御
恶意篡改**。此边界保护宿主文件系统、环境和网络访问，不保证恶意提交下的评分完整性。
历史评分使用普通宿主子进程；此前 agent 权限探针不能验证新的评分边界。

## 离线验证

```bash
node evaluations/ai-integration/probe-offline.mjs /tmp/model-reaction_audit_20261127
```

此有界脚本新建取证子目录，复用本地 TypeScript，验证最终状态/报告拒绝、提前
拒绝不兼容目标、tarball 传递和合成标记读取拒绝；不构建、不安装、不调用 agent 或网络。
退出码 0 表示回归断言通过，包括沙箱不可用时的封闭失败行为；必须检查明确的
sandbox 状态，才能声称隔离已验证。

在当前注入式执行环境中，原生 CLI 无法启动 Node，退出码为 71：
`sandbox-exec: execvp() ... failed: Operation not permitted`。
此前直接调用严格 Seatbelt 的探针也失败过（包括 SIGABRT），均未绕过。
当前仍未验证原生沙箱内编译/运行成功和实际网络拒绝；记录的策略已关闭网络。
须在支持的宿主上通过能力探针和全部参考解后，才能采样。

每次 agent 首次交付后冻结 `src/`，运行评测验收。失败仅反馈原始编译/断言诊断，
至多修复两轮；评测类型断言及其编译产物在修复前移除。任务提示仅从中文版基线的
公共提示与“任务提示”抽取，并附上公开 starter 接口，不含验收或典型误用。

文件职责：

| 路径 | 内容 |
| --- | --- |
| `lib/tasks.mjs`、`fixtures/` | 公共 starter、服务接口、提示提取 |
| `references/` | 评测者参考实现，不给被测 agent |
| `checks/` | 冻结的类型、核心行为与实际 React 挂载验收 |
| `lib/grader.mjs` | 项目创建、父进程取证与 worker 编排 |
| `lib/sandbox.mjs`、`lib/worker.mjs`、`lib/semantic.mjs` | 原生边界、受限评分与语义检查 |
| `lib/agent.mjs` | 权限、会话、预算、原始事件与 token 记录 |
| `run.mjs` | 独立尝试及两轮诊断修复 |
| `report.mjs` | 校验取证完整性，汇总指标并生成双语报告 |
| `probe-offline.mjs` | 离线回归和原生标记访问拒绝探针 |
| `review-types.mjs`、`continue-reviewed.mjs` | 人工类型复核证据与原会话内剩余诊断修复 |
| `runs/*/manifest.json` | 版本、包、提示、fixture、检查和配置指纹 |
| `runs/*/review.json` | 人工复核、失败归因、覆盖边界与后续建议 |
| `runs/*/attempts/*/stage-*` | 每轮提交、原始事件、编译/运行诊断 |

自动静态检查覆盖常见类型逃逸、非公开导入和异步/有副作用 computed；
纯函数、正常库能力使用及迁移说明仍需结合提交代码复核，不能仅凭 PASS 日志作结。
测试用可控 Promise 作为服务 barrier；AI-04 用虚拟时钟推进 10ms 防抖。
20 秒验收 watchdog 仅用于暴露未到达的 barrier，不作为异步完成的证明。
