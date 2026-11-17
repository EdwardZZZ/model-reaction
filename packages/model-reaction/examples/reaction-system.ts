import { createModel } from 'model-reaction';

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
      action: [() => {
        console.log(`总价更新为: ${productModel.data.total}`);
      }]
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
      action: [() => {
        console.log(`折扣后总价: ${productModel.data.finalTotal}`);
      }]
    }
  }
});

// 运行示例
async function runExample() {
  console.log('=== 反应系统示例 ===');

  // 设置价格和数量
  productModel.setFields({ price: 100, quantity: 5 });

  // 等待反应计算
  await productModel.settled();
  console.log('当前总价:', productModel.getField('total'));

  // 设置折扣
  productModel.setField('discount', 20);
  await productModel.settled();
  console.log('最终支付金额:', productModel.getField('finalTotal'));

  // 清理资源
  productModel.dispose();
}

runExample();
