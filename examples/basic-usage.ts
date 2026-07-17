import {
  createModel,
  formatValidationErrors,
  ValidationRules,
  Model,
} from '../src/index';

interface User {
  name: string;
  age: number;
  email: string;
}

// 定义模型架构
const userModel = createModel<User>({
  name: {
    type: 'string',
    validator: [ValidationRules.required],
    default: '',
  },
  age: {
    type: 'number',
    validator: [ValidationRules.required, ValidationRules.number, ValidationRules.min(18)],
    default: 18
  },
  email: {
    type: 'string',
    validator: [ValidationRules.required, ValidationRules.email],
    default: ''
  }
}, {
  debounceReactions: 0,
});

// 异步函数演示基本使用
async function runExample() {
  console.log('=== 基本使用示例 ===');

  // 设置字段值
  await userModel.setField('name', 'John Doe');
  await userModel.setField('age', 30);
  await userModel.setField('email', 'john.doe@example.com');

  // 获取字段值
  console.log('姓名:', userModel.getField('name'));
  console.log('年龄:', userModel.getField('age'));
  console.log('邮箱:', userModel.getField('email'));

  // 验证所有字段
  const isValid = await userModel.validateAll();
  console.log('验证是否通过:', isValid);
  console.log('验证错误:', userModel.validationErrors);
  console.log('验证摘要:', formatValidationErrors(userModel.validationErrors));

  // 尝试设置无效值
  await userModel.setField('age', 15);
  console.log('设置无效年龄后验证摘要:', formatValidationErrors(userModel.validationErrors));

  // 查看脏数据
  console.log('脏数据:', userModel.getDirtyData());

  // 清理资源
  userModel.dispose();
}

runExample();
