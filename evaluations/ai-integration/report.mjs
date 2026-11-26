import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, read, sha, suite, tarballName, treeHash, writeNew as write } from './lib/environment.mjs';
import { tasks, prompt } from './lib/tasks.mjs';
import { assertResultStatus } from './lib/result-status.mjs';

const output = path.resolve(process.argv[2] ?? path.join(suite, 'runs/baseline-v1'));
for (const file of ['RESULTS.json', 'REPORT.md', 'REPORT_CN.md']) {
  assert.ok(!fs.existsSync(path.join(output, file)), `Report exists; do not overwrite historical evidence: ${file}`);
}
const manifest = json(path.join(output, 'manifest.json'));
const review = json(path.join(output, 'review.json'));
const artifact = tarballName(manifest.environment);
assert.equal(sha(fs.readFileSync(path.join(output, artifact))), manifest.environment.tarball_sha256);
assert.equal(sha(read(path.join(output, 'consumer-package-lock.json'))), manifest.environment.consumer_lock_hash);
assert.equal(sha(read(path.join(output, 'source.diff'))), manifest.environment.source_diff_hash);
for (const [file, hash] of Object.entries(manifest.source_files)) {
  assert.equal(sha(read(path.join(suite, file))), hash, `Frozen file changed: ${file}`);
}
const attempts = [];
for (const task of tasks) {
  assert.equal(sha(prompt(task)), manifest.prompts[task.id], `Prompt changed: ${task.id}`);
  for (let repeat = 1; repeat <= manifest.configuration.repetitions; repeat++) {
    const id = `${task.id}-r${repeat}`, relative = `attempts/${id}`;
    const resultFile = fs.existsSync(path.join(output, relative, 'reviewed-result.json')) ? 'reviewed-result.json' : 'result.json';
    const result = json(path.join(output, relative, resultFile));
    const automated = json(path.join(output, relative, 'result.json'));
    assertResultStatus(result, id);
    assertResultStatus(automated, `${id} automated`);
    if (result.adjudication) {
      assert.equal(sha(read(path.join(output, 'review-tool-sources/initial-review-types.mjs'))), result.adjudication.semantic_inspector_sha256);
      assert.equal(sha(read(path.join(suite, 'continue-reviewed.mjs'))), result.adjudication.continuation_runner_sha256);
    }
    const audit = review.attempts[id];
    assert.ok(audit?.reviewed, `Manual review missing: ${id}`);
    assert.equal(result.prompt_hash, manifest.prompts[task.id]);
    assert.equal(result.agent_config_hash, manifest.configuration_hash);
    assert.equal(result.tool_policy_hash, sha(read(path.join(output, relative, 'policy.json'))));
    assert.equal(result.evaluator_hash, sha(manifest.calibration.checks_hash + manifest.calibration.grader_hash));
    const stages = result.stages.map(stage => {
      const directory = `${relative}/stage-${stage.stage}`;
      if (stage.acceptance.source_hash !== null) {
        assert.equal(treeHash(path.join(output, directory, 'submission')), stage.acceptance.source_hash, `Snapshot mismatch: ${directory}`);
      } else {
        assert.equal(stage.acceptance.sandbox, 'BLOCKED', `Unverified snapshot without blocked sandbox: ${directory}`);
        assert.equal(stage.status, 'BLOCKED');
      }
      const checked = json(path.join(output, directory, 'grade.json'));
      assert.deepEqual(checked, stage.acceptance);
      return {
        stage: stage.stage, status: stage.status,
        compile: checked.compile, runtime: checked.runtime, constraints: checked.constraints,
        source_hash: checked.source_hash, snapshot_verified: checked.source_hash !== null,
        active_duration_ms: stage.agent.active_duration_ms,
        evaluator_duration_ms: checked.evaluator_duration_ms, tool_calls: stage.agent.tool_calls,
        token_usage: stage.agent.token_usage, system_prompt_hash: stage.agent.system_prompt_hash,
        automated_status: stage.automated_status ?? stage.acceptance.status,
        manual_constraints: stage.manual_constraints ?? null,
        timed_out: stage.agent.timed_out, completed: stage.agent.completed,
        submission_path: `${directory}/submission`,
        diagnostic_paths: ['compile.log', 'runtime.log', 'constraints.log',
          ...(checked.sandbox ? ['sandbox.json'] : []),
          ...(stage.manual_constraints ? ['manual-constraints.log', 'manual-types.json'] : [])].map(f => `${directory}/${f}`),
        events_path: `${directory}/events.jsonl`, stderr_path: `${directory}/stderr.log`,
        failure_tags: audit.stages?.[stage.stage]?.failure_tags ?? [],
        review_notes: audit.stages?.[stage.stage]?.notes ?? '',
      };
    });
    const tokenUsage = Object.fromEntries(['input_tokens', 'cached_input_tokens', 'output_tokens']
      .map(field => [field, stages.at(-1).token_usage[field] ?? null]));
    for (const field of ['input_tokens', 'cached_input_tokens', 'output_tokens']) {
      for (let i = 1; i < stages.length; i++) {
        if (Number.isFinite(stages[i].token_usage[field]) && Number.isFinite(stages[i - 1].token_usage[field])) {
          assert.ok(stages[i].token_usage[field] >= stages[i - 1].token_usage[field], `Non-cumulative token metric: ${id}/${field}`);
        }
      }
    }
    attempts.push({
      id, task_id: task.id, repeat_id: repeat,
      category: task.id === 'AI-12' ? 'migration' : task.react ? 'react' : 'core-and-types',
      initial_status: result.initial_status, final_status: result.final_status,
      automated_initial_status: automated.initial_status, automated_final_status: automated.final_status,
      repair_rounds: result.repair_rounds, blocked_reason: result.blocked_reason,
      active_duration_ms: stages.reduce((sum, s) => sum + s.active_duration_ms, 0),
      evaluator_duration_ms: stages.reduce((sum, s) => sum + s.evaluator_duration_ms, 0),
      tool_calls: stages.reduce((sum, s) => sum + s.tool_calls, 0),
      token_usage: tokenUsage, token_usage_scope: 'final cumulative session total; cached input is a subset of input',
      prompt_hash: result.prompt_hash, starter_hash: result.starter_hash,
      tool_policy_hash: result.tool_policy_hash, session_id: result.stages[0].agent.session_id,
      result_path: `${relative}/${resultFile}`, automated_result_path: `${relative}/result.json`,
      adjudication: result.adjudication ?? null, review: audit, stages,
      completed_at: result.completed_at,
    });
  }
}
const sessionIds = attempts.map(a => a.session_id).filter(Boolean);
assert.equal(new Set(sessionIds).size, sessionIds.length, 'Each attempt needs a fresh session');
assert.ok(attempts.every(a => a.session_id || a.final_status === 'BLOCKED'), 'Valid attempt needs a session');
for (const task of tasks) {
  assert.equal(new Set(attempts.filter(a => a.task_id === task.id).map(a => a.starter_hash)).size, 1, `Starter varied: ${task.id}`);
}
const sum = (items, key) => items.reduce((n, item) => n + item[key], 0);
const median = values => {
  const v = [...values].sort((a, b) => a - b), middle = Math.floor(v.length / 2);
  return v.length % 2 ? v[middle] : (v[middle - 1] + v[middle]) / 2;
};
function metrics(items) {
  const valid = items.filter(a => a.final_status !== 'BLOCKED');
  const initial = valid.filter(a => a.initial_status === 'PASS').length;
  const final = valid.filter(a => a.final_status === 'PASS').length;
  return {
    planned: items.length, completed: items.length, valid: valid.length, not_run: 0,
    blocked: items.length - valid.length, initial_pass: initial, final_pass: final,
    initial_pass_rate: valid.length ? initial / valid.length : null,
    final_pass_rate: valid.length ? final / valid.length : null,
    repair_distribution: {
      zero: valid.filter(a => a.final_status === 'PASS' && a.repair_rounds === 0).length,
      one: valid.filter(a => a.final_status === 'PASS' && a.repair_rounds === 1).length,
      two: valid.filter(a => a.final_status === 'PASS' && a.repair_rounds === 2).length,
      unresolved: valid.filter(a => a.final_status !== 'PASS').length,
    },
    agent_active_duration_ms: sum(items, 'active_duration_ms'),
    median_agent_active_duration_ms: median(items.map(a => a.active_duration_ms)),
    evaluator_duration_ms: sum(items, 'evaluator_duration_ms'), tool_calls: sum(items, 'tool_calls'),
    stages: items.reduce((n, a) => n + a.stages.length, 0),
    repair_rounds_used: sum(items, 'repair_rounds'),
    tokens: {
      input_tokens: items.reduce((n, a) => n + a.token_usage.input_tokens, 0),
      cached_input_tokens: items.reduce((n, a) => n + a.token_usage.cached_input_tokens, 0),
      output_tokens: items.reduce((n, a) => n + a.token_usage.output_tokens, 0),
      unavailable_attempts: items.filter(a => Object.values(a.token_usage).some(v => v === null)).length,
    },
  };
}
const data = {
  suite_version: manifest.environment.suite_version, generated_at: new Date().toISOString(),
  completed_baseline: attempts.length === 36 && attempts.every(a => a.final_status !== 'BLOCKED'),
  manifest_path: 'manifest.json', manifest_sha256: sha(read(path.join(output, 'manifest.json'))),
  report_generator_sha256: sha(read(path.join(suite, 'report.mjs'))),
  environment: manifest.environment, configuration: manifest.configuration,
  concurrency: { task_processes: 12, within_each_task: 'sequential repetitions and repairs' },
  overall: metrics(attempts), implementation: metrics(attempts.filter(a => a.task_id !== 'AI-12')),
  migration: metrics(attempts.filter(a => a.task_id === 'AI-12')),
  tasks: tasks.map(t => ({ id: t.id, name: t.name, ...metrics(attempts.filter(a => a.task_id === t.id)) })),
  original_automated_grades: {
    initial_pass: attempts.filter(a => a.automated_initial_status === 'PASS').length,
    final_pass: attempts.filter(a => a.automated_final_status === 'PASS').length,
    attempts: attempts.length,
  },
  failure_distribution: Object.fromEntries([...new Set(attempts.flatMap(a => a.stages.flatMap(s => s.failure_tags)))].sort()
    .map(tag => [tag, {
      affected_attempts: attempts.filter(a => a.stages.some(s => s.failure_tags.includes(tag))).map(a => a.id),
      failed_stages: attempts.reduce((n, a) => n + a.stages.filter(s => s.failure_tags.includes(tag)).length, 0),
    }])),
  system_prompt_hashes: [...new Set(attempts.flatMap(a => a.stages.map(s => s.system_prompt_hash)))],
  manual_review: review, attempts,
  supplemental_review_hashes: Object.fromEntries(['review-types.mjs', 'continue-reviewed.mjs']
    .map(file => [file, sha(read(path.join(suite, file)))])),
};
write(path.join(output, 'RESULTS.json'), data);

