# AI 接入评测基线

[English Version](README.md) | 中文

清单版本：`ai-integration-v1`。状态：**首轮已完成，36 次有效尝试，0 次 BLOCKED**。
首次交付通过 28/36（77.8%），两轮修复内最终通过 34/36（94.4%）。
未通过的两次均属于 AI-11；配置、复核裁决与覆盖边界见
[结果摘要](SUMMARY_CN.md)。完整报告与取证保存在 Git 忽略的本地 `runs/`，不随克隆交付。
运行方式见 [执行说明](EXECUTION_CN.md)。历史任务提示、fixture、检查、参考解和
实测结果保持不变；运行器已修复状态一致性、产物选择和评分隔离，并非未改动的历史评分器。

包含 Schema Recipe 的独立重采样也已完成：首次 32/36（88.9%），最终
35/36（97.2%），AI-11 三次均首次通过。两轮对比见 [结果摘要](SUMMARY_CN.md)。
两轮报告分别保留；每项三个样本不代表稳定的一般成功率。

目标是验证 coding agent 能否根据交付给使用者的资料，正确接入 `model-reaction`、
诊断调用错误并完成修复。首版固定 12 项任务：核心模型 6 项、React 接入 4 项、
类型与迁移 2 项。它们评估应用代码，不要求修改库。

## 契约与版本

本清单依据源码提交 `8678594c9f0b6f828d97258f6b01a4aaf0f785fa` 下的
[API](../../packages/model-reaction/docs/API_CN.md)、
[React 绑定](../../packages/model-reaction/docs/REACT_CN.md)、
[高级用法](../../packages/model-reaction/docs/ADVANCED_CN.md)和
[贡献约定](../../packages/model-reaction/AGENTS.md)制定。
这些链接指向当前 checkout 的契约。复现本历史清单时应读取指定源码 checkout
中的文档，不能用当前 2.0 文档替代；本清单固定历史任务输入与验收要求。

该提交的包版本为 `1.2.0`，文档还包含 unreleased 变更。
**版本号不能单独标识本次评测对象，也不能据此推定 npm 上同版本包的行为。**
首次执行时从指定源码构建并打包，记录源码 commit、工作区差异、tarball SHA-256、
包内文档指纹以及消费项目锁文件。评测安装这份 tarball，不使用源码路径映射。

使用 `prepare(output, sourceRepo)`（或 CLI 的第二个参数）选择上述提交的独立
checkout。当前 2.0 包在任何构建或安装前即被拒绝。版本校验只是必要条件：
仍须核对源码 commit/diff 并校准全部 12 份参考解。当前 API 的实验需要另立版本，
不可原地改写 v1 参考解。清单记录实际 `package_version` 和 `tarball_name`；
旧清单根据历史版本推导文件名。新实验必须使用全新的取证目录。

当前静态/类型检查、编译和运行验收都在 `codex sandbox -P evaluation` worker
内执行，不调用 AI。启动或权限探针失败记为 `BLOCKED`，不回退到无沙箱执行。
worker 默认拒绝访问，只授权自身项目、可信工具链与检查代码、已核实的 Node/
系统路径；拒绝参考解、其他尝试和宿主秘密，清理环境变量并关闭网络。
检查与提交共享运行时，且可以在其中读取：**并非隐藏检查，也不能证明能抵御恶意篡改**。
此边界保护宿主文件系统、环境与网络访问，不保证恶意运行时下的评分完整性。
历史评分在宿主进程中执行，不能作为新边界的验证证据。详见 [执行限制](EXECUTION_CN.md)。

本目录不在 npm 包的 `files` 范围内。任务卡中的“验收”和“典型误用”仅供评测者使用，
不随包交付，也不作为 agent 的初始上下文。

## 固定任务总表

