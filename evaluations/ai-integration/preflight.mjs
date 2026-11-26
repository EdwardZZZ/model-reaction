import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { json, suite, write, writeNew, read, repo } from './lib/environment.mjs';
import { createAgentHome, isolation, runAgent, permissionArgs } from './lib/agent.mjs';
import { project } from './lib/grader.mjs';
import { tasks } from './lib/tasks.mjs';
import { sandboxWorker } from './lib/sandbox.mjs';

const output = path.resolve(process.argv[2] ?? path.join(suite, 'runs/baseline-v1'));
const env = json(path.join(output, 'environment.json'));
if (fs.existsSync(path.join(output, 'preflight/result.json'))) throw new Error('Preflight result already exists');
const probeRoot = fs.mkdtempSync(path.join(env.runtime, 'preflight-'));
const root = path.join(probeRoot, 'project'), home = path.join(probeRoot, 'codex');
const fixed = project(tasks[0], root, env);
const gradingProbe = await sandboxWorker(root, env, { mode: 'probe' });
writeNew(path.join(output, 'preflight', path.basename(probeRoot), 'grading-sandbox.json'), gradingProbe.record);
if (!gradingProbe.ok) throw new Error(gradingProbe.limitation);
createAgentHome(home);
const policy = isolation(env, root, home, Object.keys(fixed));
write(path.join(root, 'src/probe.mjs'), `
import fs from 'node:fs';
import assert from 'node:assert/strict';
import net from 'node:net';
for (const file of ${JSON.stringify([path.join(repo, 'README.md'), path.join(suite, 'references/AI-01.ts'), path.join(env.runtime, 'calibration/AI-01/src/solution.ts')])}) {
  assert.throws(() => fs.readFileSync(file), e => ['EPERM', 'EACCES'].includes(e.code), 'hidden file must be denied');
}
fs.readFileSync('node_modules/model-reaction/README.md');
assert.throws(() => fs.writeFileSync('TASK.md', fs.readFileSync('TASK.md')), e => ['EPERM', 'EACCES'].includes(e.code), 'immutable starter must be read-only');
assert.throws(() => fs.writeFileSync('node_modules/.permission-probe', ''), e => ['EPERM', 'EACCES'].includes(e.code), 'toolchain must be read-only');
await new Promise((resolve, reject) => {
  const socket = net.connect({ host: '1.1.1.1', port: 443 });
  socket.on('connect', () => { socket.destroy(); reject(new Error('Network unexpectedly allowed')); });
  socket.on('error', e => { if (['EPERM', 'EACCES'].includes(e.code)) resolve(); else reject(e); });
  socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Network probe timed out instead of being denied')); });
});
console.log('ISOLATION_PASS');
`);
const probe = spawnSync('codex', ['sandbox', '-P', 'evaluation', ...permissionArgs(policy), '-C', root,
  process.execPath, 'src/probe.mjs'], {
  cwd: root, env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', timeout: 20000,
});
write(path.join(output, 'preflight', path.basename(probeRoot), 'isolation.log'), (probe.stdout ?? '') + (probe.stderr ?? ''));
if (probe.status !== 0 || !probe.stdout?.split('\n').includes('ISOLATION_PASS')) throw new Error(`Sandbox probe failed: ${probe.stdout}\n${probe.stderr}`);
fs.rmSync(path.join(root, 'src/probe.mjs'));
let session;
const stages = [];
for (const stage of [0, 1]) {
  const dir = path.join(output, `preflight/${path.basename(probeRoot)}/stage-${stage}`);
  fs.mkdirSync(dir, { recursive: true });
  const result = await runAgent({
    root, home, policy, stage, session, output: dir,
    prompt: stage === 0 ? '这是工具链探针，不是业务任务。用 apply_patch 创建 src/readiness.txt 内容为 READY，然后运行 node --version、npm --version。完成回复 READY。' :
      '读取上一轮创建的 src/readiness.txt，确认是 READY。运行 npm run typecheck。完成回复 RESUME_READY。',
  });
  if (!result.completed || result.code !== 0) throw new Error(`Preflight stage ${stage} failed: inspect ${dir}`);
  if (!fs.existsSync(path.join(root, 'src/readiness.txt')) || read(path.join(root, 'src/readiness.txt')).trim() !== 'READY') {
    throw new Error(`Preflight file write failed: inspect ${dir}`);
  }
  const events = read(path.join(dir, 'events.jsonl'));
  const calls = events.split('\n').filter(Boolean).map(JSON.parse).filter(e => e.type === 'item.completed' && e.item?.type === 'command_execution');
  if (stage === 1 && !calls.some(e => e.item.command.includes('npm run typecheck') && e.item.exit_code === 0)) {
    throw new Error(`Typecheck probe missing: inspect ${dir}`);
  }
  session = result.session_id;
  stages.push({ directory: path.relative(output, dir), ...result });
  console.log(`Preflight stage ${stage} PASS: ${session}`);
}
writeNew(path.join(output, 'preflight/result.json'), { status: 'PASS', session, policy, stages });