const pct = value => value === null ? 'unavailable' : `${(value * 100).toFixed(1)}%`;
const rate = (m, key) => `${m[`${key}_pass`]}/${m.valid} (${pct(m[`${key}_pass_rate`])})`;
const seconds = ms => (ms / 1000).toFixed(1);
const number = n => n === null ? 'unavailable' : n.toLocaleString('en-US');
const englishNames = [
  'Validated user model', 'Rejected input and errors', 'Related batch updates', 'Cart computation chain',
  'Async username availability', 'Async shipping action', 'Controlled amount input', 'Pending form submission',
  'Editor ownership and cleanup', 'Prop-dependent selection', 'Precisely typed schema modules', 'Legacy cart migration',
];
function markdown(en) {
  const overall = data.overall, implementation = data.implementation, migration = data.migration;
  const rows = data.tasks.map((t, i) =>
    `| [${t.id}](${attempts.find(a => a.task_id === t.id).result_path}) | ${en ? englishNames[i] : t.name} | ${rate(t, 'initial')} | ${rate(t, 'final')} | ${t.repair_distribution.zero}/${t.repair_distribution.one}/${t.repair_distribution.two}/${t.repair_distribution.unresolved} | ${seconds(t.median_agent_active_duration_ms)} |`).join('\n');
  const failures = attempts.flatMap(a => a.stages.filter(s => s.status !== 'PASS').map(s =>
    `| ${a.id} / ${s.stage} | ${s.failure_tags.join(', ') || 'unclassified'} | ${en ? review.attempts[a.id].stages?.[s.stage]?.notes_en ?? s.review_notes : s.review_notes} | [${en ? 'diagnostics' : '诊断'}](${s.diagnostic_paths.find(p => p.endsWith(s.manual_constraints?.violations?.length ? 'manual-constraints.log' : !s.compile ? 'compile.log' : !s.constraints ? 'constraints.log' : 'runtime.log'))}) |`)).join('\n');
  const details = attempts.map(a =>
    `| [${a.id}](${a.result_path}) | ${a.initial_status} → ${a.final_status} | ${a.repair_rounds} | ${seconds(a.active_duration_ms)} | ${a.tool_calls} | ${number(a.token_usage.input_tokens)} / ${number(a.token_usage.cached_input_tokens)} / ${number(a.token_usage.output_tokens)} |`).join('\n');
  const env = manifest.environment;
  return en ? `# AI integration baseline — measured report

[中文](REPORT_CN.md) | English · ${data.generated_at}

**${data.completed_baseline ? 'Completed' : 'Incomplete'}: ${overall.valid}/36 valid attempts; ${overall.blocked} blocked.**
First delivery: **${rate(overall, 'initial')}**. Final pass within two repair rounds: **${rate(overall, 'final')}**.
These are frozen submission results after agent self-checks, not first-generation pass rates.
Implementation tasks AI-01–11: ${rate(implementation, 'initial')} first / ${rate(implementation, 'final')} final.
Migration AI-12: ${rate(migration, 'initial')} first / ${rate(migration, 'final')} final.

## Per-task measurements

Each task has three fresh sessions. Repairs column: pass with 0 / 1 / 2 repairs / unresolved.
Time is median active agent seconds per attempt, including repairs and agent-run tools, excluding external acceptance checks.

| Task | Coverage | First delivery | Final | Repairs | Median seconds |
| --- | --- | --- | --- | --- | ---: |
${rows}

## Findings from submissions

${review.findings_en}

${failures ? `| Attempt / stage | Failure tags | Evidence-based finding | Raw output |
| --- | --- | --- | --- |
${failures}` : 'No frozen submission failed.'}

${review.manual_scope_en}

## Configuration and evidence

- Target commit: \`${env.source_commit}\`; local package label \`${env.package_version}\` includes unreleased behavior. This does not measure the npm release with the same label.
- Tarball SHA-256: \`${env.tarball_sha256}\`.
- Agent: Codex CLI 0.163.0, \`gpt-6-luna\`, medium reasoning, Chinese prompts; 600 seconds initial + two 300-second repair budgets.
- Runtime: Node ${env.node_version}, npm ${env.package_manager_version}; TypeScript ${env.dependencies.typescript}, React/React DOM ${env.dependencies.react}, jsdom ${env.dependencies.jsdom}, Testing Library ${env.dependencies['@testing-library/react']}, fake-timers ${env.dependencies['@sinonjs/fake-timers']}.
- Twelve task processes ran concurrently; repeats and repairs within each task ran sequentially. Every attempt had a fresh project and session. Repair rounds resumed that session.
- Agent sessions use the recorded native filesystem policy; their default host access is read-only. Current grading uses a separate bounded, deny-by-default native CLI worker with sanitized environment, fresh home, read-only toolchain/checks, and network disabled. A failed startup/denial probe is BLOCKED without unsandboxed fallback. Check each stage's sandbox evidence; these protections do not retroactively apply to historical host-executed grades.
- Runtime checks execute alongside submissions and are readable inside the worker. They are not hidden or proof against adversarial tampering; this boundary protects host filesystem, environment and network access. Manual review remains required.
- All 12 reference solutions passed before sampling. CLI preflight and deterministic permission probes passed. Earlier setup failures remain in preflight evidence and are excluded from the 36 business attempts.
- [Frozen manifest](manifest.json), [calibration](calibration.json), [consumer lock](consumer-package-lock.json), [target package](${artifact}), [source diff](source.diff), [structured results](RESULTS.json), [manual review](review.json).
- Every stage retains its prompt, source snapshot, raw agent events/stderr, compiler output, runtime output, constraint output and grade. Per-attempt links below lead to the complete stage records. Hashes and metric provenance are included in RESULTS.json.

## Cost

Total active agent time across concurrent processes: **${seconds(overall.agent_active_duration_ms)} seconds**; median per attempt **${seconds(overall.median_agent_active_duration_ms)} seconds**.
External automated acceptance time: ${seconds(overall.evaluator_duration_ms)} seconds. Tool actions: ${overall.tool_calls}.
There were ${overall.stages} deliveries, including ${overall.repair_rounds_used} repairs; evaluator code-review time is not included.
Tokens: **${number(overall.tokens.input_tokens)} input**, of which **${number(overall.tokens.cached_input_tokens)} cached**, plus **${number(overall.tokens.output_tokens)} output**.
Codex reports cumulative session counters: only the last completed stage is counted per attempt, not the sum of stage counters. Output includes reasoning; cached input is part of input. Attempts with unavailable token metrics: ${overall.tokens.unavailable_attempts}; totals include available values only. Monetary cost is unavailable. Active time includes service/tool latency and is not benchmarked model compute time or elapsed wall-clock makespan.

## Limits and follow-up

${review.limitations_en}

## All attempts

Tokens below are input / cached subset / output. Stage 0 is first delivery; stages 1–2 are diagnostic repairs.

| Attempt | Status | Repairs | Agent seconds | Tool actions | Tokens |
| --- | --- | ---: | ---: | ---: | --- |
${details}
` : `# AI 接入基线实测报告

中文 | [English](REPORT.md) · ${data.generated_at}

**${data.completed_baseline ? '已完成' : '尚未完成'}：36 次计划中，${overall.valid} 次有效结果，${overall.blocked} 次 BLOCKED。**
首次交付通过率 **${rate(overall, 'initial')}**；两轮修复内最终通过率 **${rate(overall, 'final')}**。
这里统计的是 agent 自检后的首次冻结交付，不是未经检查的首次生成。
AI-01–11 实现任务：首次 ${rate(implementation, 'initial')}，最终 ${rate(implementation, 'final')}。
AI-12 迁移任务：首次 ${rate(migration, 'initial')}，最终 ${rate(migration, 'final')}。

## 分任务实测

每项均为 3 个独立新会话。「修复」列依次为 0 轮通过 / 1 轮通过 / 2 轮通过 / 未修复。
耗时为每次尝试的 agent 主动工作中位秒数，包含修复和自行运行工具，不包含外部验收时间。

| 任务 | 覆盖 | 首次交付 | 最终 | 修复 | 中位秒数 |
| --- | --- | --- | --- | --- | ---: |
${rows}

## 从交付代码得出的发现

${review.findings_cn}

${failures ? `| 尝试 / 阶段 | 失败标签 | 有证据支持的归因 | 原始输出 |
| --- | --- | --- | --- |
${failures}` : '没有冻结提交失败。'}

${review.manual_scope_cn}

## 配置与取证

- 目标源码：\`${env.source_commit}\`；本地包标为 \`${env.package_version}\`，包含 unreleased 行为，本结果不能代表 npm 同版本发布包。
- Tarball SHA-256：\`${env.tarball_sha256}\`。
- Agent：Codex CLI 0.163.0，\`gpt-6-luna\`，medium 推理，中文提示；首次 600 秒、最多两轮各 300 秒修复。
- 环境：Node ${env.node_version}、npm ${env.package_manager_version}；TypeScript ${env.dependencies.typescript}、React/React DOM ${env.dependencies.react}、jsdom ${env.dependencies.jsdom}、Testing Library ${env.dependencies['@testing-library/react']}、fake-timers ${env.dependencies['@sinonjs/fake-timers']}。
- 12 个任务进程并行；同一任务的三次重复与各次修复串行。每次尝试拥有全新项目和会话，修复恢复本次会话。
- Agent 会话使用记录的 CLI 原生权限，宿主默认只读。当前评分使用独立、有时间与输出上限、默认拒绝访问的原生 CLI worker，清理环境变量、使用全新 home、只读工具链与检查并关闭网络。启动或拒绝访问探针失败时记 BLOCKED，不回退到无沙箱执行。逐阶段检查 sandbox 取证；这些保护不能追溯应用到历史宿主进程评分。
- 运行断言与提交代码共享运行时，worker 内可以读取检查文件；它们并非隐藏检查，也不能证明能抵御恶意篡改。此边界保护宿主文件系统、环境和网络访问，仍需人工复核。
- 正式采样前 12 份参考解全部通过；真实 CLI 工具与确定性权限探针通过。早期环境探测失败保留在 preflight 证据中，不计入 36 次业务尝试。
- [冻结清单](manifest.json)、[参考解校准](calibration.json)、[消费项目锁文件](consumer-package-lock.json)、[目标包](${artifact})、[源码差异](source.diff)、[结构化结果](RESULTS.json)、[代码复核](review.json)。
- 每阶段保留提示、源码快照、agent 原始事件/stderr、编译输出、运行输出、约束输出及评分。下方每次尝试链接可定位全部阶段；RESULTS.json 记录文件哈希与指标来源。

## 交付成本

并行进程累计 agent 主动工作 **${seconds(overall.agent_active_duration_ms)} 秒**；每次尝试中位数 **${seconds(overall.median_agent_active_duration_ms)} 秒**。
外部自动验收累计 ${seconds(overall.evaluator_duration_ms)} 秒；工具动作 ${overall.tool_calls} 次。
共 ${overall.stages} 次交付，含 ${overall.repair_rounds_used} 轮修复；评测者代码复核时间未计入。
Token：输入 **${number(overall.tokens.input_tokens)}**，其中缓存输入 **${number(overall.tokens.cached_input_tokens)}**；输出 **${number(overall.tokens.output_tokens)}**。
CLI 计数为会话累计值，每次尝试仅取最后完成阶段，避免把修复阶段重复累加。输出含推理 token，缓存输入包含在输入总数中。Token 指标缺失 ${overall.tokens.unavailable_attempts} 次，总量只含可取得的值。无法取得货币费用。主动耗时包括服务和工具延迟，不等同于模型计算耗时或整轮墙钟耗时。

## 边界与后续建议

${review.limitations_cn}

## 全部尝试

Token 列为输入 / 其中缓存 / 输出。阶段 0 为首次交付，阶段 1–2 为诊断修复。

| 尝试 | 状态 | 修复轮数 | Agent 秒数 | 工具动作 | Token |
| --- | --- | ---: | ---: | ---: | --- |
${details}
`;
}
write(path.join(output, 'REPORT_CN.md'), markdown(false));
write(path.join(output, 'REPORT.md'), markdown(true));
console.log(JSON.stringify({ overall: data.overall, completed_baseline: data.completed_baseline, reports: ['REPORT_CN.md', 'REPORT.md', 'RESULTS.json'] }, null, 2));
