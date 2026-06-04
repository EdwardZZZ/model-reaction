# 基于 Model-Reaction 的广告创编系统技术方案

## 1. 背景与目标

本文档描述如何基于 `model-reaction` 构建广告创编系统的数据模型、业务模块与 React 组件集成方案。系统面向广告创建、创意编辑、投放配置、提审校验等场景，核心目标是将广告业务状态沉淀为可验证、可订阅、可派生的模型。

设计目标：

- **数据可信**：通过 `data` / `dirtyData` 分离，确保业务读取到的始终是已通过校验的数据。
- **逻辑内聚**：广告、创意、投放、审核等规则收敛在模块内，组件只负责交互与展示。
- **细粒度更新**：React 层通过字段级订阅减少无关渲染。
- **可扩展**：新增字段、校验规则、派生字段时优先扩展 schema，而不是扩散到组件逻辑。
- **生命周期清晰**：模型实例由页面、弹窗或业务 owner 创建，并在卸载时调用 `dispose()`。

## 2. 总体架构

```text
┌────────────────────────────────────────────┐
│  页面 / 路由 Owner                          │
│  - 创建 model                              │
│  - 注入 React Context                      │
│  - 卸载时 dispose                          │
└──────────────────────┬─────────────────────┘
                       │
┌──────────────────────▼─────────────────────┐
│  模块层 Modules                             │
│  - 广告基础信息模块                         │
│  - 创意内容模块                             │
│  - 投放配置模块                             │
│  - 提审与校验编排                           │
└──────────────────────┬─────────────────────┘
                       │
┌──────────────────────▼─────────────────────┐
│  数据层 Model-Reaction                      │
│  - schema / validators                      │
│  - data / dirtyData                         │
│  - reactions / subscriptions                │
└──────────────────────┬─────────────────────┘
                       │
┌──────────────────────▼─────────────────────┐
│  组件层 Components                          │
│  - 字段输入                                 │
│  - 错误展示                                 │
│  - 步骤切换 / 提交                          │
└────────────────────────────────────────────┘
```

### 2.1 分层职责

| 层级 | 职责 | 不应承担 |
| --- | --- | --- |
| 数据层 | 字段定义、类型约束、验证、派生值、订阅 | UI touched 状态、接口请求副作用 |
| 模块层 | 聚合字段写入、业务动作、提交前校验、DTO 转换 | 直接操作 DOM、展示错误样式 |
| 组件层 | 输入、展示、局部交互状态、调用模块方法 | 复制业务校验、绕过 model 写数据 |
| Owner 层 | 创建与销毁 model、提供上下文、路由级隔离 | 复用全局 singleton model |

## 3. 数据模型设计

`model-reaction` 的核心心智模型如下：

```text
schema -> ModelManager -> data       已验证的事实数据
                       -> dirtyData  上次未通过验证的用户输入
                       -> reactions  由依赖字段自动计算的派生值
```

广告创编模型推荐使用扁平字段名，字段名表达业务域，例如 `basic.name`、`creative.title`、`targeting.budget`。这样可以避免深层对象局部更新带来的额外合并逻辑，并保持字段级订阅简单。

### 3.1 字段分组

| 业务域 | 字段示例 | 说明 |
| --- | --- | --- |
| `basic` | `basic.id`、`basic.name`、`basic.status` | 广告基础身份与生命周期状态 |
| `creative` | `creative.title`、`creative.description`、`creative.imageUrl` | 创意内容与落地页 |
| `targeting` | `targeting.budget`、`targeting.dailyBudget`、`targeting.platforms` | 投放预算、周期、平台 |
| `audit` | `audit.ready`、`audit.blockReason` | 由其他字段派生的提审状态 |

### 3.2 Schema 示例