| ID | 固定任务 | 主要检验点 |
| --- | --- | --- |
| AI-01 | 建立可校验的用户模型 | 公开导入、默认值、字段校验、类型推导 |
| AI-02 | 保留并处理失败输入 | data / dirtyData / errors、错误事件、恢复 |
| AI-03 | 批量修改关联字段 | transform 后的候选快照、部分提交、未知 key |
| AI-04 | 实现购物车计算链 | 显式依赖、纯 computed、派生校验、落定读取 |
| AI-05 | 接入异步用户名查重 | 交错完成、旧结果隔离、最新状态 |
| AI-06 | 根据邮编异步计算运费 | SKIP、action、Promise 追踪、回写与错误 |
| AI-07 | 绑定受控金额输入框 | draft、数字转换、异步校验、两类错误 |
| AI-08 | 提交正在编辑的表单 | 等待与完整校验、提交锁、有效 payload |
| AI-09 | 管理独立编辑器生命周期 | owner、StrictMode、路由切换、订阅清理 |
| AI-10 | 展示随 props 变化的选择结果 | selector 闭包、字段隔离、错误订阅 |
| AI-11 | 组合带精确类型的业务 Schema | 模块组合、可选值、enum、嵌套值替换 |
| AI-12 | 迁移并修复旧购物车接入 | 当前版本 API、依赖诊断、共享 action |

所有任务纳入首轮基线，按任务分别报告。AI-12 单独归类为迁移/修复，
避免把它与从空白实现的成功率混为一个不加说明的数字。

## Agent 输入与执行规则

每项任务的初始输入固定为：以下公共提示、该任务的“任务提示”原文，以及对应 starter。
starter 固定导出签名、允许修改的文件和 mock 服务接口；业务要求与 mock 行为均对 agent
可见，隐藏检查不引入提示之外的新需求。具体 starter 和验收脚本实现后，必须记录其
哈希，才可启动正式采样。

> 在当前独立 TypeScript 消费项目中完成任务。使用已安装的 model-reaction 公开入口，
> 可以查阅该包随附的 README、AGENTS.md、docs、examples 和类型声明。
> 按 starter 约定在 src/ 中实现并交付可运行代码，处理异步失败与资源清理。
> 可以运行项目提供的类型检查和公开检查命令。
> 保持依赖版本、编译配置、starter 导出签名和评测文件不变，不修改 node_modules。
> 不通过 any、类型断言或忽略诊断来绕过任务要求的类型约束。
> 完成时给出修改文件与已经运行的检查。

执行要求：

1. 每个任务、每次重复都用独立项目和全新 agent 上下文；不继承本会话、其他任务解答、
   仓库记忆、参考实现或隐藏断言。项目只能访问安装包、starter 和固定工具链，
   不能访问本评测目录、库源码、仓库测试或网络搜索。
2. Core 任务使用纯 TypeScript 项目；React 任务使用 React、React DOM、jsdom 和
   Testing Library。依赖由评测环境预装；安装故障不算接入失败。
3. 固定 agent 的产品/版本、模型版本、系统提示、推理配置、工具权限、提示语言、
   Node、包管理器、TypeScript、React 和测试工具版本，记录配置指纹。
   中文和英文提示是独立实验组，不混合成绩。
4. 第一阶段允许自行查文档、编译和运行公开检查。首次提交后冻结代码并运行隐藏验收。
   指标名为“首次交付通过率”，不宣称是未经自检的首次生成通过率。
5. 首次失败后最多反馈两轮原始诊断，每轮允许修复并重新提交。反馈保留失败输入、
   断言期望/实际、错误堆栈和超时信息，不提供参考实现或新增解题提示。
6. 每次尝试上限 20 分钟：首次交付最多 10 分钟，每轮修复最多 5 分钟。
   实现阶段由 agent 主动运行检查产生的时间计入；评测器自身运行时间单独记录。
   同一配置下每项重复 3 次，共 36 次独立尝试。后续调整预算或提示需更换清单版本。
7. 异步服务用可控 Promise；防抖用固定虚拟时钟。用明确的事件、请求启动或任务状态
   作为 barrier，不依赖任意 sleep。断言超时是兜底，不能充当异步完成的证明。
8. 正式采样前，用评测者持有的参考实现逐项跑通相同的隐藏验收。确认失败来自应用接入
   还是库/环境后再归因，不能把当前不支持的能力算成 agent 失败。

## 固定任务卡

### AI-01 — 建立可校验的用户模型

**任务提示**

> 实现用户模型工厂。name 默认空字符串且必填；age 默认 18，必须是有限数字且不小于 18。
> 工厂返回 model-reaction 模型，创建时保留给定默认值，调用方可以显式校验和写入。
> 从 schema 推导数据类型，不手写一份重复的数据 interface。

**固定输入与验收**

