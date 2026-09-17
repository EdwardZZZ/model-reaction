import { createModel } from '../src/index';

interface Product {
  price: number;
  quantity: number;
  total: number;
  discount: number;
  finalTotal: number;
}

// 定义带反应的模型架构
const productModel = createModel<Product>({
  price: {
    type: 'number',
    default: 0
  },
  quantity: {
    type: 'number',
    default: 0
  },
  total: {
    type: 'number',
    default: 0,
    reaction: {
      fields: ['price', 'quantity'],
      computed: (values) => values.price * values.quantity,
      action: (values) => {
        console.log(`总价更新为: ${values.computed}`);
      }
    }
  },
  discount: {
    type: 'number',
    default: 0
  },
  finalTotal: {
    type: 'number',
    default: 0,
    reaction: {
      fields: ['total', 'discount'],
      computed: (values) => values.total * (1 - values.discount / 100),
      action: (values) => {
        console.log(`折扣后总价: ${values.computed}`);
      }
    }
  }
}, {
  debounceReactions: 100,
});

// 运行示例
async function runExample() {
  console.log('=== 反应系统示例 ===');

  // 设置价格和数量
  await productModel.setField('price', 100);
  await productModel.setField('quantity', 5);

  // 等待反应计算
  await new Promise(resolve => setTimeout(resolve, 200));
  console.log('当前总价:', productModel.getField('total'));

  // 设置折扣
  await productModel.setField('discount', 20);
  await new Promise(resolve => setTimeout(resolve, 200));
  console.log('最终支付金额:', productModel.getField('finalTotal'));

  // 清理资源
  productModel.dispose();
}

runExample();