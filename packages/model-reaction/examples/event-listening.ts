import { createModel, ValidationRules } from '../src/index';

interface Form {
  name: string;
  email: string;
  submitStatus: string;
}

// 创建模型
const formModel = createModel<Form>({
  name: {
    type: 'string',
    validator: [ValidationRules.required],
    default: ''
  },
  email: {
    type: 'string',
    validator: [ValidationRules.required, ValidationRules.email],
    default: ''
  },
  submitStatus: {
    type: 'string',
    default: 'idle'
  }
});

// 设置事件监听器
formModel.on('field:change', (data) => {
  console.log(`字段变更: ${data.field}, 新值: ${data.value}`);
});

formModel.on('validation:complete', (data) => {
  console.log(`验证完成: ${data.isValid ? '通过' : '失败'}`);
  if (data.isValid) {
    formModel.setField('submitStatus', 'submitted');
  }
});

// 运行示例
async function runExample() {
  console.log('=== 事件监听示例 ===');

  // 监听 submitStatus 变化
  formModel.on('field:change', (data) => {
    if (data.field === 'submitStatus') {
      console.log(`表单状态变更为: ${data.value}`);
    }
  });

  // 设置字段值
  await formModel.setField('name', 'John Doe');
  await formModel.setField('email', 'john.doe@example.com');

  // 验证表单
  await formModel.validateAll();

  // 清理资源
  formModel.dispose();
}

runExample();