- 新实例的默认值为 `{ name: '', age: 18 }`，构造不伪造已通过校验的状态。
- 初次完整校验失败；写入 `name = 'Ada'` 后完整校验成功。
- `age = 17`、`NaN` 和 `Infinity` 被拒，已提交年龄保留 18；`age = 21` 成功。
- 消费项目编译通过；`name` / `age` 分别为 string / number，错误字段名和错误类型
  setter 调用在评测端的负向类型检查中失败。

**典型误用**：规则从根入口导入；把 `type` 当成运行时校验；假定默认值已校验。

### AI-02 — 保留并处理失败输入

**任务提示**

> 实现名称编辑模型，默认名称 Ada，规则依次为必填、至少 3 个字符。
> 为调用方提供读取已提交名称、失败输入、当前错误和监听校验错误的能力。
> 支持清除失败输入记录，以及重新输入合法名称；保持库的错误与事件语义。

**固定输入与验收**

- `Bo` 写入返回 false，`data.name` 仍为 `Ada`，dirty 为 `Bo`，存在长度错误。
- 空字符串同时违反两条规则时仅报告首个错误；校验失败 resolve false，不按异常处理。
- `clearDirtyData()` 后 dirty 为空，已提交值不变，已有错误仍在。
- 后续写入 `Grace` 清除该字段 dirty 和错误；取消事件订阅后不再收到通知。

**典型误用**：直接写 `data`；把 dirty 当草稿缓存；调用不存在的 `commitDirty`；
把清 dirty 理解为同时清错误。

### AI-03 — 批量修改关联字段

**任务提示**

> 实现密码修改模型。password 默认 old-password、去除首尾空格后至少 8 个字符；
> confirm 默认 old-password，必须等于本批次的新 password；memo 默认 old。
> 支持一次批量写入，保留库的字段独立提交语义；未知字段按库的异常路径报告。

**固定输入与验收**

- 同批写入 `{ password: '  new-secret  ', confirm: 'new-secret' }` 成功；
  confirm 看到的是转换后的候选值。
- 再写 `{ password: 'next-secret', confirm: 'wrong', memo: 'saved' }` 返回 false；
  password 和 memo 提交，confirm 保留 `new-secret`，dirty.confirm 为 `wrong`。
- 新实例收到包含 `unknownField` 的批量输入时发送 `field:not-found` 并 reject，
  所有字段保持原值，已插桩的 transform 尚未执行。
- 外部输入中的未知 key 由评测器通过运行时 fixture 提供，不要求 agent 绕过 TypeScript。

**典型误用**：按字段顺序分次提交跨字段更新；读取旧 data 校验；自行回滚有效字段。

### AI-04 — 实现购物车计算链

**任务提示**

> 实现购物车模型：price 默认 10、quantity 默认 2、discount 默认 2；
> subtotal = price × quantity，total = subtotal − discount。
> subtotal 必须不大于 100，非法派生结果不能覆盖合法值。
> 通过 reaction 声明全部计算依赖，使用 10ms reaction 防抖；
> 提供一次修改后读取完整计算结果的业务函数。

**固定输入与验收**

- 初始化落定后 subtotal / total 为 `20 / 18`。
- 同批写入 `{ price: 20, quantity: 3, discount: 5 }`，业务函数返回 `60 / 55`；
  单独改 discount 为 10 后返回 `60 / 50`。
- 再将 price 改为 200、quantity 改为 1，subtotal 的 200 被拒，
  已提交 subtotal / total 保留 `60 / 50`，dirty.subtotal 为 200。
- computed 同步、无 I/O 或模型写入；实现没有靠手工同步派生字段替代 reaction。

**典型误用**：依赖漏报；async computed；只 await setter 就返回下游值；用延迟猜测落定。

### AI-05 — 接入异步用户名查重

**任务提示**

> 实现用户名模型，默认 guest，通过注入的异步 availability 服务校验新用户名。
> 连续编辑时立即启动新的校验，最终已提交值、失败输入和错误只反映最新编辑。
> 服务的返回顺序由调用方控制，不自行串行化用户输入。

**固定输入与验收**

- 写入 `alice` 后，在该请求未完成时写入 `bob`；两个服务请求都已启动。
- 场景 A：先返回 bob 可用，再返回 alice 不可用。落定后值为 bob，dirty 与错误为空。
- 场景 B 使用新实例：先返回 bob 不可用，再返回 alice 可用。
  最终值仍为 guest，dirty 为 bob，错误属于 bob。
