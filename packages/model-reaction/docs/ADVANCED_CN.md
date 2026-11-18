# 高级用法

超出 README 快速上手范围的常用模式。

[English Version](ADVANCED.md) | 中文

[← 返回 README](../README_CN.md)

---

## 目录

- [异步验证](#异步验证)
- [自定义验证规则与消息](#自定义验证规则与消息)
- [类型化错误事件](#类型化错误事件)
- [条件验证与跨字段验证](#条件验证与跨字段验证)
- [字段转换与异步验证](#字段转换与异步验证)
- [等待异步操作](#等待异步操作)
- [Schema 类型推导](#schema-类型推导)
- [模型组织](#模型组织)
- [性能与错误处理](#性能与错误处理)
- [业务模型测试](#业务模型测试)

---

## 异步验证

```typescript
import { createModel } from 'model-reaction';
import { Rule, ValidationRules } from 'model-reaction/validation';

interface AsyncUser {
  name: string;
  username: string;
}

const asyncUniqueRule = new Rule(
  'asyncUnique',
  '用户名已存在',
  async (value: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(value !== 'admin'), 100);
    });
  }
);

const asyncUserModel = createModel<AsyncUser>({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('用户名不能为空')],
    default: '',
  },
  username: {
    type: 'string',
    validator: [
      ValidationRules.required.withMessage('账号不能为空'),
      asyncUniqueRule,
    ],
    default: '',
  },
}, { asyncValidationTimeout: 3000 });

const ok = await asyncUserModel.setField('username', 'admin');
console.log(ok); // false
console.log(asyncUserModel.validationErrors);
console.log(asyncUserModel.getDirtyData());
```

## 自定义验证规则与消息

```typescript
import { createModel } from 'model-reaction';
import { Rule } from 'model-reaction/validation';

const customRule = new Rule(
  'custom',
  '不符合自定义规则',
  (value: any) => value === 'custom'
);

const model = createModel({
  field: {
    type: 'string',
    validator: [customRule.withMessage('字段值必须为 "custom"')],
    default: '',
  },
});
```

## 类型化错误事件

```typescript
import { createModel, ModelEvents } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';

const model = createModel({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('姓名不能为空')],
    default: '',
  },
});

const unsubscribeValidation = model.on(
  ModelEvents.VALIDATION_ERROR,
  (error) => console.error(`验证错误: ${error.field} - ${error.message}`)
);
const unsubscribeMissing = model.on(
  ModelEvents.FIELD_NOT_FOUND,
  (error) => console.error(`字段不存在: ${error.field}`)
);

unsubscribeValidation();
unsubscribeMissing();
```

## 条件验证与跨字段验证

可以定义仅在满足特定条件时才执行的规则，也可以通过 `data` 参数读取其他字段的值进行交叉验证。

```typescript
import { createModel } from 'model-reaction';
import { ValidationRules, Rule } from 'model-reaction/validation';

const model = createModel({
  hasDiscount: { type: 'boolean', default: false },
  discountCode: {
    type: 'string',
    validator: [
      // 条件验证：仅在 hasDiscount 为 true 时执行。`.when(predicate)`
      // 是附加 `condition` 的简洁写法。
      ValidationRules.required
        .withMessage('启用折扣时，折扣码为必填项')
        .when((data) => data.hasDiscount === true),
      // 跨字段验证：通过 `data` 读取其他字段
      new Rule(
        'validCode',
        '无效的折扣码',
        (value, data) => {
          if (data?.hasDiscount && value !== 'PROMO2024') return false;
          return true;
        }
      ),
    ],
    default: '',
  },
});
```

## 字段转换与异步验证

```typescript
import { createModel } from 'model-reaction';
import { Rule } from 'model-reaction/validation';

const asyncModel = createModel({
  field: {
    type: 'string',
    transform: (value: string) => value.toUpperCase(),
    validator: [
      new Rule(
        'asyncValidator',
        '异步验证失败',
        async (value: string) => value.length > 3
      ).withMessage('字段长度必须大于 3 个字符'),
    ],
    default: '',
  },
});
```

## 等待异步操作

`await setField` 等待该字段的校验与提交，即使未使用防抖，下游 reaction 与 action
仍可能在执行。请在 action 外使用 `settled()`：

```typescript
interface Schema {
  source: string;
  target: string;
}

const model = createModel<Schema>({
  source: { type: 'string', default: '' },
  target: {
    type: 'string',
    default: '',
    reaction: {
      fields: ['source'],
      computed: (vals) => vals.source.toUpperCase(),
    },
  },
}, { debounceReactions: 100 });

await model.setField('source', 'hello');

console.log(model.getField('target')); // ''（防抖未到点）

await model.settled();

console.log(model.getField('target')); // 'HELLO'
```

## Schema 类型推导

`createModel` 支持两种调用方式：

```ts
// 1. 显式传入类型参数（复杂模型推荐）：
const user = createModel<User>(userSchema);

// 2. 从 schema 字面量推导：
const m = createModel({
  name: { type: 'string', default: '' },
  age:  { type: 'number', default: 0 },
  ok:   { type: 'boolean', default: false },
});
// m.data 类型为 { name: string; age: number; ok: boolean }

// 没有默认值的字段会额外包含 undefined。
const optional = createModel({ note: { type: 'string' } });
// optional.data.note 类型为 string | undefined

// `values` 为 enum 字段推导出具体联合类型；运行时校验仍由 validator 提供。
const status = createModel({
  state: {
    type: 'enum',
    values: ['draft', 'published'] as const,
    default: 'draft',
  },
});
// status.data.state 类型为 'draft' | 'published'
```

Schema 推导反映运行时值：默认值会绕过校验，因此与 `type` 不匹配的默认值也会
包含在推导类型里。显式调用 `createModel<T>` 表示调用方保证 schema 能初始化该类型。
对象或数组没有可推导的默认值时，建议显式提供数据类型。

## 模型组织

共享生命周期和依赖图的字段放在同一个模型中。大型 Schema 按职责拆成模块，再
展开为单个扁平 Schema。片段之间的字段名必须唯一：对象展开会静默覆盖前面的定义。
各自拥有独立生命周期的表单可以使用不同模型；跨模型协调由应用负责。

把复用校验提取为具名规则，把编排放进业务函数。`computed` 保持同步、纯计算，
所有输入都在 `reaction.fields` 中声明；独立计算结果拆成不同字段。
异步工作和副作用放进 action，执行规则见 [action 契约](API_CN.md#action-队列)。

共享领域契约使用显式接口，小型局部模型可以使用 Schema 推导。
`FieldSchema.type` 是元数据，不是运行时校验；非类型化输入仍需 validator。
写入前把 API payload 映射为已知字段。[广告创编示例](../examples/AD_CREATION_CN.md)
展示了 Schema 组合与 DTO 转换。

## 性能与错误处理

- 廉价规则放在前面。字段内顺序执行、首错停止；不同字段可以并行校验。
- 在服务边界缓存可复用的远端校验，并按服务耗时配置 `asyncValidationTimeout`。
- 远端校验不应逐键触发时，在调用 `setField` 前做输入防抖。
  `debounceReactions` 只延迟派生计算。
- 使用字段或 selector 订阅缩小更新范围。Hook 选择、draft 缓冲与所有权统一见
  [React 绑定](REACT_CN.md)。
- 写入返回 `false` 表示校验失败，Promise reject 属于另一类异常。
  读取 `validationErrors[field]`，或从 `model-reaction/validation` 导入
  `formatValidationErrors` 汇总错误。用类型化错误事件记录日志，cleanup 中解绑。
  文本绑定在 `showError` 时展示 `writeError?.message ?? meta.error`。

## 业务模型测试

测试业务边界：规则上下限、transform、无效输入保留在 dirty data、计算值被拒、
异步旧结果以及 reaction 链。提交流程先等待当前工作，再调用 `validateAll()`，
待其返回后读取 payload；调用内部已等待校验触发的后续工作。应用负责服务端提交时，补充
服务端拒绝与重试场景。

React 集成检查覆盖校验在途时继续编辑、字段级更新与 owner 清理。
仓库贡献所需检查统一维护在 [AGENTS.md](../AGENTS.md)。