```ts
import { createModel, Rule, ValidationRules } from 'model-reaction';

type AdStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'active' | 'paused';

interface AdDraftData {
  'basic.id': string;
  'basic.name': string;
  'basic.status': AdStatus;
  'creative.title': string;
  'creative.description': string;
  'creative.imageUrl': string;
  'creative.landingPageUrl': string;
  'targeting.budget': number;
  'targeting.dailyBudget': number;
  'targeting.startDate': Date;
  'targeting.endDate': Date;
  'targeting.platforms': string[];
  'audit.ready': boolean;
  'audit.blockReason': string;
}

const oneOf = <T extends string>(values: readonly T[]) =>
  new Rule('oneOf', `Must be one of ${values.join(', ')}`, (value) =>
    values.includes(value as T),
  );

const url = new Rule(
  'url',
  'Invalid URL',
  (value) => typeof value === 'string' && /^https?:\/\//.test(value),
);

const minItems = (min: number) =>
  new Rule(
    'minItems',
    `At least ${min} item(s) required`,
    (value) => Array.isArray(value) && value.length >= min,
  );

export function createAdDraftModel() {
  return createModel<AdDraftData>(
    {
      'basic.id': {
        type: 'string',
        default: `ad_${Date.now()}`,
      },
      'basic.name': {
        type: 'string',
        default: '',
        validator: [
          ValidationRules.required.withMessage('请输入广告名称'),
          ValidationRules.minLength(3).withMessage('广告名称至少 3 个字符'),
          ValidationRules.maxLength(50).withMessage('广告名称最多 50 个字符'),
        ],
      },
      'basic.status': {
        type: 'enum',
        default: 'draft',
        validator: [oneOf(['draft', 'pending', 'approved', 'rejected', 'active', 'paused'])],
      },
      'creative.title': {
        type: 'string',
        default: '',
        validator: [
          ValidationRules.required.withMessage('请输入广告标题'),
          ValidationRules.maxLength(20).withMessage('广告标题最多 20 个字符'),
        ],
      },
      'creative.description': {
        type: 'string',
        default: '',
        validator: [
          ValidationRules.required.withMessage('请输入广告描述'),
          ValidationRules.maxLength(100).withMessage('广告描述最多 100 个字符'),
        ],
      },
      'creative.imageUrl': {
        type: 'string',
        default: '',
        validator: [ValidationRules.required, url],
      },
      'creative.landingPageUrl': {
        type: 'string',
        default: '',
        validator: [ValidationRules.required, url],
      },
      'targeting.budget': {
        type: 'number',
        default: 1000,
        validator: [ValidationRules.required, ValidationRules.min(100)],
      },
      'targeting.dailyBudget': {
        type: 'number',
        default: 100,
        validator: [ValidationRules.required, ValidationRules.min(10)],
      },
      'targeting.startDate': {
        type: 'date',
        default: new Date(),
        validator: [ValidationRules.required],
      },
      'targeting.endDate': {
        type: 'date',
        default: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        validator: [ValidationRules.required],
      },
      'targeting.platforms': {
        type: 'array',
        default: [],
        validator: [minItems(1)],
      },
      'audit.ready': {
        type: 'boolean',
        default: false,
        reaction: {
          fields: [
            'basic.name',
            'creative.title',
            'creative.description',
            'creative.imageUrl',
            'creative.landingPageUrl',
            'targeting.platforms',
          ],
          computed: (data) =>
            Boolean(
              data['basic.name'] &&
                data['creative.title'] &&
                data['creative.description'] &&
                data['creative.imageUrl'] &&
                data['creative.landingPageUrl'] &&
                data['targeting.platforms']?.length,
            ),
        },
      },
      'audit.blockReason': {
        type: 'string',
        default: '',
        reaction: {
          fields: ['audit.ready'],
          computed: (data) => (data['audit.ready'] ? '' : '请补全广告基础信息、创意内容和投放平台'),
        },
      },
    },
    {
      debounceReactions: 16,
      failFast: true,
    },
  );
}
```

### 3.3 数据写入规则

- 单字段写入使用 `await model.setField(field, value)`，返回 `true` 表示验证通过并提交到 `data`。
- 多字段写入使用 `await model.setFields(partial)`，用于步骤保存、批量导入、状态迁移等原子场景。
- 验证失败时不要读取 `model.data` 期望得到失败值，失败输入会进入 `model.getDirtyData()`。
- 提交前使用 `await model.validateAll()` 重新校验完整广告草稿。
- 测试或复杂异步场景中，使用 `await model.settled()` 等待验证和反应完成。

### 3.4 业务约束矩阵

广告创编不应只停留在字段级必填与长度校验，还需要显式描述跨字段和业务阶段约束。推荐将这些规则分为三类：前端即时校验、提交前聚合校验、服务端最终校验。

