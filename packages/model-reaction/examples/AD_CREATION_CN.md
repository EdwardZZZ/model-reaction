# 广告创编场景

[← 示例导航](README_CN.md)

本例保留广告创编的字段划分、提审与草稿恢复设计。字段限制、状态和接口均为示例
业务约定，不代表真实广告平台规范。公开行为以 [API](../docs/API_CN.md) 为准；
输入绑定、owner 生命周期和提交前等待统一见 [React 绑定](../docs/REACT_CN.md)。

## 模块与业务约束

各业务模块导出字段定义对象，用对象展开组合成 `AdCreation`，再交给 `createModel`。
页面 owner 管理生成的编辑实例；业务模块负责字段规则、批量写入、DTO 转换与接口
编排；组件负责输入和展示。各定义片段共享扁平字段空间，不能出现重复字段名。

| 模块 | 字段 |
| --- | --- |
| 基础 `basic` | `id`、`name`、`status` |
| 出价与预算 `bidding` | `budget`、`dailyBudget` |
| 投放 `targeting` | `startDate`、`endDate`、`platforms` |
| 创意 `creative` | `title`、`description`、`imageUrl`、`landingPageUrl` |
| 提示 `audit` | `ready`、`blockReason` |

| 约束 | 本例规则 | 最终负责方 |
| --- | --- | --- |
| 文本 | 名称 3–50 字符，标题最多 20 字符，描述最多 100 字符，均必填 | 本地 validator + 服务端 |
| 预算 | 有限数值，总预算至少 100，日预算至少 10 且不大于总预算；币种和金额单位由业务约定 | 本地 validator + 服务端 |
| 日期 | 日期有效，结束晚于开始 | 本地 validator + 服务端 |
| 平台与素材 | 至少选择一个平台；URL 基础格式可在本地检查，素材规格与落地页安全按平台规则校验 | 服务端最终检查 |
| 提审 | 仅 `draft` 可请求提审，服务端接受后变为 `pending` | 业务模块 + 服务端 |

审核中编辑权限、批准后启停等状态迁移由业务模块和服务端控制；字段枚举校验不能
替代迁移检查。`ready` 只表示已提交字段的必要内容齐全，不包含 dirty input、
在途请求、完整校验或服务端检查，不能单独作为允许提审的依据。

## Schema 组合

`bidding`、`targeting`、`creative` 等模块都是当前 API 接受的字段定义对象。
用 `satisfies Model` 检查定义，并保留具体字段类型供 `createModel` 推导。
组合只需 `{ ...bidding, ...targeting, ...creative }`；本例额外组合基础和提示字段，
所有字段在同一个实例中共享校验快照、reaction 依赖图与 `settled()`。

