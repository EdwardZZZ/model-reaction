import { createModel, ValidationRules, Rule } from '../src/index';

interface User {
  username: string;
  email: string;
}

// 模拟用户名唯一性检查
async function checkUsernameUnique(username: string): Promise<boolean> {
  // 模拟API调用延迟
  return new Promise(resolve => {
    setTimeout(() => {
      // 假设 'admin', 'user123' 已被占用
      const takenUsernames = ['admin', 'user123'];
      resolve(!takenUsernames.includes(username));
    }, 500);
  });
}

// 定义带异步验证的模型
const userModel = createModel<User>({
  username: {
    type: 'string',
    validator: [
      ValidationRules.required,
      new Rule(
        'asyncUnique',
        '用户名已存在',
        checkUsernameUnique
      )
    ],
    default: ''
  },
  email: {
    type: 'string',
    validator: [
      ValidationRules.required,
      ValidationRules.email,
      new Rule(
        'asyncEmailCheck',
        '邮箱已被注册',
        async (email: string) => {
          // 模拟邮箱唯一性检查
          return new Promise(resolve => {
            setTimeout(() => {
              resolve(email !== 'existing@example.com');
            }, 300);
          });
        }
      )
    ],
    default: ''
  }
}, {
  asyncValidationTimeout: 3000,
});

// 运行示例
async function runExample() {
  console.log('=== 异步验证示例 ===');

  // 测试可用用户名
  const result1 = await userModel.setField('username', 'newuser');
  console.log('设置新用户名结果:', result1);
  console.log('用户名错误:', userModel.validationErrors.username);

  // 测试已占用用户名
  const result2 = await userModel.setField('username', 'admin');
  console.log('设置已占用用户名结果:', result2);
  console.log('用户名错误:', userModel.validationErrors.username);

  // 测试有效邮箱
  const result3 = await userModel.setField('email', 'new@example.com');
  console.log('设置有效邮箱结果:', result3);

  // 测试已注册邮箱
  const result4 = await userModel.setField('email', 'existing@example.com');
  console.log('设置已注册邮箱结果:', result4);
  console.log('邮箱错误:', userModel.validationErrors.email);

  // 清理资源
  userModel.dispose();
}

runExample();