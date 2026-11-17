# 广告创编场景

[← 示例导航](README_CN.md)

本例展示字段模块、业务校验、提审 DTO 和草稿恢复。规则为示例约定，
不代表真实广告平台规范。公开契约见 [API](../docs/API_CN.md)，
输入与生命周期见 [React](../docs/REACT_CN.md)。

## 模块与业务边界

字段定义片段通过对象展开组成平面 schema；模块名不进入字段路径。
owner 管理模型，业务函数管理准入/状态迁移/DTO，组件管理文本与反馈。
片段中的字段名必须唯一。

| 模块 | 字段 |
| --- | --- |
| 基础 | `id`、`name`、`status` |
| 预算 | `budget`、`dailyBudget` |
| 投放 | `startDate`、`endDate`、`platforms` |
| 创意 | `title`、`description`、`imageUrl`、`landingPageUrl` |
| 提示 | `ready`、`blockReason` |

必填、文本长度、预算组合、日期顺序和 URL 格式在业务检查中实现，
服务端负责最终规则。类型标签和枚举 `values` 不校验运行时输入。
`ready` 仅提示必要内容齐全，不能独自作为允许提审的依据。

## Schema 组合

```ts
import { createModel, type Model } from 'model-reaction';

const statuses = ['draft', 'pending', 'approved', 'rejected', 'active', 'paused'] as const;

function createAdDraftModel(id: string, now = Date.now()) {
  const basic = {
    id: { type: 'string', default: id },
    name: { type: 'string', default: '' },
    status: { type: 'enum', values: statuses, default: 'draft' as const },
  } satisfies Model;
  const bidding = {
    budget: { type: 'number', default: 1000 },
    dailyBudget: { type: 'number', default: 100 },
  } satisfies Model;
  const targeting = {
    startDate: { type: 'date', default: new Date(now) },
    endDate: { type: 'date', default: new Date(now + 30 * 86400000) },
    platforms: { type: 'array', default: [] as string[] },
  } satisfies Model;
  const creative = {
    title: { type: 'string', default: '' },
    description: { type: 'string', default: '' },
    imageUrl: { type: 'string', default: '' },
    landingPageUrl: { type: 'string', default: '' },
  } satisfies Model;
  const audit = {
    ready: { type: 'boolean', default: false, reaction: {
      fields: ['name', 'title', 'description', 'imageUrl', 'landingPageUrl', 'platforms'],
      computed: (v) => Boolean(v.name && v.title && v.description &&
        v.imageUrl && v.landingPageUrl && v.platforms?.length),
    } },
    blockReason: { type: 'string', default: '', reaction: {
      fields: ['ready'], computed: (v) => v.ready ? '' : '请补全名称、创意和平台',
    } },
  } satisfies Model;
  return createModel({ ...basic, ...bidding, ...targeting, ...creative, ...audit });
}

type AdDraftModel = ReturnType<typeof createAdDraftModel>;
type AdDraft = AdDraftModel['data'];
```

动态默认值由工厂创建，静态片段可拆成独立模块。
数字/日期输入在应用解析为模型值后写入，或配置纯 transform；
需要保留转换前文本格式时，由应用控件维护本地文本。

## 独立业务检查

```ts
function isHttpUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

function checkAd(data: AdDraft): Partial<Record<keyof AdDraft, string>> {
  const errors: Partial<Record<keyof AdDraft, string>> = {};
  if (!data.id) errors.id = '缺少草稿 ID';
  if (!statuses.includes(data.status)) errors.status = '状态无效';
  if (data.name.length < 3 || data.name.length > 50) errors.name = '名称须为 3–50 字符';
  if (!data.title || data.title.length > 20) errors.title = '标题须为 1–20 字符';
  if (!data.description || data.description.length > 100) errors.description = '描述须为 1–100 字符';
  if (!Number.isFinite(data.budget) || data.budget < 100) errors.budget = '总预算至少 100';
  if (!Number.isFinite(data.dailyBudget) || data.dailyBudget < 10 ||
      data.dailyBudget > data.budget) errors.dailyBudget = '日预算须在 10 与总预算之间';
  if (!(data.startDate instanceof Date) || !Number.isFinite(data.startDate.getTime())) {
    errors.startDate = '开始日期无效';
  }
  if (!(data.endDate instanceof Date) || !Number.isFinite(data.endDate.getTime())) {
    errors.endDate = '结束日期无效';
  } else if (!errors.startDate && data.endDate <= data.startDate) {
    errors.endDate = '结束日期必须晚于开始日期';
  }
  if (!data.platforms.length || data.platforms.some((platform) => !platform)) {
    errors.platforms = '请选择有效平台';
  }
  if (!isHttpUrl(data.imageUrl)) errors.imageUrl = '图片须为 HTTP(S) URL';
  if (!isHttpUrl(data.landingPageUrl)) errors.landingPageUrl = '落地页须为 HTTP(S) URL';
  return errors;
}
```