- 结束时无未处理拒绝；不对已经过期的 setter 返回值追加当前状态推断。

**典型误用**：网络返回后绕开模型提交；全局共享查重状态；把最后返回当成最后输入。

### AI-06 — 根据邮编异步计算运费

**任务提示**

> 实现运费模型：postcode 默认空，base 默认 100，fee 默认 0，total 为 base + fee。
> 派生 requestKey 为去除空格的 postcode；空邮编跳过本次计算并保留上次报价，
> 在 requestKey 字段校验非空邮编必须是 5 位数字，合法后通过 action 调用注入的 quote 服务。
> 得到报价后写入 fee，再调用异步 audit 记录本次运费。外部可以等待整个流程完成、
> 观察报价失败；服务由调用方控制，不需要实现请求取消。

**固定输入与验收**

- 空默认值不发请求；输入 ` 10001 ` 后 quote 收到 `10001`，返回 12 后 fee / total 为
  `12 / 112`，audit 收到 12。
- quote 或 audit 尚未完成时，外部 `settled()` 不提前完成；结束后派生值已落定。
- 从无挂起任务的状态输入空字符串不发新请求并保留已提交结果；输入 `abc` 时
  requestKey 校验失败，不为本次非法产物启动 action。
- 新实例的 quote 拒绝时可通过 `reaction:error` 和宿主字段错误观察，保留旧 fee；
  不要求 `settled()` 自身 reject。
- 有顺序依赖的 quote、写回和 audit 显式串联；action / validator 不等待同模型的
  `settled()` 或 `validateAll()`。跳过或非法输入不会被要求取消此前已登记的工作。

**典型误用**：fire-and-forget 请求；把 action 数组当串行任务；表达式体返回
`Promise<boolean>`；等待包含自身的全局任务。

### AI-07 — 绑定受控金额输入框

**任务提示**

> 实现金额文本输入组件。模型金额默认 10，提交为有限的非负 number，并接受注入的
> 异步校验；文本 `!` 的 transform 抛出 Invalid amount text。
> 编辑内容立即显示，校验失败也保留，成功后保留用户输入的数字格式。
> 失焦后显示错误，同时处理普通校验失败与写入异常。使用库推荐的文本绑定。

**固定输入与验收**

- 输入 `3.50`，服务未返回时已显示该文本；通过后 data 为数字 3.5，文本仍为 `3.50`。
- 输入 `-1` 后保留文本，data 仍为 3.5，dirty 为数字 -1；失焦后显示校验错误。
- 输入 `!` 后显示写入异常消息，不产生未处理拒绝；该异常不被伪装成模型 dirty。
- 后续输入合法的 `4` 可恢复；无本地在途编辑时，外部提交 8 能回填文本。
- 校验元数据变动能更新错误 UI，即使已提交 data 没变。实际挂载测试，不以 SSR 代替。

**典型误用**：直接绑定 committed 值导致回弹；缺少数字 transform；只显示 meta.error；
把 `setDraft` 当成 Promise。

### AI-08 — 提交正在编辑的表单

**任务提示**

> 为 starter 提供的表单模型和输入组件实现提交逻辑。提交要覆盖未触碰字段、
> 正在进行的输入校验和异步计算；只有输入层与模型都有效才调用 save。
> 提交过程中禁止继续编辑和重复提交，成功或失败后都释放提交锁。
> 保留输入组件提供的写入异常状态，向用户显示失败。

**固定输入与验收**

- 必填 name 的空默认值阻止保存；输入层存在写入异常时，即使模型旧值合法也不能保存。
- starter 固定合法输入为 name=Ada、price=20、quantity=3；待处理报价返回 fee=12。
  释放异步 barrier 后保存的 payload 为
  `{ name: 'Ada', price: 20, quantity: 3, fee: 12, total: 72 }`。
- 完整校验在已有输入与初始化落定后开始；校验返回 false 或 reject 时不调用 save。
- 等待中连续两次提交只产生一次保存，编辑控件不可写；save 拒绝后可重新编辑和重试。
- 使用一次完整校验的公开契约，不要求库在 action 回写后自动重验所有跨字段规则。

**典型误用**：仅看 validationErrors 是否为空；先取 payload 再等待；遗漏默认值校验；
重复提交；锁没有在异常路径释放。

