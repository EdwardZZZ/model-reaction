import {
  createModel,
  formatValidationErrors,
  ValidationRules,
} from '../src/index';

/**
 * 脏数据 + 条件校验示例。
 *
 * 演示两个常被忽略、但对表单场景很关键的行为：
 *   1. 校验失败的输入不会污染 `data`，而是进入 `dirtyData`，
 *      可通过 `getDirtyData()` 取回、`clearDirtyData()` 清空。
 *   2. `Rule.when(predicate)` 让一条规则仅在满足跨字段条件时才生效，
 *      是附加 `condition` 的简洁写法。
 */
const checkoutModel = createModel({
  // 是否使用折扣：控制 discountCode 是否必填。
  hasDiscount: {
    type: 'boolean',
    default: false,
  },
  // 折扣码：仅当 hasDiscount 为 true 时才要求非空。
  discountCode: {
    type: 'string',
    default: '',
    validator: [
      ValidationRules.required
        .withMessage('启用折扣时，折扣码为必填项')
        .when((data) => data.hasDiscount === true),
    ],
  },
  // 邮箱：始终要求合法格式，用来演示脏数据恢复。
  email: {
    type: 'string',
    default: '',
    validator: [ValidationRules.required, ValidationRules.email],
  },
});

async function runExample() {
  console.log('=== 脏数据 + 条件校验示例 ===\n');

  // --- 1. 条件校验：未开启折扣时，空折扣码是合法的 ---
  console.log('[1] hasDiscount = false');
  const ok1 = await checkoutModel.setField('discountCode', '');
  console.log('  空折扣码是否通过:', ok1); // true —— .when() 让规则跳过

  // --- 2. 开启折扣后，空折扣码变为非法 ---
  console.log('\n[2] hasDiscount = true');
  await checkoutModel.setField('hasDiscount', true);
  const ok2 = await checkoutModel.setField('discountCode', '');
  console.log('  空折扣码是否通过:', ok2); // false —— 现在规则生效
  console.log('  错误摘要:', formatValidationErrors(checkoutModel.validationErrors));

  // --- 3. 脏数据：失败的输入不进入 data ---
  console.log('\n[3] 设置非法邮箱');
  const ok3 = await checkoutModel.setField('email', 'not-an-email');
  console.log('  是否通过:', ok3); // false
  console.log('  data.email （保持旧值，未被污染）:', checkoutModel.getField('email')); // ''
  console.log('  dirtyData （保存了失败的输入）:', checkoutModel.getDirtyData()); // { discountCode: '', email: 'not-an-email' }

  // --- 4. 重新输入合法值：脏数据被自动清除 ---
  console.log('\n[4] 修正为合法邮箱');
  const ok4 = await checkoutModel.setField('email', 'buyer@example.com');
  console.log('  是否通过:', ok4); // true
  console.log('  data.email:', checkoutModel.getField('email')); // buyer@example.com
  console.log('  dirtyData.email 是否已清除:', !('email' in checkoutModel.getDirtyData())); // true

  // --- 5. 手动清空剩余脏数据 ---
  console.log('\n[5] clearDirtyData()');
  checkoutModel.clearDirtyData();
  console.log('  dirtyData:', checkoutModel.getDirtyData()); // {}

  checkoutModel.dispose();
}

runExample();
