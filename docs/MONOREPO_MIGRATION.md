# PRD：拆分为 pnpm Monorepo（经典 packages/\*）

> 状态：待确认（本文件为方案，非执行记录）。确认后按「分阶段执行」小节推进。
> 决策前提：pnpm workspaces + 经典 `packages/*`（库本体也挪出根目录）。

---

## 1. 目标与非目标

**目标**
- 把当前「库在根 + devtools 寄居子目录 + examples 教学片段」重构为三包 monorepo：
  1. `packages/model-reaction` —— 核心库（现 `src/` 全量迁入，发布物不变）。
  2. `packages/devtools` —— 浏览器扩展（现 `devtools/` 迁入）。
  3. `packages/demo` —— **新建** 的 Vite + React 应用，演示库 + devtools。
- 用 pnpm workspace 统一依赖与脚本；CI 统一覆盖三包。
- 迁移**不改任何库/扩展的运行时行为**，纯结构调整。

**非目标（明确排除）**
- 不改库的公开 API、不改 devtools 协议、不改扩展功能。
- 本次迁移不实际执行 npm 发布动作，但**保留库独立发布能力**（`packages/model-reaction` 保留 `publishConfig`/`files`/`exports`，发布物零回归）。
- demo 与 devtools 均 `private:true`，**不发布、不部署**。
- 不引入 Turborepo/Nx 等构建编排（暂用 pnpm 递归脚本；见 TBD-1）。

---

## 2. 目标目录结构

```
model-reaction/                      # workspace 根（不再是库本体）
├── pnpm-workspace.yaml              # 新增：packages/*
├── package.json                     # 改：私有 workspace 根，聚合脚本，无库发布字段
├── tsconfig.base.json               # 新增：共享 compiler options
├── .github/workflows/ci.yml         # 改：pnpm + 递归 lint/typecheck/test/build
├── LICENSE                          # 留根
├── README.md / README_CN.md         # 改：变为 monorepo 总览，指向各包
├── AGENTS.md                        # 改：路径与命令更新
└── packages/
    ├── model-reaction/              # ← 现根目录的库
    │   ├── src/                     # 原样迁入
    │   ├── docs/                    # 随库走（文档属于库）
    │   ├── examples/                # 随库走（演示库 API 的脚本）
    │   ├── benchmarks/
    │   ├── package.json             # name: model-reaction，exports/files 路径不变（相对包根）
    │   ├── rollup.config.js / tsconfig*.json / jest.config.js / eslint.config.mjs
    │   ├── CHANGELOG.md
    │   └── README.md / README_CN.md # 库自己的 README（现有的挪进来）
    ├── devtools/                    # ← 现 devtools/
    │   ├── src/ public/ types/ build.mjs jest.config.js tsconfig.json
    │   └── package.json             # 依赖 model-reaction 为 workspace:*（仅测试用）
    └── demo/                        # 新建
        ├── src/  index.html  vite.config.ts  package.json  tsconfig.json
        └── README.md
```

**归属判断依据（已核实）**
- `docs/`、`examples/`、`benchmarks/` 全部 `import ... from '../src'` → 属于库，随库迁入 `packages/model-reaction/`。
- devtools 运行时**零 import 库源码**；仅 [e2e.test.ts](../packages/devtools/src/__tests__/e2e.test.ts) 穿透 `../../../src`。迁移后改为从 `model-reaction` / `model-reaction/devtools` 包名导入（workspace 解析）。

---

## 3. 分阶段执行（先非破坏，后破坏）

> 遵循「先不破坏兼容性的内部优化，再破坏性调整」的既定节奏。

**阶段 A —— 搭 workspace 骨架（非破坏）**
1. 新增 `pnpm-workspace.yaml`（`packages: ['packages/*']`）。
2. 新增根 `package.json`（`private: true`，聚合脚本），`tsconfig.base.json`。
3. 暂不移动文件，验证 pnpm 可 install（空 workspace）。

**阶段 B —— 迁移库（破坏性：git 大挪移）**
4. `git mv` 库相关内容到 `packages/model-reaction/`：`src/ docs/ examples/ benchmarks/ rollup.config.js tsconfig*.json jest.config.js eslint.config.mjs CHANGELOG.md README*.md`。
5. 库 `package.json` 的 `exports`/`files`/`main`/`module`/`types` **路径不变**（都相对包根，`dist/...`）。
6. 校验：`pnpm --filter model-reaction run build/test/typecheck:test/lint` 全绿。

**阶段 C —— 迁移 devtools（破坏性：解相对路径）**
7. `git mv devtools packages/devtools`。
8. devtools `package.json` 加 `"devDependencies": { "model-reaction": "workspace:*" }`；`e2e.test.ts` 的 `../../../src/devtools`→`model-reaction/devtools`、`../../../src/index`→`model-reaction`。
9. 校验：`pnpm --filter model-reaction-devtools run test/typecheck/build`。

