import fs from 'node:fs';
import path from 'node:path';
import { json, read, suite, write, writeNew, treeHash, sha } from './lib/environment.mjs';
import { tasks, prompt } from './lib/tasks.mjs';
import { project, grade } from './lib/grader.mjs';

const output = path.resolve(process.argv[2] ?? path.join(suite, 'runs/baseline-v1'));
if (fs.existsSync(path.join(output, 'calibration')) || fs.existsSync(path.join(output, 'calibration.json'))) {
  throw new Error('Calibration evidence exists; use a fresh experiment');
}
const env = json(path.join(output, 'environment.json')), results = [];
for (const task of tasks) {
  const ext = task.react ? 'tsx' : 'ts';
  const root = path.join(env.runtime, 'calibration', task.id);
  const fixed = project(task, root, env);
  write(path.join(root, `src/solution.${ext}`), read(path.join(suite, `references/${task.id}.${ext}`)));
  if (task.id === 'AI-12') write(path.join(root, 'src/MIGRATION.md'), 'Target: locally built tarball; version 1.2.0 alone does not identify the npm release.\n');
  const result = await grade(task, root, path.join(output, 'calibration', task.id), fixed, env);
  results.push({ task_id: task.id, prompt_hash: sha(prompt(task)), ...result });
  console.log(`${task.id} ${result.status}${result.status !== 'PASS' ? '\n' + result.diagnostic : ''}`);
  if (result.status === 'BLOCKED') break;
}
writeNew(path.join(output, 'calibration.json'), {
  calibrated_at: new Date().toISOString(), checks_hash: treeHash(path.join(suite, 'checks')),
  grader_hash: sha(read(path.join(suite, 'lib/grader.mjs'))),
  harness_hash: treeHash(path.join(suite, 'lib')),
  fixtures_hash: treeHash(path.join(suite, 'fixtures')), references_hash: treeHash(path.join(suite, 'references')),
  tasks_hash: sha(read(path.join(suite, 'lib/tasks.mjs'))),
  results,
});
if (results.length !== tasks.length || results.some(r => r.status !== 'PASS')) process.exitCode = 1;
