# Schema 组合：保留精确类型的 Recipe

[English](SCHEMA_COMPOSITION.md) | 中文 | [示例导航](README_CN.md)

把身份和订单拆成独立的 Schema 工厂，再合并创建模型。枚举值、默认值和校验共用
同一份字面量列表；对象与数组默认值在每次调用工厂时重新创建。数据类型完全从
Schema 推导，业务更新函数独立导出。

这份 Recipe 对应 AI-11 中的三类失败：

| 失败 | 原因 | 修复 |
| --- | --- | --- |
| `status` 变成 `string` | 枚举默认值被宽化为 string，读值类型又包含默认值类型 | 仅对枚举列表使用 `as const`，默认值取 `statusValues[0]` |
| 行元素多出 `readonly`，数组成为 tuple | 对整个 Schema 使用 `as const` 会递归影响默认值 | 用 `satisfies` 检查片段，保留普通对象和数组的推导 |
| 非法状态仍能提交 | `type: 'enum'` 和 `values` 是元数据，不执行运行时校验 | 为 status 配置接受 unknown 的 validator |

AI-11 对行元素做精确类型相等检查；readonly 形状失败不表示所有应用都不能使用它。
本 Recipe 按该任务要求保留 `{ sku: string; qty: number }[]`。

## 直接使用

实现以这四份可编译源码为准，复制时保持它们在同一目录：

| 文件 | 职责 |
| --- | --- |
| [identity-schema.ts](schema-composition/identity-schema.ts) | name、status、note、address 及状态校验 |
| [order-schema.ts](schema-composition/order-schema.ts) | lines 与独立的数组默认值 |
| [business-model.ts](schema-composition/business-model.ts) | 合并片段，返回原生模型，导出推导类型 |
| [operations.ts](schema-composition/operations.ts) | 修改城市、追加行，通过顶层替换触发更新 |

```ts
import { createBusinessModel } from './schema-composition/business-model.js';
import { appendLine, changeCity } from './schema-composition/operations.js';

async function main() {
  const model = createBusinessModel();
  try {
    const citySaved = await changeCity(model, 'Shanghai');
    const lineSaved = await appendLine(model, { sku: 'pen', qty: 2 });
    if (citySaved && lineSaved) {
      console.log(model.data);
    }
  } finally {
    model.dispose();
  }
}

void main().catch(console.error);
```

这是模块内调用示意；完整可运行入口见 [runner.ts](schema-composition/runner.ts)。
实现只从 `model-reaction` 公开入口导入，不需要额外的 Schema helper 或核心 API。

## 为什么这样组合

### 1. 枚举列表同时约束默认值与校验

身份片段中的关键配置：

```ts
import type { FieldSchema } from 'model-reaction';

const statusValues = ['draft', 'published'] as const;
const statusField = {
  type: 'enum',
  values: statusValues,
  default: statusValues[0],
  validator: [{
    type: 'business-status',
    message: 'Status must be draft or published',
    validate: (value: unknown) => statusValues.some(status => status === value),
  }],
} satisfies FieldSchema<'enum'>;
```

上面单独展示 status 字段的写法，完整身份片段在 `identity-schema.ts`。
`statusValues[0]` 的类型是 `'draft'`，因此默认值不会向枚举联合里加入 `string`。
validator 复用同一个列表，避免允许值在元数据和校验里各维护一遍。
模型存续期间不要修改该列表或其他已使用的 Schema 配置。

片段结尾的 `satisfies Record<string, FieldSchema>` 检查 Schema 结构，并保留实际
字段类型。它不会自动把所有默认值收窄为字面量；因此枚举默认值仍需上述写法。
也不要将工厂返回值注解为宽泛的 `Record<string, FieldSchema>`，那会丢失具体字段信息。
推导规则以 [API 文档](../docs/API_CN.md#数据类型推导)为准。

### 2. 可变默认值在工厂里创建

`createIdentitySchema()` 每次创建新的 address，
`createOrderSchema()` 每次创建新的 lines 数组及其行对象。模型工厂每次调用这两个
片段工厂，所以两个实例不共享这些默认值对象。只共享保持固定的枚举列表。

不要对整个片段使用 `as const` 来保留 `type` 标签；`satisfies` 已能检查标签，
整段常量断言还会影响对象属性和数组元素。这里保留的精确类型如下：

| 字段 | 推导类型 |
| --- | --- |
| name | `string` |
| status | `'draft' \| 'published'` |
| note | `string \| undefined` |
| address | `{ city: string }` |
| lines | `{ sku: string; qty: number }[]` |

note 省略 default，读值包含 undefined。`BusinessModel` 取工厂的 `ReturnType`，
`BusinessData` 取模型的 `data` 类型，追加行的参数取 `BusinessData['lines'][number]`，
没有再手写一份完整数据 interface，也没有用 `createModel<T>` 覆盖推导。

### 3. 更新业务数据时替换顶层字段

`changeCity` 提交新的 address 对象，`appendLine` 提交新的数组并复制传入行对象。
返回值沿用 `setField` 的 `Promise<boolean>`；调用方处理校验失败或异常。
虽然嵌套对象类型可变，模型仍只观察顶层替换，不应原地修改 city 或调用 `lines.push`。
若以后加入 reactions，业务需要完整派生结果时再在外部等待 `model.settled()`。

片段字段名保持唯一，在 `createModel` 前完成合并。实例创建后不修改 Schema；
新配置使用新的片段和模型实例。模型 owner 负责 `dispose()`，订阅 owner 负责取消订阅。

## 编译与验证

从仓库根目录运行：

```bash
pnpm --filter model-reaction run typecheck
pnpm --filter model-reaction run example:schema
```

[type-contract.ts](schema-composition/type-contract.ts) 随示例项目编译，检查上述精确
类型，并用编译期负向用例确认错误状态、错误 qty 类型及未知字段不能写入。
其中的 `@ts-expect-error` 只用于预期失败的类型断言，不在实现里绕过诊断；
该文件的检查函数不执行，不需要复制到业务应用。

runner 验证顶层替换、订阅次数、默认值引用独立和状态规则。它创建并释放自己的模型，
导入四份实现文件本身不会创建实例或运行示例。示例通过既有 `examples` 打包范围交付。

**初次验证（2026-11-20）**：四份实现还在独立消费项目中通过了冻结的 AI-11
类型、运行时与接入约束验收，包括外部非法状态返回 false、保留已提交值，以及第二个
实例不受影响；额外的精确类型文件与 runner 也在该消费项目编译、运行通过。
验证使用 TypeScript 5.9.3 和首轮基线本地 tarball，SHA-256 为
`ecb40d684565d24b91bb5662109a7b1d52c1284fbc15f4733b201e362ca81652`。
该包标为 1.2.0 并含 unreleased 行为，不能由版本号推定线上同版本包的行为。

上述为 Recipe 的编译与行为验证。随后独立重采样中，AI-11 三次均首次通过，
三次均实际阅读并采用此 Recipe；首轮成绩单独保留。每项仅三个样本，结果限于该场景。
