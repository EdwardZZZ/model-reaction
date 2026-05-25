# model-reaction

[English Version](README.md) | 中文

一个强大的、类型安全的数据模型管理库，支持同步和异步数据验证、依赖反应、脏数据管理和统一错误处理。

## 项目简介

`model-reaction` 是一个用于管理应用程序数据模型的 TypeScript 库，提供以下核心功能：

- **数据验证**：支持同步和异步验证规则，支持自定义验证消息
- **依赖反应**：当指定字段变化时，自动触发相关计算和操作
- **脏数据管理**：跟踪验证失败的数据，并提供清除功能
- **事件系统**：支持订阅字段变化、验证完成和错误事件
- **错误处理**：统一的错误处理机制，支持错误类型分类和自定义错误监听
- **类型安全**：完全基于 TypeScript 构建，提供良好的类型提示

## 安装

```bash
# 使用 npm
npm install model-reaction

# 使用 yarn
yarn add model-reaction
```

## 基本使用

### 同步验证示例

```typescript
import { createModel, Model, ValidationRules, ErrorType } from 'model-reaction';

// 定义数据模型的接口
interface User {
  name: string;
  age: number;
  info: string;
}

// 定义模型架构
// 使用泛型确保 Schema 与接口匹配
const userModel = createModel<User>({
  name: {
    type: 'string',
    validator: [
      ValidationRules.required
    ],
    default: '',
  },
  age: {
    type: 'number',
    validator: [
      ValidationRules.required,
      ValidationRules.number,
      ValidationRules.min(18)
    ],
    default: 18
  },
  info: {
    type: 'string',
    reaction: {
      fields: ['name', 'age'],
      computed: (values) => `My name is ${values.name} and I am ${values.age} years old.`,
      action: (values) => console.log('Info updated:', values.computed)
    },
    default: ''
  }
}, {
  debounceReactions: 100,
  asyncValidationTimeout: 5000
});

// 订阅错误事件
userModel.on('validation:error', (error) => {
  console.error(`验证错误: ${error.field} - ${error.message}`);
});

userModel.on('field:not-found', (error) => {
  console.error(`字段不存在: ${error.field}`);
});

// 设置字段值
await userModel.setField('name', 'John');
await userModel.setField('age', 30);

// 尝试设置不存在的字段
await userModel.setField('nonexistentField', 'value');

// 获取字段值
console.log('姓名:', userModel.getField('name')); // 输出: John
console.log('年龄:', userModel.getField('age')); // 输出: 30
console.log('信息:', userModel.getField('info')); // 输出: My name is John and I am 30 years old.

// 验证所有字段
const isValid = await userModel.validateAll();
console.log('验证是否通过:', isValid);
console.log('验证错误:', userModel.validationErrors);
console.log('验证摘要:', userModel.getValidationSummary());

// 获取脏数据
console.log('脏数据:', userModel.getDirtyData());

// 清除脏数据
userModel.clearDirtyData();
console.log('清除后脏数据:', userModel.getDirtyData());
```

### 异步验证示例

```typescript
import { createModel, Model, ValidationRules, Rule } from 'model-reaction';

interface AsyncUser {
  name: string;
  username: string;
}

const asyncUniqueRule = new Rule(
  'asyncUnique',
  '用户名已存在',
  async (value: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(value !== 'admin');
      }, 100);
    });
  }
);

// 定义模型架构
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
      asyncUniqueRule
    ],
    default: ''
  }
}, {
  asyncValidationTimeout: 3000
});

// 异步设置字段值
const result1 = await asyncUserModel.setField('username', 'newuser');
console.log('设置新用户名结果:', result1); // 输出: true

const result2 = await asyncUserModel.setField('username', 'admin');
console.log('设置已存在用户名结果:', result2); // 输出: false
console.log('验证错误:', asyncUserModel.validationErrors);
console.log('脏数据:', asyncUserModel.getDirtyData());
```

## API 参考

### createModel

模型管理器是库的核心类，提供以下方法：

#### 构造函数
```typescript
createModel<T>(schema: Model<T>, options?: ModelOptions);
```

#### 方法

- `setField(field: keyof T, value: T[keyof T]): Promise<boolean>`: 设置单个字段值，返回验证结果
- `setFields(fields: Partial<T>): Promise<boolean>`: 批量设置字段值，返回验证结果
- `getField(field: keyof T): T[keyof T]`: 获取字段值
- `validateAll(): Promise<boolean>`: 验证所有字段，返回整体验证结果
- `getValidationSummary(): string`: 获取验证摘要信息
- `getDirtyData(): Partial<T>`: 获取验证失败的脏数据
- `clearDirtyData(): void`: 清除所有脏数据
- `settled(): Promise<void>`: 等待所有挂起的反应和验证完成
- `dispose(): void`: 销毁模型，清除所有定时器和监听器
- `on(event: string, callback: (data: any) => void): void`: 订阅事件
- `off(event: string, callback?: (data: any) => void): void`: 取消订阅事件
- `subscribeField<K extends keyof T>(field: K, callback: (value: T[K]) => void): () => void`: 订阅单个字段，仅在该字段变化时回调，返回取消订阅函数
- `subscribe<R>(selector: (data: T) => R, callback: (value: R, prev: R) => void, isEqual?: (a: R, b: R) => boolean): () => void`: 订阅派生值，仅在 selector 结果变化时回调（默认 `Object.is`），返回取消订阅函数
- `get data(): T`: 获取所有字段值
- `get validationErrors(): Record<string, ValidationError[]>`: 获取所有验证错误