| 约束 | 规则说明 | 触发时机 | 实现层 |
| --- | --- | --- | --- |
| 投放时间范围 | `targeting.endDate` 必须晚于 `targeting.startDate` | 用户修改日期、提交前 | 前端 + 服务端 |
| 预算约束 | `targeting.dailyBudget` 不得大于 `targeting.budget` | 用户修改预算、提交前 | 前端 + 服务端 |
| 平台最少选择 | `targeting.platforms` 至少选择一个平台 | 用户修改平台、提交前 | 前端 + 服务端 |
| 平台素材规格 | 不同平台对标题长度、图片比例、落地页协议可能不同 | 用户切换平台、提交前 | 前端 + 服务端 |
| 落地页安全 | 落地页必须为合法 URL，必要时通过安全检测或白名单校验 | 输入 URL、提交前 | 前端基础校验 + 服务端最终校验 |
| 状态迁移 | 仅 `draft` 可提交为 `pending`，审核中不可再次编辑部分字段 | 保存、提审、回填 | 模块层 + 服务端 |
| 审核阻断原因 | 当必要信息缺失时，需给出明确不可提审原因 | 字段变更、提交前 | 前端 reaction |

### 3.5 跨字段规则实现建议

对于广告业务，建议优先把同步、可本地判断的约束写进 schema，避免组件中重复写判断逻辑。

```ts
import { Rule } from 'model-reaction';

const afterStartDate = new Rule(
  'afterStartDate',
  '结束时间必须晚于开始时间',
  (value, data) =>
    value instanceof Date &&
    data?.['targeting.startDate'] instanceof Date &&
    value.getTime() > data['targeting.startDate'].getTime(),
);

const dailyWithinBudget = new Rule(
  'dailyWithinBudget',
  '日预算不能大于总预算',
  (value, data) =>
    typeof value === 'number' &&
    typeof data?.['targeting.budget'] === 'number' &&
    value <= data['targeting.budget'],
);
```

推荐策略：

- 能在本地确定的规则优先放在 schema validator 中。
- 会依赖平台配置中心、风控服务、素材审核服务的规则放到提交前接口中兜底。
- 需要展示"当前为什么不能提交"时，优先用 reaction 生成面向 UI 的派生字段，如 `audit.blockReason`。

## 4. 模块层设计

模块层封装广告创编动作，避免组件直接拼装大量字段名。

```ts
import type { ModelReturn } from 'model-reaction';

type AdDraftModel = ModelReturn<AdDraftData>;

interface CreativeInput {
  title: string;
  description: string;
  imageUrl: string;
  landingPageUrl: string;
}

interface TargetingInput {
  budget: number;
  dailyBudget: number;
  startDate: Date;
  endDate: Date;
  platforms: string[];
}

export function createAdDraftModule(model: AdDraftModel) {
  return {
    model,

    setBasicInfo(name: string) {
      return model.setFields({
        'basic.name': name,
        'basic.status': 'draft',
      });
    },

    setCreative(input: CreativeInput) {
      return model.setFields({
        'creative.title': input.title,
        'creative.description': input.description,
        'creative.imageUrl': input.imageUrl,
        'creative.landingPageUrl': input.landingPageUrl,
      });
    },

    setTargeting(input: TargetingInput) {
      return model.setFields({
        'targeting.budget': input.budget,
        'targeting.dailyBudget': input.dailyBudget,
        'targeting.startDate': input.startDate,
        'targeting.endDate': input.endDate,
        'targeting.platforms': input.platforms,
      });
    },

    async submitForAudit() {
      const valid = await model.validateAll();
      if (!valid || !model.getField('audit.ready')) {
        return false;
      }

      return model.setField('basic.status', 'pending');
    },

    toPayload() {
      const data = model.data;
      return {
        id: data['basic.id'],
        name: data['basic.name'],
        status: data['basic.status'],
        creative: {
          title: data['creative.title'],
          description: data['creative.description'],
          imageUrl: data['creative.imageUrl'],
          landingPageUrl: data['creative.landingPageUrl'],
        },
        targeting: {
          budget: data['targeting.budget'],
          dailyBudget: data['targeting.dailyBudget'],
          startDate: data['targeting.startDate'],
          endDate: data['targeting.endDate'],
          platforms: data['targeting.platforms'],
        },
      };
    },
  };
}
```

模块设计原则：

- 组件调用语义化方法，例如 `setCreative()`、`submitForAudit()`，不要散落字段名。
- 所有写入方法返回 `Promise<boolean>`，便于组件展示成功或失败状态。
- 接口请求、埋点、弹窗提示等副作用放在模块外的应用服务或组件事件中。
- `reaction.computed` 必须保持纯函数，副作用只能放在 `reaction.action` 或调用链外部。

