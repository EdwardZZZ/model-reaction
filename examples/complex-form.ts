import { createModel, ErrorHandler, ErrorType, Rule, ValidationRules } from '../src/index';

interface UserInfo {
    name: string;
    email: string;
    phone: string;
}

interface Product {
    id: number;
    name: string;
    price: number;
    quantity: number;
}

interface CreditCardInfo {
    cardNumber?: string;
    expiry?: string;
    cvv?: string;
}

interface OrderForm {
    userInfo: UserInfo;
    email: string;
    products: Product[];
    totalAmount: number;
    couponCode: string;
    discountAmount: number;
    finalAmount: number;
    paymentMethod: string;
    creditCardInfo: CreditCardInfo;
}

// 模拟API调用 - 检查邮箱唯一性
async function checkEmailUnique(email: string): Promise<boolean> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(email !== 'existing@example.com');
    }, 500);
  });
}

// 模拟API调用 - 验证信用卡信息
async function validateCreditCard(cardNumber: string): Promise<boolean> {
  return new Promise(resolve => {
    setTimeout(() => {
      // 简单验证: 卡号长度为16位数字
      resolve(/^\d{16}$/.test(cardNumber));
    }, 800);
  });
}

// 创建自定义错误处理器
const errorHandler = new ErrorHandler();
errorHandler.onError(ErrorType.VALIDATION, (error) => {
  console.error(`验证错误 [${error.field}]: ${error.message}`);
});

errorHandler.onError(ErrorType.REACTION, (error) => {
  console.error(`反应错误: ${error.message}`);
});

// 创建复杂表单模型
const orderFormModel = createModel<OrderForm>({
  // 基本信息
  userInfo: {
    type: 'object',
    default: {
      name: '',
      email: '',
      phone: ''
    },
    validator: [
      new Rule(
        'objectValidation',
        '用户信息不完整',
        (value) => {
          if (!value || typeof value !== 'object') return false;
          return value.name && value.email;
        }
      )
    ]
  },

  // 邮箱字段(单独提取以便异步验证)
  email: {
    type: 'string',
    validator: [
      ValidationRules.required.withMessage('邮箱不能为空'),
      ValidationRules.email.withMessage('邮箱格式无效'),
      new Rule(
        'emailUnique',
        '邮箱已被注册',
        checkEmailUnique
      )
    ],
    reaction: {
      fields: ['userInfo'],
      computed: (values) => values.userInfo?.email || '',
      action: (values) => {
        // 当userInfo.email变化时同步更新email字段
        if (values.computed !== orderFormModel.getField('email')) {
          orderFormModel.setField('email', values.computed);
        }
      }
    },
    default: ''
 },

  // 产品信息 - 数组
  products: {
    type: 'array',
    default: [],
    validator: [
      new Rule(
        'minProducts',
        '至少选择一个产品',
        (value) => Array.isArray(value) && value.length > 0
      )
    ]
  },

  // 总金额 - 依赖于产品数组
  totalAmount: {
    type: 'number',
    default: 0,
    reaction: {
      fields: ['products'],
      computed: (values) => {
        if (!Array.isArray(values.products)) return 0;
        return values.products.reduce((sum, product) => {
          return sum + (product.price || 0) * (product.quantity || 0);
        }, 0);
      }
    }
  },

  // 优惠券代码
  couponCode: {
    type: 'string',
  },

  // 折扣金额 - 依赖于总金额和优惠券
  discountAmount: {
    type: 'number',
    default: 0,
    reaction: {
      fields: ['totalAmount', 'couponCode'],
      computed: (values) => {
        if (values.couponCode === 'DISCOUNT10') {
          return values.totalAmount * 0.1;
        } else if (values.couponCode === 'DISCOUNT20' && values.totalAmount >= 100) {
          return values.totalAmount * 0.2;
        }
        return 0;
      },
      action: (values) => {
        if (values.computed > 0) {
          console.log(`应用优惠券 ${values.couponCode}，折扣金额: ${values.computed}`);
        }
      }
    }
  },

  // 最终金额 - 依赖于总金额和折扣
  finalAmount: {
    type: 'number',
    default: 0,
    reaction: {
      fields: ['totalAmount', 'discountAmount'],
      computed: (values) => values.totalAmount - values.discountAmount
    }
  },

  // 支付方式
  paymentMethod: {
    type: 'string',
    validator: [ValidationRules.required.withMessage('请选择支付方式')],
    default: ''
  },

  // 信用卡信息 - 条件验证
  creditCardInfo: {
    type: 'object',
    default: {},
    validator: [
      new Rule(
        'creditCardValidation',
        '信用卡信息无效',
        async (value) => {
          // 只有当支付方式为信用卡时才验证
          if (orderFormModel.getField('paymentMethod') !== 'creditCard') return true;
          if (!value || typeof value !== 'object') return false;

          // 验证卡号
          const isCardValid = await validateCreditCard(value.cardNumber || '');
          // 验证过期日期和CVV
          const isExpiryValid = /^\d{2}\/\d{2}$/.test(value.expiry || '');
          const isCvvValid = /^\d{3,4}$/.test(value.cvv || '');

          return isCardValid && isExpiryValid && isCvvValid;
        }
      )
    ]
  }
}, {
  debounceReactions: 100,
  asyncValidationTimeout: 5000,
  errorHandler: errorHandler
});

// 运行示例
async function runExample() {
  console.log('=== 复杂表单示例 ===');

  // 监听字段变化
  orderFormModel.on('field:change', (data) => {
    if (['totalAmount', 'discountAmount', 'finalAmount'].includes(data.field)) {
      console.log(`${data.field}: ${data.value}`);
    }
  });

  // 1. 设置用户信息
  await orderFormModel.setField('userInfo', {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '123-456-7890'
  });

  // 2. 添加产品
  await orderFormModel.setField('products', [
    { id: 1, name: '产品1', price: 50, quantity: 2 },
    { id: 2, name: '产品2', price: 30, quantity: 1 }
  ]);

  // 3. 应用优惠券
  await orderFormModel.setField('couponCode', 'DISCOUNT10');

  // 4. 设置支付方式
  await orderFormModel.setField('paymentMethod', 'creditCard');

  // 5. 设置信用卡信息
  await orderFormModel.setField('creditCardInfo', {
    cardNumber: '1234567890123456',
    expiry: '12/25',
    cvv: '123'
  });

  // 6. 验证整个表单
  const isValid = await orderFormModel.validateAll();
  console.log('表单验证结果:', isValid);

  if (isValid) {
    console.log('订单提交成功，总金额:', orderFormModel.getField('finalAmount'));
  } else {
    console.log('验证错误摘要:', orderFormModel.getValidationSummary());
  }

  // 清理资源
  orderFormModel.dispose();
}

runExample();