import path from 'node:path';
import { read, suite, write } from './environment.mjs';

const todo = 'throw new Error("TODO");';
const starter = (signature, imports = '') => `${imports}\nexport function ${signature} { ${todo} }\n`;
export const tasks = [
  {
    id: 'AI-01', name: '建立可校验的用户模型',
    code: starter('createUserModel()'),
    contract: '导出 createUserModel()，返回推导类型的模型实例。',
  },
  {
    id: 'AI-02', name: '保留并处理失败输入',
    code: starter('createNameModel()'),
    contract: '导出 createNameModel()，返回模型，调用方通过模型公开 API 读取和订阅。',
  },
  {
    id: 'AI-03', name: '批量修改关联字段',
    code: starter('createPasswordModel(onTransform: (value: unknown) => void = () => {})'),
    contract: '导出 createPasswordModel(onTransform?)，返回模型。password transform 每次执行时先调用 onTransform(原输入)，便于调用方观察转换次数。',
  },
  {
    id: 'AI-04', name: '实现购物车计算链',
    code: starter('createCartModel()') + `
export async function updateCart(model: ReturnType<typeof createCartModel>, changes: { price?: number; quantity?: number; discount?: number }) { ${todo} }\n`,
    contract: '导出 createCartModel() 和 updateCart(model, changes)。后者返回本次写入和计算落定后的 model.data 快照。防抖选项为 10ms。',
  },
  {
    id: 'AI-05', name: '接入异步用户名查重',
    code: starter('createUsernameModel(availability: (name: string) => Promise<boolean>)'),
    contract: '导出 createUsernameModel(availability)，返回模型，字段名 username。服务 false 表示不可用。',
  },
  {
    id: 'AI-06', name: '根据邮编异步计算运费',
    code: starter('createShippingModel(services: { quote: (postcode: string) => Promise<number>; audit: (fee: number) => Promise<void> })'),
    contract: '导出 createShippingModel({quote, audit})，返回模型，字段为 postcode/base/fee/total/requestKey。quote 返回数字报价；audit 返回异步记录完成 Promise。',
  },
  {
    id: 'AI-07', name: '绑定受控金额输入框', react: true,
    code: starter('createAmountModel(check: (amount: number) => Promise<boolean>)') + `
export function AmountInput({ model }: { model: ReturnType<typeof createAmountModel> }) { ${todo} }\n`,
    contract: '导出 createAmountModel(check) 与 AmountInput({model})。使用 aria-label="amount" 的文本 input，错误展示元素 data-testid="amount-error"（无错误时为空或不存在）。调用方拥有并释放 model。',
  },
  {
    id: 'AI-08', name: '提交正在编辑的表单', react: true, fixture: 'form.tsx',
    code: starter('Form({ model, save }: { model: FormModel; save: (payload: Payload) => Promise<void> })',
      "import { InputFields, type FormModel, type Payload, type InputStatus } from './support';"),
    contract: '导出 Form({model, save})。复用不可修改的 src/support.tsx 中 InputFields；以 onStatus 接收 pending/writeError，disabled 禁止编辑。提供 type="submit" 的按钮及 data-testid="submit-error" 错误区。调用方拥有模型。quote 每次被调用均返回可控 Promise；name 校验服务可延迟/返回 false/抛错。表单应捕获并显示校验或保存异常。',
  },
  {
    id: 'AI-09', name: '管理独立编辑器生命周期', react: true, fixture: 'editor.ts',
    code: starter('Editor(props: EditorProps)', "import type { EditorProps } from './support';"),
    contract: '导出 Editor({recordId, factory, record})，类型见不可修改的 support.ts。factory 返回该编辑器拥有的模型；每次 committed name 变更调用 record(recordId, name)，cleanup 取消此订阅。输入 aria-label="name"，错误区 data-testid="name-error"。初始 effect 完成前可显示 loading。factory/record prop 引用稳定，支持异步 name 校验。',
  },
  {
    id: 'AI-10', name: '展示随 props 变化的选择结果', react: true, fixture: 'selection.ts',
    code: starter("ItemPrice({ model, id, onRender }: { model: SelectionModel; id: 'a' | 'b'; onRender: () => void })",
      "import type { SelectionModel } from './support';") +
      starter('AmountError({ model }: { model: SelectionModel })'),
    contract: '导出 ItemPrice({model,id,onRender}) 与 AmountError({model})。ItemPrice 每次 render 调用 onRender()，对象形式选择 {price: ...}，价格显示于 data-testid="item-price"。AmountError 错误区 data-testid="amount-error"，无错误为空或不存在。调用方拥有模型。',
  },
  {
    id: 'AI-11', name: '组合带精确类型的业务 Schema',
    code: starter('createBusinessModel()') + `
export async function changeCity(model: ReturnType<typeof createBusinessModel>, city: string) { ${todo} }
export async function appendLine(model: ReturnType<typeof createBusinessModel>, line: { sku: string; qty: number }) { ${todo} }\n`,
    contract: '导出 createBusinessModel()、changeCity(model, city)、appendLine(model, line)。schema 的身份/订单模块可放在 src/ 的独立文件。允许 as const 保留字面量；其他类型断言不可用于绕过推导。',
  },
  {
    id: 'AI-12', name: '迁移并修复旧购物车接入',
    code: `import { createModel, ValidationRules } from 'model-reaction';
export function createLegacyCart(save: (data: { price: number; quantity: number; subtotal: number; total: number }) => void | Promise<void>) {
  const persist = (_value: number, data: { price: number; quantity: number; subtotal: number; total: number }) => save(data);
  const model = createModel({
    price: { type: 'number', default: 10, validator: [ValidationRules.min(0)] },
    quantity: { type: 'number', default: 2 },
    subtotal: { type: 'number', default: 0, reaction: [{
      fields: ['price', 'quantitiy'], computed: d => d.price * d.quantity, action: persist,
    }] },
    total: { type: 'number', default: 0, reaction: [{
      fields: ['subtotal'], computed: d => d.subtotal, action: persist,
    }] },
  }, { strictMode: true, failFast: false });
  return model;
}
export function subscribePrice(model: ReturnType<typeof createLegacyCart>, listener: (value: number) => void) {
  return model.subscribeField('price', listener);
}
`,
    contract: '保留 createLegacyCart(save) 返回模型及 subscribePrice(model, listener) 返回取消函数。将迁移说明写入 src/MIGRATION.md，说明目标为本地构建 tarball，不能据 1.2.0 版本号推定线上行为。',
  },
];