## 5. React 集成方案

React 层推荐由页面级 owner 创建 model，并通过 `ModelProvider` 注入子树。组件使用 `useModelFieldState` 绑定单字段输入，使用本地 `touched` 状态控制错误展示。

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Field, ModelProvider, useModel, useModelFieldState } from 'model-reaction/react';

function AdDraftOwner() {
  const model = useMemo(() => createAdDraftModel(), []);
  const module = useMemo(() => createAdDraftModule(model), [model]);

  useEffect(() => () => model.dispose(), [model]);

  return (
    <ModelProvider model={model}>
      <AdCreationForm module={module} />
    </ModelProvider>
  );
}

function NameField() {
  const model = useModel<AdDraftData>();
  const [name, setName, meta] = useModelFieldState(model, 'basic.name');
  const [touched, setTouched] = useState(false);

  return (
    <label>
      <span>广告名称</span>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={Boolean(touched && meta.error)}
      />
      {touched && meta.error && <small role="alert">{meta.error}</small>}
    </label>
  );
}

function TitleField() {
  return (
    <Field<AdDraftData, 'creative.title'> name="creative.title">
      {({ value, setValue, meta }) => (
        <label>
          <span>广告标题</span>
          <input value={value} onChange={(event) => setValue(event.target.value)} />
          {meta.error && <small role="alert">{meta.error}</small>}
        </label>
      )}
    </Field>
  );
}
```

### 5.1 Hook 选择

| 场景 | 推荐 API |
| --- | --- |
| 单字段展示 | `useModelField(model, field)` |
| 表单输入、错误、dirty、validating | `useModelFieldState(model, field)` |
| 多字段切片 | `useModelFields(model, fields)` |
| 派生展示值 | `useModelSelector(model, selector)` |
| 内联 selector 且依赖组件 props | `useModelComputed(model, selector)` |

### 5.2 提交流程

```ts
async function handleSubmit() {
  const ok = await module.submitForAudit();

  if (!ok) {
    const dirtyData = module.model.getDirtyData();
    const summary = module.model.getValidationSummary();
    console.warn('提交失败', { dirtyData, summary });
    return;
  }

  const payload = module.toPayload();
  await adService.submit(payload);
}
```

### 5.3 页面装配与状态流转

推荐页面装配关系：

```text
AdCreationPage
  -> AdDraftOwner
    -> AdCreationShell
      -> BasicInfoStep
      -> CreativeStep
      -> TargetingStep
      -> SubmitBar
```

各层职责建议如下：

| 组件 / 容器 | 职责 |
| --- | --- |
| `AdCreationPage` | 路由参数解析、页面级权限判断、初始化接口调用 |
| `AdDraftOwner` | 创建 model / module，负责 `dispose()` |
| `AdCreationShell` | 步骤切换、整体布局、跨步骤消息提示 |
| `BasicInfoStep` / `CreativeStep` / `TargetingStep` | 只关注字段输入和局部 UI 状态 |
| `SubmitBar` | 统一触发保存草稿、提交审核、展示提交中状态 |

推荐状态流：

```text
进入页面
  -> 创建 model
  -> 拉取草稿并 setFields 回填
  -> 用户逐步编辑字段
  -> schema validator 即时校验
  -> reaction 产出 audit.ready / audit.blockReason
  -> 点击保存草稿
  -> 点击提交审核
  -> validateAll
  -> 服务端最终校验
  -> 成功则状态迁移到 pending，失败则回填错误