#### 事件

- `field:change`: 字段值变化时触发
- `validation:complete`: 验证完成时触发
- `validation:error`: 验证错误时触发
- `reaction:error`: 反应处理错误时触发
- `field:not-found`: 尝试访问不存在的字段时触发

### ModelOptions

模型配置选项：

- `debounceReactions?: number`: 反应触发的防抖时间（毫秒）
- `asyncValidationTimeout?: number`: 异步验证的超时时间（毫秒）
- `errorFormatter?: (error: ValidationError) => string`: 自定义错误格式化函数
- `strictMode?: boolean`: 严格模式。如果为 true，尝试设置不在 schema 中定义的字段时将抛出 Error 异常。
- `failFast?: boolean`: 验证策略。如果为 true，则在遇到第一个错误后停止验证字段。默认为 false。

### ErrorHandler

错误处理器提供统一的错误管理：

- `onError(type: ErrorType, callback: (error: AppError) => void): void`: 订阅特定类型的错误
- `offError(type: ErrorType, callback: (error: AppError) => void): void`: 取消订阅特定类型的错误
- `triggerError(error: AppError): void`: 触发错误
- `createValidationError(field: string, message: string): AppError`: 创建验证错误
- `createFieldNotFoundError(field: string): AppError`: 创建字段不存在错误
- ... 其他错误创建方法

### ErrorType 枚举

- `VALIDATION`: 验证错误
- `REACTION`: 反应处理错误
- `FIELD_NOT_FOUND`: 字段不存在错误
- `DEPENDENCY_ERROR`: 反应依赖错误
- `CIRCULAR_DEPENDENCY`: 反应循环依赖错误
- `UNKNOWN`: 未知错误

### 类型定义

详细类型定义请参考 `src/types.ts` 文件。

## 高级用法

### 自定义验证规则和消息

您可以创建自定义验证规则并设置自定义错误消息：

```typescript
import { createModel, Model, Rule, ErrorHandler } from 'model-reaction';

// 创建错误处理器实例
const errorHandler = new ErrorHandler();

// 创建自定义验证规则
const customRule = new Rule(
  'custom',
  '不符合自定义规则', // 默认错误消息
  (value: any) => {
    // 自定义验证逻辑
    return value === 'custom';
  }
);

// 在模型中使用，并重写错误消息
const model = createModel({
  field: {
    type: 'string',
    validator: [
      customRule.withMessage('字段值必须为"custom"')
    ],
    default: ''
  }
}, {
  errorHandler: errorHandler // 添加errorHandler配置
});
```

### 统一错误处理

```typescript
import { createModel, Model, ValidationRules, ErrorHandler, ErrorType } from 'model-reaction';

// 创建错误处理器
const errorHandler = new ErrorHandler();

// 订阅所有验证错误
errorHandler.onError(ErrorType.VALIDATION, (error) => {
  console.error(`验证错误: ${error.field} - ${error.message}`);
});

// 订阅字段不存在错误
errorHandler.onError(ErrorType.FIELD_NOT_FOUND, (error) => {
  console.error(`字段不存在: ${error.field}`);
});

// 订阅所有错误
errorHandler.onError(ErrorType.UNKNOWN, (error) => {
  console.error(`未知错误: ${error.message}`);
});

// 定义模型架构，传入自定义错误处理器
const model = createModel({
  name: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('姓名不能为空')],
    default: ''
  }
}, {
  errorHandler: errorHandler
});
```

### 条件验证与交叉字段验证

您可以定义仅在特定条件下才执行的验证规则，或者使用 `data` 参数基于其他字段的值来验证当前字段：

```typescript
import { createModel, ValidationRules, Rule } from 'model-reaction';

const model = createModel({
  hasDiscount: { type: 'boolean', default: false },
  discountCode: {
    type: 'string',
    validator: [
      // 条件验证：此规则仅在 hasDiscount 为 true 时执行
      {
        ...ValidationRules.required.withMessage('启用折扣时，折扣码为必填项'),
        condition: (data) => data.hasDiscount === true
      },
      // 交叉字段验证：根据其他字段的数据检查折扣码是否有效
      new Rule(
        'validCode',
        '无效的折扣码',
        (value, data) => {
          // 您可以通过 `data` 参数访问模型中的其他字段值
          if (data?.hasDiscount && value !== 'PROMO2024') {
            return false;
          }
          return true;
        }
      )
    ],
    default: ''
  }
});
```

