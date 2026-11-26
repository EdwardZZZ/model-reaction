import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, read, sha, suite, writeNew as write } from './lib/environment.mjs';
import { tasks } from './lib/tasks.mjs';
import { grade, immutable } from './lib/grader.mjs';
import { agentConfig, runAgent } from './lib/agent.mjs';
import { inspectExports, diagnostic } from './review-types.mjs';
import { assertResultStatus, rejectLastStage } from './lib/result-status.mjs';

const [id, outputArg] = process.argv.slice(2);
if (!/^AI-\d{2}-r[123]$/.test(id ?? '')) throw new Error('Usage: node continue-reviewed.mjs AI-05-r1 [output]');
const output = path.resolve(outputArg ?? path.join(suite, 'runs/baseline-v1'));
const manifest = json(path.join(output, 'manifest.json'));
for (const [file, hash] of Object.entries(manifest.source_files)) {
  assert.equal(sha(read(path.join(suite, file))), hash, `Frozen file changed: ${file}`);
}
const evidence = path.join(output, 'attempts', id), original = json(path.join(evidence, 'result.json'));
assert.equal(original.final_status, 'PASS', 'Only a missed constraint after automated PASS is continued');
assert.ok(!fs.existsSync(path.join(evidence, 'reviewed-result.json')), 'Already reviewed');
const task = tasks.find(t => t.id === original.task_id);
const environment = manifest.environment;
const root = path.join(environment.runtime, 'attempts', id, 'project');
const home = path.join(environment.runtime, 'attempts', id, 'codex');
const policy = read(path.join(evidence, 'policy.json'));
const expectedImmutable = immutable(root);
assertResultStatus(original, id);
const finding = await inspectExports(root, environment, path.join(evidence, 'adjudication.sandbox.json'));
assert.ok(finding.violations.length, 'No semantic type escape to adjudicate');
const originalStage = original.stages.at(-1);
write(path.join(evidence, `stage-${originalStage.stage}`, 'manual-types.json'), finding);
write(path.join(evidence, `stage-${originalStage.stage}`, 'manual-constraints.log'), diagnostic(finding) + '\n');
const result = rejectLastStage(original, finding);
result.automated_result_path = 'result.json';
result.adjudication = {
  rule: 'Existing baseline no-type-escape constraint, enforced through manual review with TypeScript evidence',
  continuation_runner_sha256: sha(read(path.join(suite, 'continue-reviewed.mjs'))),
  semantic_inspector_sha256: sha(read(path.join(suite, 'review-types.mjs'))),
  original_automated_final_status: original.final_status,
};
let nextDiagnostic = diagnostic(finding);
let session = originalStage.agent.session_id;
for (let stage = originalStage.stage + 1; stage <= agentConfig.repair_limit; stage++) {
  const stageOutput = path.join(evidence, `stage-${stage}`);
  assert.ok(!fs.existsSync(stageOutput), 'Existing continuation requires an audit, not a silent rerun');
  fs.mkdirSync(stageOutput);
  console.log(`START reviewed ${id} stage=${stage}`);
  const agent = await runAgent({
    root, home, policy, stage, session, output: stageOutput,
    prompt: `交付后的原始验收诊断如下。请在原接口约束下修复 src/，可自行检查；完成后重新交付。\n\n${nextDiagnostic}`,
  });
  session = agent.session_id;
  fs.cpSync(path.join(root, 'src'), path.join(stageOutput, 'submission'), { recursive: true });
  const acceptance = await grade(task, root, stageOutput, expectedImmutable, environment);
  const manual = acceptance.status === 'BLOCKED' ? { violations: [], skipped: acceptance.diagnostic } :
    await inspectExports(root, environment, path.join(stageOutput, 'manual-types.sandbox.json'));
  write(path.join(stageOutput, 'manual-types.json'), manual);
  write(path.join(stageOutput, 'manual-constraints.log'), manual.skipped ? `SKIPPED: ${manual.skipped}\n` :
    diagnostic(manual) || 'PASS semantic export type review\n');
  const blocked = acceptance.status === 'BLOCKED' || (!agent.completed && !agent.timed_out && agent.code !== 0);
  const status = blocked ? 'BLOCKED' : agent.timed_out || manual.violations.length ? 'FAIL' : acceptance.status;
  result.stages.push({ stage, status, agent, acceptance, manual_constraints: manual });
  result.final_status = status;
  result.repair_rounds = stage;
  result.blocked_reason = acceptance.status === 'BLOCKED' ? acceptance.diagnostic :
    blocked ? 'Continuation infrastructure terminated without a completed turn' : null;
  console.log(`END reviewed ${id} stage=${stage} ${status}`);
  if (status === 'PASS' || status === 'BLOCKED') break;
  nextDiagnostic = [acceptance.diagnostic, diagnostic(manual)].filter(Boolean).join('\n') || 'Agent stage time budget exceeded.';
}
result.final_status = result.stages.at(-1).status;
assertResultStatus(result, id);
result.completed_at = new Date().toISOString();
write(path.join(evidence, 'reviewed-result.json'), result);
console.log(`RESULT reviewed ${id} initial=${result.initial_status} final=${result.final_status}`);
