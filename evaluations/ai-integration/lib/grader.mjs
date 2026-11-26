import fs from 'node:fs';
import path from 'node:path';
import { files, read, sha, tarballName, write, writeNew } from './environment.mjs';
import { populate } from './tasks.mjs';
import { sandboxWorker } from './sandbox.mjs';

export function project(task, root, environment) {
  if (fs.existsSync(root)) throw new Error(`Refusing to reuse consumer project: ${root}`);
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(path.join(environment.toolchain, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const artifact = tarballName(environment);
  fs.copyFileSync(path.join(environment.toolchain, artifact), path.join(root, artifact));
  fs.copyFileSync(path.join(environment.toolchain, 'package-lock.json'), path.join(root, 'package-lock.json'));
  write(path.join(root, 'package.json'), {
    name: 'mr-ai-toolchain', private: true,
    dependencies: { ...environment.dependencies, 'model-reaction': `file:./${artifact}` },
    scripts: { typecheck: 'tsc --noEmit', test: 'tsc --noEmit', build: 'tsc' },
  });
  write(path.join(root, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', strict: true, skipLibCheck: true,
      jsx: 'react-jsx', esModuleInterop: true, outDir: 'dist', rootDir: 'src',
      types: ['node', ...(task.react ? ['react', 'react-dom'] : [])],
    }, include: ['src/**/*.ts', 'src/**/*.tsx'],
  });
  populate(task, root);
  return immutable(root);
}
export function immutable(root) {
  return Object.fromEntries(['package.json', 'package-lock.json', 'tsconfig.json', 'TASK.md',
    ...files(path.join(root, 'src')).filter(f => path.basename(f).startsWith('support.')).map(f => path.relative(root, f))]
    .map(file => [file, sha(read(path.join(root, file)))]));
}
export async function grade(task, root, output, expectedImmutable, environment) {
  fs.mkdirSync(output, { recursive: true });
  const evidence = fs.realpathSync(output), projectRoot = fs.realpathSync(root);
  if (evidence === projectRoot || evidence.startsWith(projectRoot + path.sep)) {
    throw new Error('Grading evidence must be outside the submission project');
  }
  for (const file of ['grade.json', 'compile.log', 'runtime.log', 'constraints.log', 'sandbox.json']) {
    if (fs.existsSync(path.join(output, file))) throw new Error(`Refusing to overwrite grading evidence: ${output}/${file}`);
  }
  const started = performance.now();
  const worker = await sandboxWorker(root, environment, { mode: 'grade', task: { id: task.id }, expectedImmutable });
  writeNew(path.join(output, 'sandbox.json'), worker.record);
  const { logs = {}, ...acceptance } = worker.ok ? worker.result : {
    status: 'BLOCKED', compile: false, runtime: false, constraints: false,
    source_hash: null, diagnostic: worker.limitation,
  };
  for (const key of ['compile', 'runtime', 'constraints']) {
    writeNew(path.join(output, `${key}.log`), logs[key] ?? `SKIPPED: ${worker.limitation}\n`);
  }
  const result = {
    ...acceptance,
    sandbox: worker.ok ? 'PASS' : 'BLOCKED',
    evaluator_duration_ms: Math.round(performance.now() - started),
  };
  writeNew(path.join(output, 'grade.json'), result);
  return result;
}
