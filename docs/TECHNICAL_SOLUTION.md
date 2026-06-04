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

## 7. 生命周期与资源管理

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

## 8. 测试方案

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

## 9. 交付建议

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

## 10. 总结

基于 `model-reaction` 的广告创编系统应以 schema 作为数据契约，以模块方法作为业务入口，以 React 字段级订阅作为 UI 集成方式。该方案能保证失败输入与可信数据隔离、派生状态自动更新、模块逻辑集中维护，并通过显式生命周期管理降低大型表单系统的状态复杂度。
