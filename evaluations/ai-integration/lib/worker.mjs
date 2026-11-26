import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { command, files, read, sha, suite, treeHash, write } from './environment.mjs';
import { inspectExports, typescript } from './semantic.mjs';
import { typeAssertions } from '../checks/types.mjs';

function probe(request) {
  const denied = error => ['EPERM', 'EACCES'].includes(error.code);
  for (const file of [request.probe.denied, request.probe.link, request.probe.reference]) {
    assert.throws(() => read(file), denied, `Expected denied read: ${file}`);
  }
  assert.equal(read(request.probe.readable), 'EVALUATION_INSIDE_MARKER\n');
  assert.throws(() => fs.writeFileSync(request.probe.denied, 'changed'), denied, 'Outside writes must be denied');
  assert.throws(() => fs.writeFileSync(path.join(request.toolchain, `.denied-${process.pid}`), '', { flag: 'wx' }),
    denied, 'Toolchain must be read-only');
  assert.throws(() => fs.writeFileSync(path.join(request.root, 'node_modules', `.denied-${process.pid}`), '', { flag: 'wx' }),
    denied, 'Toolchain symlink must be read-only');
  const config = path.join(request.root, 'tsconfig.json');
  assert.throws(() => fs.writeFileSync(config, read(config)), denied, 'Fixed project files must be read-only');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'DYLD_INSERT_LIBRARIES', 'AWS_SECRET_ACCESS_KEY',
    'OPENAI_API_KEY', 'MR_EVALUATION_SECRET']) assert.equal(process.env[key], undefined, `Inherited environment: ${key}`);
  fs.readFileSync(path.join(request.toolchain, 'package.json'));
  write(path.join(request.local, 'write-marker'), 'writable\n');
}

function constraints(task, root, toolchain) {
  const ts = typescript(toolchain);
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

function grade({ task, root, toolchain, expectedImmutable }) {
  const sourceHash = treeHash(path.join(root, 'src'));
  const constraintErrors = constraints(task, root, toolchain);
  for (const [file, hash] of Object.entries(expectedImmutable)) {
    if (!fs.existsSync(path.join(root, file)) || sha(read(path.join(root, file))) !== hash) constraintErrors.push(`Immutable file changed: ${file}`);
  }
  const hidden = path.join(root, 'src/__evaluator_types.ts');
  const generated = path.join(root, 'dist/__evaluator_types.js');
  let compile = { ok: false, text: 'SKIPPED: constraints failed\n' };
  let runtime = { ok: false, text: 'SKIPPED: compilation failed\n' };
  if (!constraintErrors.length) {
    try {
      write(hidden, typeAssertions(task.id));
      fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
      compile = command(process.execPath, [path.join(toolchain, 'node_modules/typescript/bin/tsc'), '--pretty', 'false'], root);
      fs.rmSync(hidden, { force: true });
      fs.rmSync(generated, { force: true });
      if (compile.ok) runtime = command(process.execPath, [path.join(suite, 'checks/run.mjs'), task.id, root], root, undefined, 25000);
    } finally {
      fs.rmSync(hidden, { force: true });
      fs.rmSync(generated, { force: true });
    }
  }
  return {
    status: compile.ok && runtime.ok && !constraintErrors.length ? 'PASS' : 'FAIL',
    compile: compile.ok, runtime: runtime.ok, constraints: !constraintErrors.length,
    source_hash: sourceHash,
    diagnostic: [compile.ok ? '' : compile.text, runtime.ok ? '' : runtime.text, ...constraintErrors].filter(Boolean).join('\n'),
    logs: {
      compile: compile.text, runtime: runtime.text,
      constraints: constraintErrors.length ? constraintErrors.join('\n') + '\n' : 'PASS automated constraints\n',
    },
  };
}

// Only this trusted entry point reads stdin. No submitted module runs before the denial probe.
try {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  probe(request);
  process.chdir(request.root);
  process.env.HOME = path.join(request.local, 'home');
  process.env.CODEX_HOME = process.env.HOME;
  process.env.TMPDIR = path.join(request.local, 'tmp');
  const result = request.mode === 'probe' ? { status: 'PASS' } :
    request.mode === 'review' ? inspectExports(request.root, request.toolchain) : grade(request);
  process.stdout.write(JSON.stringify({ probe: 'PASS', result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ limitation: error.stack ?? error.message }));
  process.exitCode = 1;
}
