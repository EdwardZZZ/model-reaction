import fs from 'node:fs';
import path from 'node:path';
import { json, read, sha, suite, treeHash, write, files } from './lib/environment.mjs';
import { agentConfig } from './lib/agent.mjs';
import { tasks, prompt } from './lib/tasks.mjs';

const output = path.resolve(process.argv[2] ?? path.join(suite, 'runs/baseline-v1'));
const env = json(path.join(output, 'environment.json'));
const preflight = json(path.join(output, 'preflight/result.json'));
const calibration = json(path.join(output, 'calibration.json'));
if (preflight.status !== 'PASS' || calibration.results.some(r => r.status !== 'PASS')) throw new Error('Calibration/preflight incomplete');
const sourceFiles = [
  ...files(path.join(suite, 'checks')), ...files(path.join(suite, 'fixtures')),
  ...files(path.join(suite, 'references')), ...files(path.join(suite, 'lib')),
  ...fs.readdirSync(suite).filter(f => f.endsWith('.mjs')).map(f => path.join(suite, f)),
];
const installed = path.join(env.toolchain, 'node_modules/model-reaction');
const manifest = {
  frozen_at: new Date().toISOString(), environment: env, configuration: agentConfig,
  configuration_hash: sha(JSON.stringify(agentConfig)),
  source_files: Object.fromEntries(sourceFiles.sort().map(file => [path.relative(suite, file), sha(read(file))])),
  consumer_materials_hash: sha(['docs', 'examples'].map(dir => treeHash(path.join(installed, dir))).join('') +
    ['AGENTS.md', 'README.md', 'README_CN.md'].map(file => sha(read(path.join(installed, file)))).join('')),
  prompts: Object.fromEntries(tasks.map(task => [task.id, sha(prompt(task))])),
  calibration, backend_model_snapshot: 'unavailable; CLI model alias is fixed, provider snapshot is not exposed',
  system_prompt: 'Codex session_meta base_instructions SHA-256 recorded per stage when exposed; server-side system prompt unavailable',
};
write(path.join(output, 'manifest.json'), manifest);
console.log(`Frozen ${sourceFiles.length} evaluator files and 12 prompts`);