export function prompt(task) {
  const baseline = read(path.join(suite, 'README_CN.md'));
  const common = baseline.split('具体 starter 和验收脚本实现后，必须记录其\n哈希，才可启动正式采样。')[1]
    .split('执行要求：')[0].trim().replace(/^> ?/gm, '');
  const card = baseline.split(`### ${task.id} —`)[1].split('**固定输入与验收**')[0];
  const taskPrompt = card.split('**任务提示**')[1].trim().replace(/^> ?/gm, '');
  return `${common}\n\n${task.id} ${task.name}\n\n${taskPrompt}\n\nStarter 接口：\n${task.contract}\n\n只修改 src/ 内的实现文件（support.ts/tsx 不可修改）。可新增 src/ 文件。npm run typecheck 和 npm test 可用于公开编译自检；隐藏运行验收在交付后执行。不要尝试访问项目之外的评测资料、其他任务项目或网络。\n`;
}
export function populate(task, project) {
  write(path.join(project, `src/solution.${task.react ? 'tsx' : 'ts'}`), task.code);
  if (task.fixture) write(path.join(project, `src/support.${task.fixture.endsWith('.tsx') ? 'tsx' : 'ts'}`),
    read(path.join(suite, 'fixtures', task.fixture)));
  write(path.join(project, 'TASK.md'), prompt(task));
}
