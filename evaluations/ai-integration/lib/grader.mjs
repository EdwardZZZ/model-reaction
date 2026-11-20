import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { command, files, read, sha, suite, treeHash, write } from './environment.mjs';
import { populate } from './tasks.mjs';
import { typeAssertions } from '../checks/types.mjs';

export function project(task, root, environment) {
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(path.join(environment.toolchain, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.copyFileSync(path.join(environment.toolchain, 'model-reaction-1.2.0.tgz'), path.join(root, 'model-reaction-1.2.0.tgz'));
  fs.copyFileSync(path.join(environment.toolchain, 'package-lock.json'), path.join(root, 'package-lock.json'));
  write(path.join(root, 'package.json'), {
    name: 'mr-ai-toolchain', private: true, dependencies: environment.dependencies,
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
function constraints(task, root) {
  const require = createRequire(path.join(root, 'package.json')), ts = require('typescript');
  const errors = [];
  const sourceFiles = files(path.join(root, 'src')).filter(f => /\.[cm]?[jt]sx?$/.test(f) && !/\/support\.tsx?$/.test(f));
  for (const file of sourceFiles) {
    const text = read(file), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (/@ts-(ignore|nocheck|expect-error)/.test(text)) errors.push(`${file}: diagnostic suppression in submission`);
    const visit = node => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) errors.push(`${file}: explicit any`);
      if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && node.type.getText(ast) !== 'const') {
        errors.push(`${file}: type assertion ${node.getText(ast)}`);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text;
        if (name.startsWith('model-reaction/') && !['model-reaction/react', 'model-reaction/validation', 'model-reaction/devtools'].includes(name)) {
          errors.push(`${file}: non-public package import ${name}`);
        }
      }
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createModel' && node.typeArguments?.length &&
          ['AI-01', 'AI-11'].includes(task.id)) errors.push(`${file}: createModel must infer from schema`);
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'computed') {
        const body = node.initializer.getText(ast);
        if (/^async\b|\.setFields?\s*\(|\b(fetch|setTimeout|setInterval)\s*\(/.test(body)) errors.push(`${file}: impure or async computed: ${body}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  if (task.id === 'AI-07' && !sourceFiles.some(f => /\buseDraftField\b/.test(read(f)))) errors.push('AI-07: recommended useDraftField binding absent');
  if (task.id === 'AI-12') {
    const migration = path.join(root, 'src/MIGRATION.md');
    if (!fs.existsSync(migration)) errors.push('AI-12: src/MIGRATION.md missing');
    else if (!/tarball/i.test(read(migration))) errors.push('AI-12: migration must identify the tarball target');
  }
  return errors;
}
export function grade(task, root, output, expectedImmutable) {
  fs.mkdirSync(output, { recursive: true });
  const started = performance.now();
  const constraintErrors = constraints(task, root);
  for (const [file, hash] of Object.entries(expectedImmutable)) {
    if (!fs.existsSync(path.join(root, file)) || sha(read(path.join(root, file))) !== hash) constraintErrors.push(`Immutable file changed: ${file}`);
  }
  const hidden = path.join(root, 'src/__evaluator_types.ts');
  write(hidden, typeAssertions(task.id));
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  const compile = command(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--pretty', 'false'], root, path.join(output, 'compile.log'));
  fs.rmSync(hidden);
  fs.rmSync(path.join(root, 'dist/__evaluator_types.js'), { force: true });
  let runtime = { ok: false, text: 'SKIPPED: compilation failed\n' };
  if (compile.ok) runtime = command(process.execPath, [path.join(suite, 'checks/run.mjs'), task.id, root],
    root, path.join(output, 'runtime.log'), 25000);
  else write(path.join(output, 'runtime.log'), runtime.text);
  write(path.join(output, 'constraints.log'), constraintErrors.length ? constraintErrors.join('\n') + '\n' : 'PASS automated constraints\n');
  const diagnostic = [compile.ok ? '' : compile.text, runtime.ok ? '' : runtime.text, ...constraintErrors].filter(Boolean).join('\n');
  const result = {
    status: compile.ok && runtime.ok && constraintErrors.length === 0 ? 'PASS' : 'FAIL',
    compile: compile.ok, runtime: runtime.ok, constraints: constraintErrors.length === 0,
    evaluator_duration_ms: Math.round(performance.now() - started),
    source_hash: treeHash(path.join(root, 'src')),
    diagnostic,
  };
  write(path.join(output, 'grade.json'), result);
  return result;
}