### 转换与异步验证

```typescript
import { createModel, Model, Rule } from 'model-reaction';

const asyncModel = createModel({
  field: {
    type: 'string',
    transform: (value: string) => value.toUpperCase(),
    validator: [
      new Rule(
        'asyncValidator',
        '异步验证失败',
        async (value: string) => {
          // 异步验证逻辑
          return value.length > 3;
        }
      ).withMessage('字段长度必须大于3个字符')
    ],
    default: ''
  }
});
```

### 等待异步操作（反应与验证）

当使用异步验证或反应（特别是带有防抖时），仅仅 `await setField` 可能不足以确保所有副作用（如级联反应）都已完成。

使用 `settled()` 方法来等待所有挂起的操作：

```typescript
// 定义带反应的 Schema
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
      computed: (vals) => vals.source.toUpperCase()
    }
  }
}, { debounceReactions: 100 }); // 反应带有防抖

// 触发更新
await model.setField('source', 'hello');

// 此时，由于防抖，'target' 可能尚未更新
console.log(model.getField('target')); // ''

// 等待所有反应稳定
await model.settled();

console.log(model.getField('target')); // 'HELLO'
```

### React 绑定

包内置了 React 适配层，入口为 `model-reaction/react`，提供一组 hook 与
组件，每个订阅者只在自己关心的切片真正变化时重渲染：

| 导出 | 类型 | 用途 |
| --- | --- | --- |
| `useModelField(model, field)` | hook | 订阅单个字段 |
| `useModelSelector(model, selector, isEqual?)` | hook | 订阅派生值 |
| `useModelFields(model, fields)` | hook | 一次订阅多个字段（浅比较） |
| `useModelFieldState(model, field)` | hook | `[value, setValue, meta, helpers]` 一体化表单绑定，含 `error / dirty / touched / validating` |
| `shallow` | 函数 | 用于对象/数组选择器的浅比较工具 |
| `<ModelProvider model>` | 组件 | 通过 Context 注入 model |
| `useModel<T>()` | hook | 读取最近 Provider 中的 model |
| `<Field name>` | 组件 | 单字段 render-prop 绑定，自动消费 `<ModelProvider>` |

`react` 声明为可选 peer 依赖（`>=18.0.0`），仅当你使用此入口时需要在应用
里安装。

```tsx
import { createModel, ValidationRules } from 'model-reaction';
import {
    Field,
    ModelProvider,
    shallow,
    useModel,
    useModelField,
    useModelFields,
    useModelFieldState,
    useModelSelector,
} from 'model-reaction/react';

interface Cart {
    qty: number;
    price: number;
    coupon: string;
    name: string;
}

const cart = createModel<Cart>({
    qty:    { type: 'number', default: 1 },
    price:  { type: 'number', default: 100 },
    coupon: { type: 'string', default: '' },
    name:   { type: 'string', default: '', validator: [ValidationRules.required] },
});

// 1. 单字段 hook
function NameInput() {
    const name = useModelField(cart, 'name');
    return <input value={name} onChange={(e) => cart.setField('name', e.target.value)} />;
}

// 2. 派生值 hook
function Total() {
    const total = useModelSelector(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

// 3. 多字段 hook（浅比较）
function PriceLine() {
    const { qty, price } = useModelFields(cart, ['qty', 'price']);
    return <span>{qty} x {price}</span>;
}

// 4. 一体化表单绑定
function CouponInput() {
    const [coupon, setCoupon, meta, helpers] = useModelFieldState(cart, 'coupon');
    return (
        <label>
            <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                onBlur={() => helpers.setTouched()}
                disabled={meta.validating}
            />
            {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
        </label>
    );
}

// 5. Provider + render-prop Field —— 免 prop 透传
function CartApp() {
    return (
        <ModelProvider model={cart}>
            <Field<Cart, 'name'> name="name">
                {({ value, setValue, meta }) => (
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        aria-invalid={!!meta.error}
                    />
                )}
            </Field>
            <Total />
            <PriceLine />
            <CouponInput />
        </ModelProvider>
    );
}

// 6. 自定义选择器返回新对象时，请配合 `shallow`
function Snapshot() {
    const m = useModel<Cart>();
    const slice = useModelSelector(
        m,
        (d) => ({ qty: d.qty, price: d.price }),
        shallow
    );
    return <span>{slice.qty * slice.price}</span>;
}
```

完整示例见 `examples/react-bindings.tsx`。

### Schema 类型推导

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

## 示例

更多示例请查看 `examples/` 目录下的文件。

## 最佳实践

请参考 `BEST_PRACTICES.md` 文件中的最佳实践指南。