```

## 6. 校验与派生策略

### 6.1 校验策略

- **基础类型校验**：由 `FieldSchema.type` 约束字段基础类型。
- **必填与长度**：优先使用内置 `ValidationRules`，并通过 `withMessage()` 配置业务文案。
- **枚举与数组**：通过自定义 `Rule` 封装 `oneOf`、`minItems` 等规则。
- **跨字段校验**：验证器可通过 `data` 参数读取其他字段；复杂规则建议封装为独立函数。
- **异步校验**：可用于广告名称查重、落地页安全检测，并通过 `asyncValidationTimeout` 控制超时。

### 6.2 派生策略

- 将可由已有字段计算出的数据定义为 reaction 字段，例如 `audit.ready`、`audit.blockReason`、`targeting.totalDays`。
- `computed` 只做纯计算，不发请求、不写日志、不修改外部变量。
- 对频繁输入字段触发的派生计算配置 `debounceReactions`。
- 需要监听派生结果时，使用 `subscribeField` 或 React selector，不在组件中重复计算。

### 6.3 服务端校验与前端校验分工

建议将校验边界明确分层：

| 校验类型 | 示例 | 放置位置 |
| --- | --- | --- |
| 本地同步校验 | 必填、长度、数字范围、日期先后 | schema validator |
| 本地派生阻断 | 是否允许提交、缺失原因提示 | reaction |
| 远端异步校验 | 广告名查重、落地页安全扫描、素材合规性 | 服务端接口或异步 validator |
| 最终事实校验 | 权限、账户余额、平台准入、审核状态冲突 | 服务端 |

落地原则：

- 前端负责提升填写体验和提前发现错误，但不替代服务端最终裁决。
- 服务端拒绝时，前端应保留用户已填写内容，不重置 model。
- 本地 validator 的错误文案偏向填写指导，服务端错误文案偏向业务规则说明。

## 7. 接口契约与异常流

### 7.1 接口划分

建议至少提供以下接口：

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/ad-drafts/:id` | `GET` | 获取广告草稿详情，用于页面初始化与恢复编辑 |
| `/api/ad-drafts` | `POST` | 新建草稿 |
| `/api/ad-drafts/:id` | `PUT` | 保存草稿 |
| `/api/ad-drafts/:id/submit` | `POST` | 提交审核 |
| `/api/platform-specs` | `GET` | 获取平台素材规则与能力开关 |

### 7.2 DTO 设计建议

提交审核时，建议将 model 数据转换为后端稳定契约，而不是直接把内部字段名原样透传。

```ts
interface SubmitAdRequest {
  id: string;
  name: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'active' | 'paused';
  creative: {
    title: string;
    description: string;
    imageUrl: string;
    landingPageUrl: string;
  };
  targeting: {
    budget: number;
    dailyBudget: number;
    startDate: string;
    endDate: string;
    platforms: string[];
  };
}

interface FieldIssue {
  field: string;
  code: string;
  message: string;
}

interface SubmitAdResponse {
  success: boolean;
  adId?: string;
  issues?: FieldIssue[];
}
```

建议转换约束：

- `Date` 在出站时统一序列化为 ISO 字符串。
- 内部字段名如 `basic.name` 仅用于前端模型；对外 DTO 使用稳定业务语义字段。
- 枚举值与平台 ID 应由平台配置中心或常量表统一维护，避免前后端漂移。

### 7.3 服务端错误回填

`model-reaction` 的 `validationErrors` 来自本地校验，不建议直接改写内部状态去“伪造”服务端错误。推荐单独维护 `serverFieldErrors`，并在 UI 层与 `meta.error` 合并展示。

```ts
type ServerFieldErrors = Record<string, string[]>;

function toServerFieldErrors(issues: FieldIssue[] = []): ServerFieldErrors {
  return issues.reduce<ServerFieldErrors>((acc, issue) => {
    const key = issue.field;
    acc[key] ??= [];
    acc[key].push(issue.message);
    return acc;
  }, {});
}
```

推荐错误处理流：

1. `validateAll()` 通过后再请求服务端提交接口。
2. 服务端返回 `issues` 时，将其映射为 `serverFieldErrors`。
3. 表单字段展示时优先显示本地 `meta.error`，若本地无错误则显示服务端错误。
4. 用户再次编辑字段后，清除该字段对应的 `serverFieldErrors`，避免过期错误残留。

### 7.4 草稿保存与恢复

建议把“保存草稿”和“提交审核”分离：

- 保存草稿允许部分字段未完成，只要求通过最小可保存约束。
- 提交审核要求完整业务校验通过。
- 页面初始化时先拉取草稿 DTO，再执行一次 `setFields` 回填。
- 若回填数据来自旧版本 schema，模块层应提供兼容转换逻辑。

### 7.5 幂等与重试

对于保存与提交接口，建议增加如下保障：

- 保存草稿使用草稿 ID 做幂等更新。
- 提交审核使用请求 ID 或版本号避免重复提交。
- 网络重试仅针对幂等接口自动执行。
- 若服务端检测到版本冲突，应返回显式错误码并提示用户刷新或合并草稿。

## 8. 生命周期与资源管理

广告创编页、弹窗、抽屉等 UI 容器应拥有自己的 model 实例。