**阶段 D —— 新建 demo（加法）**
10. Vite + React + TS 脚手架；`private:true`；依赖 `model-reaction: workspace:*`，全程用 `model-reaction/devtools` 的 `createModel`。
11. demo 覆盖多场景（每个场景一个路由/标签页，页面顶部统一提示「打开 DevTools 的 Model Reaction 面板查看」）：
    - **多实例**：同页并存 ≥2 个模型（如两张独立表单），验证 devtools 面板的实例选择器。
    - **异步校验**：含异步 `validator`（如「用户名是否可用」模拟延迟），展示 `validating`/`dirtyData`/错误态。
    - **reaction 链**：`a → b → c` 链式派生 + 跨字段 reaction（如 firstName/lastName → fullName → greeting），在 devtools 依赖图中可见多层边。
12. 校验：`pnpm --filter demo run build` + 手动 `dev` 冒烟（含打开 devtools 面板核对三视图）。

**阶段 E —— CI 与总览文档（收尾）**
13. 改 [ci.yml](../.github/workflows/ci.yml)：`pnpm/action-setup` + `pnpm -r run lint/typecheck/test/build`（三包全覆盖，含此前从未跑过的 devtools）。
14. 根 README/README_CN 改为 monorepo 总览；[AGENTS.md](../packages/model-reaction/AGENTS.md) 更新命令（`pnpm --filter ...`）与「Files that act as living spec」路径。
15. 全量验证：根 `pnpm -r` 全绿 + 库发布物 `npm pack --dry-run` 检查内容无回归（保留独立发布能力）。

---

## 4. 改动清单（逐文件）

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `pnpm-workspace.yaml` | 新增 | `packages: ['packages/*']` |
| 根 `package.json` | 重写 | `private:true`；聚合脚本；移除库的 `exports/files/publishConfig`（迁往库包） |
| `tsconfig.base.json` | 新增 | 抽 strict/target 等公共项，各包 `extends` |
| `src/ docs/ examples/ benchmarks/` | git mv | → `packages/model-reaction/` |
| 库 `rollup/tsconfig*/jest/eslint/CHANGELOG/README*` | git mv | → `packages/model-reaction/` |
| `devtools/` | git mv | → `packages/devtools/`；加 `model-reaction: workspace:*` |
| `devtools/.../e2e.test.ts` | 改 import | 相对 `../../../src` → 包名导入 |
| `packages/demo/**` | 新增 | Vite+React 演示 |
| `.github/workflows/ci.yml` | 重写 | npm→pnpm，递归三包 |
| 根 `package-lock.json` | 删除 | 换 `pnpm-lock.yaml` |
| 根 `README*/AGENTS.md` | 改 | monorepo 总览 + 命令/路径更新 |

---

## 5. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| git mv 后历史/评审噪声大 | 全程 `git mv` 保留历史；分阶段提交（A→E 各一次），可逐段回滚 |
| 库发布物内容变化（用户可见回归） | 阶段 B 后 `npm pack --dry-run` 对比 `files` 产物清单，须与迁移前一致 |
| docs 相对链接失效（DEVTOOLS.md 有 6–7 处 `../`） | 文档随库同迁，`../src` 相对关系不变；跨包链接（demo↔库）单独校验 |
| pnpm 与现 npm lockfile 冲突 | 删 `package-lock.json`，`pnpm import` 生成 `pnpm-lock.yaml` 后重装校验 |
| CI 从 npm 切 pnpm 引入偶发失败 | 保留 Node 16/18/20/22 矩阵；先本地 `pnpm -r` 通过再改 CI |
| devtools 用 `workspace:*` 但发布时无法解析 | devtools `private:true` 不发布；若将来发布，改真实版本号（见 TBD） |

**总回滚**：三包尚未发布，最坏情况 `git reset` 到迁移前 commit 即可，无外部影响。

---

## 6. 决策与待定项

**已定（本轮确认）**
- **TBD-2 发布策略** ✅：库 `packages/model-reaction` **继续独立发 npm**（保留 `publishConfig`/`files`/`exports`，本次不执行发布动作但确保发布物零回归）；demo **不部署**；devtools 保持 `private:true` 不发布。版本联动工具（changesets 等）暂不引入。
- **TBD-3 demo 深度** ✅：**覆盖多场景**——多实例、异步校验、reaction 链（见阶段 D 第 11 步）。

**待定（需你后续拍板，不阻塞执行）**
- **TBD-1 构建编排**：是否引入 Turborepo/Nx 做增量与缓存？当前用 pnpm `-r` 足够。
- **TBD-4 共享 lint/tsconfig 粒度**：`tsconfig.base.json` 抽多少；eslint 是否也上根共享 config。
- **TBD-5 Node/CI 矩阵**：demo（Vite）对 Node16 支持有限，是否收窄矩阵或按包分矩阵。
- **TBD-6 根 README 与库 README 分工**：根做总览、库做详述；docs 是否需在根加导航。
