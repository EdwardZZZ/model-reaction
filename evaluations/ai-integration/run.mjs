import fs from 'node:fs';
import path from 'node:path';
import { json, read, sha, suite, treeHash, write } from './lib/environment.mjs';
import { tasks, prompt } from './lib/tasks.mjs';
import { project, grade } from './lib/grader.mjs';
import { agentConfig, createAgentHome, isolation, runAgent } from './lib/agent.mjs';
import { assertResultStatus } from './lib/result-status.mjs';

const [id, repeatArg = 'all', outputArg] = process.argv.slice(2);
const output = path.resolve(outputArg ?? path.join(suite, 'runs/baseline-v1'));
const environment = json(path.join(output, 'environment.json'));
const calibration = json(path.join(output, 'calibration.json'));
const manifest = json(path.join(output, 'manifest.json'));
for (const [file, hash] of Object.entries(manifest.source_files)) {
  if (sha(read(path.join(suite, file))) !== hash) throw new Error(`Frozen runner file changed: ${file}`);
}
if (calibration.results.length !== 12 || calibration.results.some(r => r.status !== 'PASS')) throw new Error('All 12 references must pass before sampling');
if (calibration.checks_hash !== treeHash(path.join(suite, 'checks')) ||
    calibration.harness_hash !== treeHash(path.join(suite, 'lib')) ||
    calibration.grader_hash !== sha(read(path.join(suite, 'lib/grader.mjs'))) ||
    calibration.tasks_hash !== sha(read(path.join(suite, 'lib/tasks.mjs'))) ||
    calibration.fixtures_hash !== treeHash(path.join(suite, 'fixtures'))) throw new Error('Frozen evaluator changed; recalibrate before sampling');
const task = tasks.find(t => t.id === id);
if (!task) throw new Error('Usage: node run.mjs AI-01 [all|1|2|3] [output]');
const repeats = repeatArg === 'all' ? [1, 2, 3] : [Number(repeatArg)];
for (const repeat of repeats) {
  const attemptId = `${task.id}-r${repeat}`, evidence = path.join(output, 'attempts', attemptId);
  if (fs.existsSync(path.join(evidence, 'result.json'))) { console.log(`EXISTS ${attemptId}`); continue; }
  const root = path.join(environment.runtime, 'attempts', attemptId, 'project');
  const home = path.join(environment.runtime, 'attempts', attemptId, 'codex');
  if (fs.existsSync(root)) throw new Error(`Unfinished attempt requires audit: ${attemptId}`);
  const immutable = project(task, root, environment);
  const starterHash = treeHash(path.join(root, 'src'));
  createAgentHome(home);
  const policy = isolation(environment, root, home, Object.keys(immutable));
  write(path.join(evidence, 'policy.json'), policy);
  const stages = [];
  let session, nextPrompt = prompt(task), blockedReason = null;
  for (let stage = 0; stage <= agentConfig.repair_limit; stage++) {
    const stageOutput = path.join(evidence, `stage-${stage}`);
    fs.mkdirSync(stageOutput, { recursive: true });
    console.log(`START ${attemptId} stage=${stage}`);
    const agent = await runAgent({ root, home, policy, prompt: nextPrompt, stage, session, output: stageOutput });
    session = agent.session_id;
    fs.cpSync(path.join(root, 'src'), path.join(stageOutput, 'submission'), { recursive: true });
    const acceptance = await grade(task, root, stageOutput, immutable, environment);
    if (acceptance.status === 'BLOCKED') blockedReason = acceptance.diagnostic;
    if (!blockedReason && !agent.completed && !agent.timed_out && agent.code !== 0) {
      blockedReason = 'Agent infrastructure terminated without a completed turn; inspect raw stderr/events.';
    }
    const status = blockedReason ? 'BLOCKED' : agent.timed_out ? 'FAIL' : acceptance.status;
    stages.push({ stage, status, agent, acceptance });
    console.log(`END ${attemptId} stage=${stage} ${status} ${agent.active_duration_ms}ms`);
    if (status === 'PASS' || status === 'BLOCKED') break;
    if (!session) {
      blockedReason = 'Missing session identifier prevents repair';
      stages.at(-1).status = 'BLOCKED';
      break;
    }
    nextPrompt = `交付后的原始验收诊断如下。请在原接口约束下修复 src/，可自行检查；完成后重新交付。\n\n${acceptance.diagnostic || 'Agent stage time budget exceeded.'}`;
    // Evaluator type assertions and compiled output are removed by the worker before repair.
  }
  const result = {
    suite_version: 'ai-integration-v1', task_id: id, repeat_id: repeat,
    prompt_language: 'zh-CN', prompt_hash: sha(prompt(task)), starter_hash: starterHash,
    evaluator_hash: sha(calibration.checks_hash + calibration.grader_hash), reference_check: 'PASS',
    agent_model: agentConfig.model, agent_config_hash: sha(JSON.stringify(agentConfig)),
    tool_policy_hash: sha(policy), initial_status: stages[0].status,
    final_status: stages.at(-1).status,
    repair_rounds: stages.length - 1, blocked_reason: blockedReason,
    stages, completed_at: new Date().toISOString(),
  };
  assertResultStatus(result, attemptId);
  write(path.join(evidence, 'result.json'), result);
  console.log(`RESULT ${attemptId} initial=${result.initial_status} final=${result.final_status}`);
}