### AI-09 — 管理独立编辑器生命周期

**任务提示**

> 实现按 recordId 管理的 React 编辑器，使用注入的模型工厂和事件记录器。
> A 记录初值 Ada，B 记录初值 Bob。两个同时存在的编辑器独立工作；
> 路由从 A 切到 B 后切换实例，卸载后停止接收更新。
> 支持 React StrictMode，按实际 owner 生命周期创建与释放模型和订阅。

**固定输入与验收**

- 同屏 A、B 编辑互不影响；A→B 切换不残留 A 的值与错误。
- StrictMode 重复 effect setup/cleanup 后，当前显示实例仍可正常编辑。
- 通过注入工厂和记录器观察清理：退役实例被释放，订阅被取消，卸载后旧请求完成
  不再更新已卸载 UI 或写入新实例。
- 不要求固定构造次数，不假设 dispose 会取消已启动的网络请求。

**典型误用**：模块 singleton；cleanup 销毁新实例；在渲染阶段创建带初始化副作用的模型；
把 Provider 当自动所有者。

### AI-10 — 展示随 props 变化的选择结果

**任务提示**

> 基于 starter 提供的模型实现 ItemPrice 和 AmountError 两个展示组件。
> items 初值为 a=10、b=20，note 默认为空字符串，amount 默认 10 且必须是有限非负数字；
> ItemPrice 根据 prop id 显示价格，返回对象形式的选择结果，无关字段 note 的变化
> 不应使该展示组件因模型通知重新渲染。
> AmountError 展示金额校验错误，失败输入不提交时也要更新。

**固定输入与验收**

- 仅将 prop id 从 a 改为 b，模型不发生写入，显示从 10 改为 20。
- 替换 items 使 b=21 后显示 21；note 更新时 ItemPrice 的渲染计数增量为零。
- 金额非法输入导致错误展示，已提交金额不变；修复后错误消失。
- 允许选择不同 Hook 组合，只检查当前 props、等价选择结果和错误订阅的实际行为。
  不用 StrictMode 下的绝对渲染次数作为断言。

**典型误用**：陈旧 selector 闭包；返回新对象却不配置等价比较；仅订阅 data 展示错误。

### AI-11 — 组合带精确类型的业务 Schema

**任务提示**

> 把模型拆成身份与订单两个可组合 schema 模块，再由工厂创建独立实例。
> 字段为 name='Ada'、status='draft'（只允许 draft/published）、无默认值的字符串 note、
> address={city:'Hangzhou'}、lines=[{sku:'book',qty:1}]。
> 保留 schema 推导出的类型，提供修改城市与追加订单行的函数，确保模型能观察变化。
> 复用配置时不要修改已创建模型的 schema。

**固定输入与验收**

- name 为 string，status 为 `'draft' | 'published'`，note 为 `string | undefined`；
  address.city 和 lines 元素分别保留 string 和 `{ sku: string; qty: number }` 类型。
- 错误状态字面量、错误 qty 类型和不存在的字段 setter 在负向类型检查中失败；
  没有借显式泛型谎报默认值或通过断言掩盖 unknown/any。
- 修改城市与追加行通过顶层替换触发订阅；第二个实例的数据不受影响。
- status 的运行时校验拒绝外部非法值；枚举元数据本身不代替校验。

**典型误用**：片段注解过宽导致 unknown；原地 push 或修改嵌套属性；运行时改 schema；
把浅冻结当深冻结。

### AI-12 — 迁移并修复旧购物车接入

**任务提示**

> starter 中提供了一份旧版购物车接入，请迁移到当前已安装版本并修复计算与保存行为。
> 保留业务字段和导出接口：price=10、quantity=2，计算 subtotal 与 total；
> price 必须是有限非负数字，quantity 必须是正整数；修改为 price=20、quantity=3 后
> subtotal 与 total 均为 60。
> 两个派生字段共用同一个保存函数，一轮计算只保存一次，并读取已落定的数据。
> 保留字段订阅的取消能力，报告未知字段异常与普通校验失败，不改库源码或依赖版本。

**固定输入与验收**

- 旧 fixture 固定包含：从根入口导入规则、`strictMode` / `failFast`、单元素 reaction
  数组、单函数 action 及旧参数用法、`subscribeField`、拼错的依赖 `quantitiy`。
  这些是故障输入，不表示目标版本仍支持它们。