```tsx
function AdEditorRoute() {
  const [model] = useState(() => createAdDraftModel());

  useEffect(() => {
    return () => {
      model.dispose();
    };
  }, [model]);

  return <ModelProvider model={model}>{/* editor */}</ModelProvider>;
}
```

注意事项：

- 不建议使用模块级 singleton model 共享多个 React 树。
- owner 卸载时必须调用 `dispose()`，释放订阅、反应和未完成的验证任务。
- 测试中应在 `afterEach` 或测试结束路径调用 `dispose()`。
- 若需要重置表单，优先销毁旧 model 并创建新 model，避免 dirty 状态残留。

## 9. 非功能要求

### 9.1 性能

- 首屏进入编辑页时，应优先完成草稿加载与基础字段渲染，重量级预览区可以延迟加载。
- 对频繁联动字段开启适度 `debounceReactions`，避免输入过程重复计算。
- 大型素材列表、平台能力列表建议分页或虚拟滚动，不把全部状态塞入单个字段。
- 避免在 selector 中返回新的大对象；必要时使用 `useModelFields` 或配合 `shallow`。

### 9.2 可观测性

- 记录草稿保存成功率、提审成功率、字段级服务端拒绝率。
- 对提审失败原因做错误码聚合，便于分析阻塞点。
- 监控草稿加载耗时、保存耗时、提审接口耗时。
- 对 `reaction:error`、`validation:error` 的异常峰值建立告警。

### 9.3 安全与合规

- 落地页、图片地址、文案内容需要经过平台安全规则与内容审核服务。
- 文档、图片、链接等用户输入在展示层必须做安全转义或受控渲染。
- 关键操作如提审、撤回、审核回填需要记录审计日志。
- 若涉及多租户或代理商账户，接口层必须做租户隔离与权限校验。

### 9.4 可恢复性

- 草稿保存失败时不得丢失当前编辑内容。
- 页面刷新后应支持从最近一次成功保存的草稿恢复。
- 对网络闪断场景，允许用户保留本地未提交内容并再次重试。
- 审核失败回填时应保留历史阻断原因，帮助用户定向修改。

## 10. 测试方案

| 测试类型 | 覆盖重点 |
| --- | --- |
| Schema 单测 | 默认值、类型、必填、长度、枚举、数组数量 |
| 模块单测 | `setBasicInfo`、`setCreative`、`setTargeting`、`submitForAudit` |
| Reaction 单测 | `audit.ready`、`audit.blockReason` 等派生字段是否随依赖变化 |
| React 集成测试 | 字段输入、错误展示、dirty 状态、提交按钮流程 |
| 回归测试 | 提交 payload 字段映射、失败输入不会污染 `data` |

示例断言：

```ts
const model = createAdDraftModel();

const ok = await model.setField('basic.name', 'ab');
expect(ok).toBe(false);
expect(model.data['basic.name']).toBe('');
expect(model.getDirtyData()['basic.name']).toBe('ab');

model.dispose();
```

建议额外补充的测试样例：

- `targeting.endDate <= targeting.startDate` 时返回明确错误文案。
- `targeting.dailyBudget > targeting.budget` 时提交被阻断。
- 服务端返回字段错误后，重新编辑该字段会清除对应服务端错误。
- 草稿回填后 `audit.ready`、`audit.blockReason` 能正确重算。
- 多平台选择时，平台特有规则能正确启用或禁用。

## 11. 交付建议

推荐目录结构：

```text
src/
  models/
    ad-draft.model.ts
  modules/
    ad-draft.module.ts
  components/
    ad-creation-form.tsx
    fields/
      name-field.tsx
      creative-fields.tsx
      targeting-fields.tsx
  services/
    ad.service.ts
```

演进路径：

- 第一阶段：完成广告草稿 schema、基础字段组件和提审流程。
- 第二阶段：补充异步校验、创意预览、投放平台配置。
- 第三阶段：接入后端保存接口、草稿恢复、审核失败回填。
- 第四阶段：基于 `subscribe` 或 selector 增加实时预览、预算估算等派生能力。

## 12. 总结

基于 `model-reaction` 的广告创编系统应以 schema 作为数据契约，以模块方法作为业务入口，以 React 字段级订阅作为 UI 集成方式。在此基础上，完整方案还应覆盖跨字段业务约束、接口契约、服务端错误回填、草稿恢复、非功能要求与页面装配关系。这样才能让文档不仅解释“如何使用库”，也能真正指导广告创编系统的实施与交付。