```ts
import { createModel, type Model } from 'model-reaction';
import { Rule, ValidationRules } from 'model-reaction/validation';

const statuses =
  ['draft', 'pending', 'approved', 'rejected', 'active', 'paused'] as const;
const validDate = new Rule('date', '日期无效', (value) =>
  value instanceof Date && Number.isFinite(value.getTime()));
const finiteAmount = new Rule('amount', '预算必须为有限数值', (value) =>
  typeof value === 'number' && Number.isFinite(value));
const httpUrl = new Rule('url', '请输入 HTTP(S) URL', (value) => {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
});
const withinBudget = new Rule('budget', '日预算不能大于总预算', (value, data) =>
  typeof value === 'number' && typeof data?.budget === 'number' &&
  value <= data.budget);
const afterStart = new Rule('dateOrder', '结束时间必须晚于开始时间', (value, data) =>
  value instanceof Date && data?.startDate instanceof Date &&
  value.getTime() > data.startDate.getTime());

function createAdDraftModel(id: string, now = Date.now()) {
  const basic = {
    id: { type: 'string', default: id, validator: [ValidationRules.required] },
    name: { type: 'string', default: '', validator: [
      ValidationRules.required, ValidationRules.minLength(3), ValidationRules.maxLength(50),
    ] },
    status: { type: 'enum', values: statuses, default: 'draft' as const,
      validator: [new Rule('status', '状态无效', (value) => statuses.includes(value))] },
  } satisfies Model;

  const bidding = {
    budget: { type: 'number', default: 1000,
      validator: [finiteAmount, ValidationRules.min(100)] },
    dailyBudget: { type: 'number', default: 100,
      validator: [finiteAmount, ValidationRules.min(10), withinBudget] },
  } satisfies Model;

  const targeting = {
    startDate: { type: 'date', default: new Date(now), validator: [validDate] },
    endDate: { type: 'date', default: new Date(now + 30 * 86400000),
      validator: [validDate, afterStart] },
    platforms: { type: 'array', default: [] as string[], validator: [
      new Rule('platforms', '至少选择一个平台', (value) =>
        Array.isArray(value) && value.length > 0 &&
        value.every((item) => typeof item === 'string' && item.length > 0)),
    ] },
  } satisfies Model;

  const creative = {
    title: { type: 'string', default: '',
      validator: [ValidationRules.required, ValidationRules.maxLength(20)] },
    description: { type: 'string', default: '',
      validator: [ValidationRules.required, ValidationRules.maxLength(100)] },
    imageUrl: { type: 'string', default: '', validator: [httpUrl] },
    landingPageUrl: { type: 'string', default: '', validator: [httpUrl] },
  } satisfies Model;

  const audit = {
    ready: { type: 'boolean', default: false, reaction: {
      fields: ['name', 'title', 'description', 'imageUrl', 'landingPageUrl', 'platforms'],
      computed: (v) => Boolean(v.name && v.title && v.description &&
        v.imageUrl && v.landingPageUrl && v.platforms?.length),
    } },
    blockReason: { type: 'string', default: '', reaction: {
      fields: ['ready'],
      computed: (v) => v.ready ? '' : '请补全名称、创意内容和投放平台',
    } },
  } satisfies Model;

  const AdCreation = {
    ...basic,
    ...bidding,
    ...targeting,
    ...creative,
    ...audit,
  };

  return createModel(AdCreation, { debounceReactions: 16 });
}

type AdDraftModel = ReturnType<typeof createAdDraftModel>;
type AdDraft = AdDraftModel['data'];
```

本例将定义片段集中写在创建函数中，便于复制运行，并按传入的 ID 与时间设置默认值。
实际项目可按模块导出静态片段，依赖动态默认值的片段通过工厂生成，再在创建入口展开
组合。`AdDraftModel` 与 `AdDraft` 从返回类型提取，无需另写完整字段接口或
`Model<Pick<...>>`。

修改投放组合时使用 `setFields`，让跨字段规则看到同批候选值。仅修改 `budget`
不会自动重验 `dailyBudget`，仅修改 `startDate` 也不会重验 `endDate`；可在业务入口
显式同批写入相关字段，提审前必须执行完整校验。若需要“非法组合整体不提交”，使用
业务预检或临时模型；`setFields` 本身不是事务。