- 完成后通过类型检查和运行验收；初始落定后清空保存记录，再同批改 price / quantity，
  subtotal / total 为 `60 / 60`，共享保存函数只调用一次且读到最终数据。
- 修正依赖后重新创建模型；取消订阅有效；未知 key `unknownField` 走异常路径；
  price=-1 返回 false 并保留已提交的 20。
- 不以关闭类型检查、改依赖版本或新增核心兼容 API 消除报错。迁移说明正确区分目标
  tarball 与线上发布版本。

**典型误用**：照搬旧教程；用不同包装函数破坏引用去重；假定 computed 入参会自动补齐依赖；
给已创建的 schema 打补丁。

## 验收、指标与记录

每次提交须同时通过以下条件，才算该任务 PASS：

- **类型**：消费项目编译成功，评测端正向/负向类型断言符合预期。
- **行为**：任务卡所有业务断言通过；React 任务实际挂载验证。
- **接入约束**：仅使用公开入口，未篡改环境或验收文件，没有靠类型逃逸、硬编码输出
  或替代实现绕过要求使用的库能力。
- **收尾**：完成 fixture 清理后，无未处理拒绝、遗留订阅或任务超时。

优先用行为与编译结果验收。纯函数、公共入口、类型逃逸等约束结合静态检查和人工复核；
不要求固定变量名、文本布局或与参考实现逐行相同。

| 指标 | 定义 |
| --- | --- |
| 首次交付通过率 | 首次冻结代码即 PASS 的有效尝试数 / 有效尝试数 |
| 两轮内最终通过率 | 首次或至多两轮修复后 PASS 的有效尝试数 / 有效尝试数 |
| 修复轮数 | 每个任务报告 0 / 1 / 2 / 未修复的分布 |
| 误用分布 | 每次记录缺失 API、错误 import、类型逃逸、契约误读、等待错误、UI 错误等标签及证据 |
| 交付成本 | agent 主动工作耗时、工具调用次数、可取得时的输入/输出 token；缺失项写 unavailable |
| 覆盖与阻塞 | 计划 36 次中已完成、未运行、BLOCKED 的数量与具体原因 |

FAIL 是有效尝试且计入分母，包括超出 agent 时间预算。BLOCKED 仅用于已确认的环境、
工具或评测 fixture 故障，单独报告且不计入成功率分母。只有相同任务覆盖和运行配置
才直接比较；36 次均有有效结果后，才称为完成一轮 v1 基线。
首轮不设未经测量的“达标分数”，不把不同任务压成任意加权总分。

每次运行至少记录：

```text
suite_version, task_id, repeat_id, prompt_language, prompt_hash
starter_hash, evaluator_hash, reference_check
source_commit, source_diff_hash, package_version, tarball_name, tarball_sha256, docs_hash
consumer_lock_hash, node_version, package_manager_version
typescript_version, react_version, test_tool_versions
agent_product, agent_model, agent_config_hash, tool_policy_hash
initial_status, final_status, repair_rounds, failure_tags, blocked_reason
active_duration, evaluator_duration, tool_calls, token_usage
submission_paths, diagnostic_log_paths
```

保留初次交付与每轮修复的代码、原始编译/验收输出和工具记录。
单个任务失败归因需指向具体证据；只有观察到文档缺失、类型缺口或库缺陷时才给相应结论。
不能把“某次 agent 没读到”直接等同于“文档没有写”。

## 执行前清单与后续扩展

- [x] 固定 12 项任务、提示、输入和验收要点。
- [x] 确定隔离、反馈轮数、计分、结果记录和版本识别方式。
- [x] 实现各任务 starter、服务 mock、隐藏验收和参考解；冻结文件哈希。
- [x] 构建目标 tarball，固定独立消费项目及工具链，验证参考解。
- [x] 运行 36 次独立尝试，保存首次交付和修复证据，产出实测报告。

后续根据失败分布增加任务：IME composition 协调、请求取消与过期 action 响应、
SSR/Suspense、更复杂的 action 重入、DevTools 诊断、超大 schema 和跨模型编排。
它们不计入 v1 分母；需要应用额外实现的能力必须在新任务中明示，不能当作库默认能力。

用于修改库本身的 agent 评测另立任务集，避免混淆“使用者接入难度”和“维护者改动难度”。
