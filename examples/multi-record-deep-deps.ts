/**
 * 多记录 + 深度依赖示例（扩展版）
 *
 * 场景：批量计算
 * - 100 条数据
 * - 每条数据包含 50 个字段（10 个输入字段 + 40 个由 reaction 派生的字段）
 * - 依赖关系共 5 层（>= 3 层），每层 10 个字段：
 *
 *   Layer 1（输入） : in1..in10                                — 10 个
 *   Layer 2（派生） : s2_i = in_i + in_(i+1 mod 10)              — 10 个
 *   Layer 3（派生） : s3_i = s2_i * s2_(i+1 mod 10)              — 10 个
 *   Layer 4（派生） : s4_i = s3_i + s3_(i+2 mod 10)              — 10 个
 *   Layer 5（派生） : s5_i = (s4_i + s4_(i+3 mod 10)) / 2        — 10 个
 *
 *   合计 50 个字段，最深依赖路径 5 层，且每个派生字段都依赖至少两个上一层字段。
 */

import { createModel, FieldSchema } from '../src/index';

// ---- 1. 程序化构造 50 个字段的 schema ----
const FIELD_COUNT_PER_LAYER = 10;

function buildSchema(): Record<string, FieldSchema> {
  const schema: Record<string, FieldSchema> = {};

  // Layer 1：输入
  for (let i = 1; i <= FIELD_COUNT_PER_LAYER; i++) {
    schema[`in${i}`] = { type: 'number', default: 0 };
  }

  // Layer 2：相邻两项之和
  for (let i = 1; i <= FIELD_COUNT_PER_LAYER; i++) {
    const a = `in${i}`;
    const b = `in${(i % FIELD_COUNT_PER_LAYER) + 1}`;
    schema[`s2_${i}`] = {
      type: 'number',
      default: 0,
      reaction: {
        fields: [a, b],
        computed: (v) => round((v[a] ?? 0) + (v[b] ?? 0)),
      },
    };
  }

  // Layer 3：相邻两个 L2 的乘积
  for (let i = 1; i <= FIELD_COUNT_PER_LAYER; i++) {
    const a = `s2_${i}`;
    const b = `s2_${(i % FIELD_COUNT_PER_LAYER) + 1}`;
    schema[`s3_${i}`] = {
      type: 'number',
      default: 0,
      reaction: {
        fields: [a, b],
        computed: (v) => round((v[a] ?? 0) * (v[b] ?? 0)),
      },
    };
  }

  // Layer 4：跨 2 项的 L3 之和
  for (let i = 1; i <= FIELD_COUNT_PER_LAYER; i++) {
    const a = `s3_${i}`;
    const b = `s3_${((i + 1) % FIELD_COUNT_PER_LAYER) + 1}`;
    schema[`s4_${i}`] = {
      type: 'number',
      default: 0,
      reaction: {
        fields: [a, b],
        computed: (v) => round((v[a] ?? 0) + (v[b] ?? 0)),
      },
    };
  }

  // Layer 5：跨 3 项的 L4 平均
  for (let i = 1; i <= FIELD_COUNT_PER_LAYER; i++) {
    const a = `s4_${i}`;
    const b = `s4_${((i + 2) % FIELD_COUNT_PER_LAYER) + 1}`;
    schema[`s5_${i}`] = {
      type: 'number',
      default: 0,
      reaction: {
        fields: [a, b],
        computed: (v) => round(((v[a] ?? 0) + (v[b] ?? 0)) / 2),
      },
    };
  }

  return schema;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function createRecordModel() {
  return createModel(buildSchema(), { debounceReactions: 0 });
}

// ---- 2. 构造 100 条输入数据（每条 10 个输入字段） ----
const RECORD_COUNT = 100;

function buildInputs(): Record<string, number>[] {
  const inputs: Record<string, number>[] = [];
  for (let r = 0; r < RECORD_COUNT; r++) {
    const row: Record<string, number> = {};
    for (let i = 1; i <= FIELD_COUNT_PER_LAYER; i++) {
      // 用确定性公式生成可重复的输入数据，便于观察
      row[`in${i}`] = round(((r + 1) * i) / 3 + (i % 3));
    }
    inputs.push(row);
  }
  return inputs;
}

// ---- 3. 主流程 ----
async function runExample() {
  console.log('=== 多记录 + 深度依赖示例（100 条 × 50 字段） ===');

  const tTotalStart = performance.now();

  // 构建 model
  const tBuildStart = performance.now();
  const inputs = buildInputs();
  const models = inputs.map((input) => {
    const m = createRecordModel();
    return { input, model: m };
  });
  const tBuildEnd = performance.now();

  // 批量写入输入字段，触发 5 层 reaction 级联
  const tWriteStart = performance.now();
  await Promise.all(models.map(({ input, model }) => model.setFields(input)));
  const tWriteEnd = performance.now();

  // 等待 reaction 全部完成
  const tSettleStart = performance.now();
  await Promise.all(models.map(({ model }) => model.settled()));
  const tSettleEnd = performance.now();

  // ---- 4. 输出最终结果（仅展示首尾各 5 条记录的 L5 10 个字段） ----
  const previewIndices = [
    ...Array.from({ length: 5 }, (_, i) => i),
    ...Array.from({ length: 5 }, (_, i) => RECORD_COUNT - 5 + i),
  ];
  console.log(`\n最终结果（仅显示首尾各 5 条 / 共 ${RECORD_COUNT} 条，L5 派生字段）：`);
  console.table(
    previewIndices.map((idx) => {
      const entry = models[idx]!;
      const { model } = entry;
      const row: Record<string, any> = { '#': idx + 1 };
      for (let i = 1; i <= FIELD_COUNT_PER_LAYER; i++) {
        row[`s5_${i}`] = model.getField(`s5_${i}`);
      }
      return row;
    })
  );

  // 释放资源
  models.forEach(({ model }) => model.dispose());

  const tTotalEnd = performance.now();

  // ---- 5. 输出耗时统计 ----
  const fmt = (ms: number) => `${ms.toFixed(2)} ms`;
  const totalFields = RECORD_COUNT * 50;
  const reactionCount = RECORD_COUNT * (FIELD_COUNT_PER_LAYER * 4); // L2..L5 共 4 层 × 10 个 reaction
  console.log('\n耗时统计：');
  console.table([
    { 阶段: `构建 ${RECORD_COUNT} 个 model（共 ${totalFields} 字段）`, 耗时: fmt(tBuildEnd - tBuildStart) },
    { 阶段: `setFields 写入 + reaction 级联（约 ${reactionCount} 次 reaction）`, 耗时: fmt(tWriteEnd - tWriteStart) },
    { 阶段: 'settled 等待', 耗时: fmt(tSettleEnd - tSettleStart) },
    { 阶段: '总耗时', 耗时: fmt(tTotalEnd - tTotalStart) },
  ]);
}

runExample();
