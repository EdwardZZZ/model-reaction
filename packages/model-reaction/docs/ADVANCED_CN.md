# 高级用法

[English Version](ADVANCED.md) | [文档导航](README_CN.md)

## 业务校验

模型保存转换后的字段值并运行声明的计算。必填、跨字段规则、服务端准入、
错误显示由应用函数或独立校验库负责。

```ts
interface Budget { total: number; daily: number }

function checkBudget(data: Readonly<Budget>): string | null {
  if (!Number.isFinite(data.total) || data.total < 100) return '总预算至少 100';
  if (!Number.isFinite(data.daily) || data.daily < 10 || data.daily > data.total) {
    return '日预算须在 10 与总预算之间';
  }
  return null;
}

function updateBudget(model: ModelReturn<Budget>, input: Partial<Budget>): string | null {
  const candidate = { ...model.data, ...input };
  const error = checkBudget(candidate);
  if (error) return error;
  model.setFields(input);
  return null;
}
```

若 transform 改变业务含义，先规范化候选再检查；schema 与业务入口可共享纯解析器。
输入预检不会自动检查之后的 computed 输出。可确保计算本身产生合法值、
落定后检查，或需要完整计算图准入时用独立候选模型评估。
不要把 transform 扩展成替代 validator 的框架。

编辑器也可以先提交不完整值，在 blur/提交时检查，并把错误保存在模型外。
条件校验就是普通业务分支。参见 [business-validation.ts](../examples/business-validation.ts)。

## 异步 action 与过期响应

`computed` 保持同步，请求放在 action 或业务服务中。
需要 `settled()` 跟踪时返回/等待请求。

```ts
let revision = 0;
const model = createModel({
  query: { type: 'string', default: '' },
  results: { type: 'array', default: [] as string[] },
  normalized: { type: 'string', reaction: {
    fields: ['query'],
    computed: ({ query }) => query.trim(),
    action: [async () => {
      const version = revision;
      const query = model.data.normalized;
      const results = await search(query);
      if (version !== revision) return;
      model.setField('results', results);
    }],
  } },
});
const off = model.subscribe((data) => data.query, () => { revision++; });
// owner 清理：revision++; off(); model.dispose();
```

输入改变时推进版本，保证响应恢复前已失效。
只比较当前文本无法处理 A → B → A；销毁时也需失效。
调度器取消未启动项，不能中断运行中的请求。按需使用服务超时或 AbortController。
[完整异步示例](../examples/async-action.ts) 包含清理。

级联计算同步完成，action 总在之后开始；规范化结果相等仍可启动 action 组。
需要限制请求频率时，在应用输入或服务边界处理防抖。

## 类型化错误事件

```ts
const off = model.on(ModelEvents.REACTION_ERROR, (error) => {
  console.error(error.field, error.message);
});
try {
  model.setFields(input);
} catch (error) {
  // 直接写入的 getter/transform/未知字段错误同步抛出。
}
```

reaction 错误是诊断事件，不是模型错误存储或业务校验结果。
action 失败后 `settled()` 仍会在受跟踪工作结束时完成，
需观察业务状态/错误事件判断能否提交。[API](API_CN.md#事件) 维护事件定义。

## 模型组织与推断

生命周期和依赖图一致的字段放在一个模型。聚焦 schema 片段在构造前组成平面对象，
字段名不能重复。独立编辑器使用独立模型，跨模型协调由应用负责；
独立计算结果由不同字段承载。

显式领域契约使用 `createModel<T>(schema)`，小型局部模型可使用 schema 推断。
`type` 与枚举 `values` 不校验运行时 payload。缺少默认值推断为包含 `undefined`，
有用的对象/数组默认值保留形状。API 输入先映射到已知字段，
参见 [广告创编配方](../examples/AD_CREATION_CN.md) 的 schema/DTO 边界。

## 性能与测试

相关输入用 `setFields`，读取使用窄订阅，计算保持纯函数并声明依赖。
依赖引擎不是事务或拓扑单次计算调度器；
菱形依赖在最终值之前可能计算中间值，action 会等待计算链落定。

测试业务边界、规范化、提交快照、过期请求、action 错误、owner 销毁和文本/IME 行为。
异步场景分别等待模型落定与应用检查。
仓库检查见 [AGENTS.md](../AGENTS.md)。