长度按 JavaScript `string.length`，本例不自动 trim。
本函数接受已解析的类型化 `AdDraft`；未经信任的 JSON 还需在入口检查结构和类型。
修改关联预算用 `setFields`，在业务入口预检整个候选组合，或保存不完整编辑值，
在 blur/提审时调用 `checkAd`。`setFields` 本身不拒绝业务不合格值，也不是事务。

## 提审与 DTO

暂停编辑并阻止重复提交，确认输入层没有尚未应用的文本/写入异常。
等待 model 落定，检查同一快照后生成 payload。

```ts
function toSubmitDTO(data: AdDraft, requestId: string, version: number) {
  const { ready: _ready, blockReason: _blockReason, ...fields } = data;
  return {
    ...fields,
    status: 'draft' as const,
    startDate: fields.startDate.toISOString(),
    endDate: fields.endDate.toISOString(),
    platforms: [...fields.platforms],
    requestId,
    version,
  };
}

type SubmitAdRequest = ReturnType<typeof toSubmitDTO>;
interface FieldIssue { field: string; code: string; message: string }
interface SubmitAdResponse { success: boolean; issues?: FieldIssue[] }

async function submitAd(model: AdDraftModel,
  api: (request: SubmitAdRequest) => Promise<SubmitAdResponse>,
  requestId: string, version: number): Promise<SubmitAdResponse> {
  await model.settled();
  const snapshot = model.data;
  if (snapshot.status !== 'draft') throw new Error('当前状态不能提审');
  if (Object.keys(checkAd(snapshot)).length) throw new Error('请先修正业务错误');
  const response = await api(toSubmitDTO(snapshot, requestId, version));
  if (response.success) model.setField('status', 'pending');
  return response;
}
```

调用方用 `try/catch/finally` 管理提交状态和网络错误，
在 owner 存活且仍对应该实体时回填；销毁或切换实体后不执行上述本地回写。
请求失败保持 `draft`，服务端成功后才回填 `pending`。
幂等请求 ID 与业务版本由应用维护，不能借用内部 action 版本。
已接受但本地同步失败时重新获取详情，避免当作失败重复提交。

服务端 `issues.field` 使用扁平键，映射到应用字段错误；
未知键/元信息问题作为表单级错误。输入改变时清除过期错误。
相同 payload 重试用相同请求 ID，编辑后提审使用新 ID；版本冲突由应用处理。

## 草稿保存与恢复

模型现在可以保存不完整字段值。应用序列化可编辑 `data`，
排除由 reaction 重算的 `ready/blockReason`。日期和 NaN 等值需明确编码。
当数字转换丢失原始格式，或 transform 抛错导致文本未提交时，
另存 UI 文本和 schema 版本。

恢复时迁移版本、过滤未知键、解析字段类型，再用 `setFields` 恢复可编辑值并等待
`settled()`。如果使用默认值恢复，默认值直接播种，不执行 transform。
纯显示的文本恢复由输入层管理，模型 setter 会同步提交字段值。
业务检查在恢复后或提交时显式运行。

## 场景验证

覆盖长度/类型、非法 URL/日期、预算组合、平台内容、平面 DTO、转换失败文本恢复、
提审快照、服务端拒绝、重复提交、版本冲突和 owner 销毁。
库级检查见 [AGENTS.md](../AGENTS.md)。
