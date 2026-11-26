import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, suite, writeNew } from './lib/environment.mjs';
import { sandboxWorker } from './lib/sandbox.mjs';

export async function inspectExports(root, environment, evidence) {
  if (fs.existsSync(evidence)) throw new Error(`Refusing to overwrite semantic review evidence: ${evidence}`);
  const worker = await sandboxWorker(root, environment, { mode: 'review' });
  writeNew(evidence, worker.record);
  if (!worker.ok) throw new Error(worker.limitation);
  return worker.result;
}
export function diagnostic(result) {
  return result.violations.map(f => `CONSTRAINT FAIL: ${f.file}, export ${f.export}, ${f.kind} type is any (TypeScript ${result.typescript_version} checker). The task forbids type escapes.`).join('\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? path.join(suite, 'runs/baseline-v1'));
  const environment = json(path.join(output, 'environment.json'));
  if (fs.existsSync(path.join(output, 'export-types-review.json'))) throw new Error('Semantic review already exists');
  const evidence = {};
  for (const name of fs.readdirSync(path.join(output, 'attempts'))) {
    if (!fs.existsSync(path.join(output, 'attempts', name, 'result.json'))) continue;
    evidence[name] = await inspectExports(path.join(environment.runtime, 'attempts', name, 'project'), environment,
      path.join(output, 'semantic-review', `${name}.sandbox.json`));
  }
  writeNew(path.join(output, 'export-types-review.json'), evidence);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(evidence).map(([id, r]) => [id, r.violations])), null, 2));
}