数字文本输入需配合 Schema transform 与 `useDraftField`，转换和异常显示契约见
[字段类型契约](../docs/REACT_CN.md#字段类型契约)。本例 Schema 接收模型类型的值，
没有定义字符串转数字或日期的应用解析策略。

## 提审与 DTO

先结束当前编辑写入，等待模型落定、完整校验并等待其后续计算，然后读取 payload。
请求期间禁止继续编辑，并处理重复点击；请求失败保持 `draft`，收到成功响应后才
更新 `pending`。生产应用以服务端返回的实体和版本为准。

模块划分与接口结构分别维护：本例预算字段在 `bidding` 中定义，出站时按服务端契约
放进 `targeting`。`toSubmitDTO` 显式组装接口字段，并将日期转换为 ISO 字符串。

```ts
interface SubmitAdRequest {
  id: string;
  name: string;
  status: 'draft';
  requestId: string;
  version: number;
  creative: Pick<AdDraft, 'title' | 'description' | 'imageUrl' | 'landingPageUrl'>;
  targeting: {
    budget: number;
    dailyBudget: number;
    startDate: string;
    endDate: string;
    platforms: string[];
  };
}
interface FieldIssue { field: string; code: string; message: string }
interface SubmitAdResponse { success: boolean; issues?: FieldIssue[] }

function toSubmitDTO(data: AdDraft, requestId: string,
  version: number): SubmitAdRequest {
  return {
    id: data.id, name: data.name, status: 'draft', requestId, version,
    creative: {
      title: data.title, description: data.description,
      imageUrl: data.imageUrl, landingPageUrl: data.landingPageUrl,
    },
    targeting: {
      budget: data.budget, dailyBudget: data.dailyBudget,
      startDate: data.startDate.toISOString(), endDate: data.endDate.toISOString(),
      platforms: [...data.platforms],
    },
  };
}

async function submitAd(model: AdDraftModel,
  api: (request: SubmitAdRequest) => Promise<SubmitAdResponse>,
  requestId: string, version: number): Promise<SubmitAdResponse> {
  await model.settled();
  if (model.data.status !== 'draft') throw new Error('当前状态不能提审');
  const valid = await model.validateAll();
  await model.settled();
  if (!valid || Object.keys(model.getDirtyData()).length ||
      Object.values(model.validationErrors).some((errors) => errors.length > 0)) {
    throw new Error('请先修正本地校验错误');
  }
  const result = await api(toSubmitDTO(model.data, requestId, version));
  if (result.success && !await model.setField('status', 'pending')) {
    throw new Error('提审已接受，但本地状态同步失败，请重新获取详情');
  }
  return result;
}
```

本例未包含 UI 锁定和网络错误展示；调用方用 `try` / `catch` / `finally` 管理提交状态。
`requestId` 与版本由应用维护，不使用内部 action 版本作为业务幂等键。

| 示例接口 | 用途 |
| --- | --- |
| `POST /api/ad-drafts`、`GET /api/ad-drafts/:id` | 创建草稿、获取详情与版本 |
| `PUT /api/ad-drafts/:id` | 按草稿 ID 幂等保存 |
| `POST /api/ad-drafts/:id/submit` | 按请求 ID 和版本提审 |
| `GET /api/platform-specs` | 获取平台规格与枚举 |

服务端 `issues` 映射为应用自己的 `serverFieldErrors`，不要修改模型内部错误。
将嵌套 DTO 路径显式映射到扁平字段名，未知路径作为表单级错误。
本地无错误时展示服务端字段错误，重新编辑后清除对应旧错误。网络重试复用幂等键，
版本冲突由应用处理刷新或合并。

## 草稿保存与恢复

保存草稿允许不完整输入，与完整提审 DTO 分开定义。仅保存 `model.data` 会丢失
无效输入；只合并 dirty data 仍不能保留转换前文本或 transform 抛错后的文本。
应用保存带 Schema 版本的草稿记录，至少包括：

- 已提交的可编辑字段，按字段类型序列化日期等值。
- `getDirtyData()` 中的失败候选值，保留 NaN 等需要特殊编码的值。
- UI 当前编辑文本（包括在途文本和转换失败文本），由输入绑定层按需维护。

恢复时先迁移旧版本字段、解析日期并过滤未知 key，再通过写入 API 回填 editable
字段；把保存的失败候选值重新校验，让模型重新生成 dirty 和 errors，不直接注入
内部记录。最后恢复 UI 文本，`ready` / `blockReason` 由 reaction 重算。
需要持久恢复所有字段的已提交基线时，在构造阶段按保存值提供默认值，再显式校验；
默认值未经校验这一事实仍须由恢复流程处理。浏览器本地草稿与服务端草稿的保留范围
由应用约定。

## 场景验证

覆盖名称边界、非法 URL / 日期、预算组合、平台为空、dirty input 恢复、提审前
reaction 落定、服务端拒绝时状态不变、重复提交及版本冲突。挂载页面后检查异步
校验期间继续编辑和 owner 销毁。库级检查命令统一见 [AGENTS.md](../AGENTS.md)。
