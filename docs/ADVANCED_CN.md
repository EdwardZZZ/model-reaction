# 高级用法

超出 README 快速上手范围的常用模式。

[← 返回 README](../README_CN.md)

---

## 目录

- [异步验证](#异步验证)
- [自定义验证规则与消息](#自定义验证规则与消息)
- [统一错误处理](#统一错误处理)
- [条件验证与跨字段验证](#条件验证与跨字段验证)
- [字段转换与异步验证](#字段转换与异步验证)
- [等待异步操作](#等待异步操作)
- [Schema 类型推导](#schema-类型推导)

---

## 异步验证

```typescript
import { createModel, Rule, ValidationRules } from 'model-reaction';

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
import { createModel, Rule, ErrorHandler } from 'model-reaction';

const errorHandler = new ErrorHandler();

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
}, { errorHandler });
```

## 统一错误处理

```typescript
import { createModel, ValidationRules, ErrorHandler, ErrorType } from 'model-reaction';

const errorHandler = new ErrorHandler();

errorHandler.onError(ErrorType.VALIDATION, (error) => {
  console.error(`验证错误: ${error.field} - ${error.message}`);
});

errorHandler.onError(ErrorType.FIELD_NOT_FOUND, (error) => {
  console.error(`字段不存在: ${error.field}`);
});

errorHandler.onError(ErrorType.UNKNOWN, (error) => {
  console.error(`未知错误: ${error.message}`);
});

const model = createModel({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('姓名不能为空')],
    default: '',
  },
}, { errorHandler });
```

## 条件验证与跨字段验证

可以定义仅在满足特定条件时才执行的规则，也可以通过 `data` 参数读取其他字段的值进行交叉验证。

```typescript
import { createModel, ValidationRules, Rule } from 'model-reaction';

const model = createModel({
  hasDiscount: { type: 'boolean', default: false },
  discountCode: {
    type: 'string',
    validator: [
      // 条件验证：仅在 hasDiscount 为 true 时执行
      {
        ...ValidationRules.required.withMessage('启用折扣时，折扣码为必填项'),
        condition: (data) => data.hasDiscount === true,
      },
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
import { createModel, Rule } from 'model-reaction';

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

使用异步验证或带防抖的反应时，仅 `await setField` 不足以保证所有副作用都已执行完成。请使用 `settled()`：

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

// 2. 从 schema 字面量推导（每个 type 加 `as const`）：
const m = createModel({
  name: { type: 'string'  as const, default: '' },
  age:  { type: 'number'  as const, default: 0 },
  ok:   { type: 'boolean' as const, default: false },
});
// m.data 类型为 { name: string; age: number; ok: boolean }
```
