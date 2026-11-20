import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { finished } from 'node:stream/promises';
import { read, repo, sha, write, files } from './environment.mjs';

export const agentConfig = {
  product: 'codex-cli', model: 'gpt-6-luna', reasoning: 'medium', prompt_language: 'zh-CN',
  initial_budget_ms: 600000, repair_budget_ms: 300000, repair_limit: 2, repetitions: 3,
  ignore_user_config: true, ignore_rules: true, memories: false, project_doc_max_bytes: 0,
  web_search: 'disabled', sandbox: 'native named filesystem policy; network disabled', approval_policy: 'never',
};
export function isolation(environment, root, home, immutablePaths) {
  const hidden = [
    repo, path.join(environment.runtime, 'calibration'),
    path.join(os.homedir(), '.codex'), path.join(os.homedir(), '.trae-cn'),
    path.join(os.homedir(), 'Library/Application Support/Trae CN'),
    path.join(home, 'auth.json'),
  ];
  for (let task = 1; task <= 12; task++) for (let repeat = 1; repeat <= 3; repeat++) {
    const attempt = path.join(environment.runtime, 'attempts', `AI-${String(task).padStart(2, '0')}-r${repeat}`);
    if (!root.startsWith(attempt + path.sep)) hidden.push(attempt);
  }
  for (const entry of fs.readdirSync(environment.runtime)) {
    if (entry.startsWith('preflight') && !root.startsWith(path.join(environment.runtime, entry) + path.sep)) {
      hidden.push(path.join(environment.runtime, entry));
    }
  }
  return JSON.stringify({
    filesystem: {
      '/': 'read',
      ...Object.fromEntries(hidden.map(file => [file, 'deny'])),
      [environment.toolchain]: 'read',
      [root]: 'write',
      ...Object.fromEntries(immutablePaths.map(file => [path.join(root, file), 'read'])),
    },
    network: { enabled: false },
  }, null, 2);
}
export function createAgentHome(home) {
  fs.mkdirSync(home, { recursive: true });
  fs.symlinkSync(path.join(os.homedir(), '.codex/auth.json'), path.join(home, 'auth.json'));
}
export function permissionArgs(policy) {
  const permissions = JSON.parse(policy);
  const filesystem = '{' + Object.entries(permissions.filesystem).map(([key, value]) =>
    `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',') + '}';
  return ['-c', 'default_permissions="evaluation"', '-c', `permissions.evaluation.filesystem=${filesystem}`,
    '-c', 'permissions.evaluation.network.enabled=false'];
}
export async function runAgent({ root, home, policy, prompt, stage, session, output }) {
  const options = [
    '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--strict-config',
    ...permissionArgs(policy),
    '-c', 'approval_policy="never"', '-c', 'model_reasoning_effort="medium"', '-c', 'web_search="disabled"',
    '-c', 'features.memories=false', '-c', 'project_doc_max_bytes=0', '-m', agentConfig.model,
    '--json', '-C', root,
  ];
  const args = ['exec', ...options,
    ...(session ? ['resume', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', session, '-'] : ['-'])];
  write(path.join(output, 'prompt.txt'), prompt);
  const stdout = fs.createWriteStream(path.join(output, 'events.jsonl'));
  const stderr = fs.createWriteStream(path.join(output, 'stderr.log'));
  const started = performance.now();
  const child = spawn('codex', args, {
    cwd: root, detached: true,
    env: { PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: process.env.TMPDIR,
      CODEX_HOME: home, RUST_LOG: 'error', LANG: 'en_US.UTF-8', NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500).unref();
  }, stage === 0 ? agentConfig.initial_budget_ms : agentConfig.repair_budget_ms);
  const exit = await new Promise(resolve => {
    child.on('error', error => resolve({ code: null, error: error.message }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  await Promise.all([finished(stdout), finished(stderr)]);
  const events = read(path.join(output, 'events.jsonl')).split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const usage = {};
  let tools = 0;
  for (const event of events) {
    if (event.type === 'turn.completed') Object.assign(usage, event.usage ?? {});
    if (event.type === 'item.completed' && ['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(event.item?.type)) tools++;
  }
  const sessionId = events.find(e => e.type === 'thread.started')?.thread_id ?? session;
  let systemPromptHash = null;
  const sessions = path.join(home, 'sessions');
  if (fs.existsSync(sessions)) {
    for (const file of files(sessions).filter(f => f.endsWith('.jsonl'))) {
      for (const line of read(file).split('\n').filter(Boolean)) {
        try {
          const item = JSON.parse(line);
          if (item.type === 'session_meta' && item.payload?.base_instructions) {
            systemPromptHash = sha(JSON.stringify(item.payload.base_instructions));
          }
        } catch {}
      }
    }
  }
  const result = {
    ...exit, timed_out: timedOut, active_duration_ms: Math.round(performance.now() - started),
    session_id: sessionId, tool_calls: tools, token_usage: usage, token_usage_scope: 'cumulative_session',
    system_prompt_hash: systemPromptHash,
    completed: events.some(e => e.type === 'turn.completed'),
    final_message: events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item.text ?? '',
  };
  write(path.join(output, 'agent.json'), result);
  return result;
}
