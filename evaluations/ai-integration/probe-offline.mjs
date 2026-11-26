import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { json, prepare, read, repo, sha, suite, tarballName, write, writeNew } from './lib/environment.mjs';
import { assertResultStatus, rejectLastStage } from './lib/result-status.mjs';
import { grade, immutable, project } from './lib/grader.mjs';
import { tasks, prompt } from './lib/tasks.mjs';
import { sandboxWorker } from './lib/sandbox.mjs';

// Offline integration probes: no agent, install, build, or network operation.
const base = path.resolve(process.argv[2] ?? os.tmpdir());
fs.mkdirSync(base, { recursive: true });
const work = fs.mkdtempSync(path.join(fs.realpathSync(base), 'evaluation-fixes-'));
const results = {};
const original = {
  initial_status: 'FAIL', final_status: 'PASS', repair_rounds: 2,
  stages: [{ stage: 0, status: 'FAIL' }, { stage: 1, status: 'FAIL' }, { stage: 2, status: 'PASS' }],
};
const reviewed = rejectLastStage(original, { violations: [{ is_any: true }] });
assertResultStatus(reviewed);
assert.equal(reviewed.final_status, 'FAIL');
assert.equal(original.final_status, 'PASS');
assert.throws(() => assertResultStatus({ ...reviewed, final_status: 'PASS' }), /inconsistent final_status/);
const initial = rejectLastStage({ initial_status: 'PASS', final_status: 'PASS', stages: [{ stage: 0, status: 'PASS' }] }, {});
assertResultStatus(initial);
assert.equal(initial.initial_status, 'FAIL');
results.final_status = 'PASS: stage-2 rejection, original preserved, stage-0 rejection, inconsistent status rejected';

const source = path.join(work, 'source');
write(path.join(source, 'packages/model-reaction/package.json'), { name: 'model-reaction', version: '2.0.0' });
const output = path.join(work, 'must-not-be-created');
assert.throws(() => prepare(output, source), /requires historical model-reaction 1.2.0, not 2.0.0/);
assert.equal(fs.existsSync(output), false);
if (json(path.join(repo, 'packages/model-reaction/package.json')).version === '2.0.0') {
  assert.throws(() => prepare(output), /requires historical model-reaction 1.2.0, not 2.0.0/);
  assert.equal(fs.existsSync(output), false);
}
write(path.join(source, 'packages/model-reaction/package.json'), { name: 'model-reaction', version: '1.2.0' });
const existing = path.join(work, 'old-evidence');
write(path.join(existing, 'marker'), 'preserved');
assert.throws(() => prepare(existing, source), /Refusing to overwrite evidence/);
assert.equal(read(path.join(existing, 'marker')), 'preserved');
results.target_guard = 'PASS: incompatible target rejected before output/build/install; existing evidence preserved';

const runtime = path.join(work, 'runtime'), toolchain = path.join(runtime, 'toolchain');
const environment = {
  runtime, toolchain, package_version: '1.2.0', tarball_name: 'model-reaction-1.2.0-offline.tgz',
  dependencies: { 'model-reaction': 'file:./stale.tgz' },
};
write(path.join(toolchain, environment.tarball_name), 'synthetic offline artifact');
write(path.join(toolchain, 'package.json'), { private: true });
write(path.join(toolchain, 'package-lock.json'), {});
fs.mkdirSync(path.join(toolchain, 'node_modules'));
const root = path.join(runtime, 'project');
project(tasks[4], root, environment);
assert.equal(read(path.join(root, environment.tarball_name)), 'synthetic offline artifact');
assert.equal(json(path.join(root, 'package.json')).dependencies['model-reaction'], `file:./${environment.tarball_name}`);
assert.equal(tarballName({ package_version: '1.2.0' }), 'model-reaction-1.2.0.tgz');
assert.equal(tarballName({}), 'model-reaction-1.2.0.tgz');
assert.throws(() => tarballName({ tarball_name: '../outside.tgz' }), /Invalid tarball/);
write(path.join(toolchain, 'model-reaction-1.2.0.tgz'), 'legacy artifact');
const legacyRoot = path.join(runtime, 'legacy-project');
const { tarball_name: unused, ...legacyEnvironment } = environment;
project(tasks[4], legacyRoot, legacyEnvironment);
assert.equal(read(path.join(legacyRoot, 'model-reaction-1.2.0.tgz')), 'legacy artifact');
results.tarball = 'PASS: recorded filename consumed; legacy version fallback; traversal rejected';

// Exercise the report entry point, not only its shared assertion.
const report = path.join(work, 'report-rejection');
write(path.join(report, environment.tarball_name), 'synthetic offline artifact');
write(path.join(report, 'consumer-package-lock.json'), '{}');
write(path.join(report, 'source.diff'), '');
write(path.join(report, 'manifest.json'), {
  environment: {
    ...environment, tarball_sha256: sha('synthetic offline artifact'),
    consumer_lock_hash: sha('{}'), source_diff_hash: sha(''),
  },
  source_files: {}, prompts: { 'AI-01': sha(prompt(tasks[0])) }, configuration: { repetitions: 1 },
});
write(path.join(report, 'review.json'), {});
write(path.join(report, 'attempts/AI-01-r1/result.json'), original);
write(path.join(report, 'attempts/AI-01-r1/reviewed-result.json'), { ...reviewed, final_status: 'PASS' });
const reporting = spawnSync(process.execPath, [path.join(suite, 'report.mjs'), report], {
  encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
});
writeNew(path.join(work, 'report-rejection.log'), (reporting.stdout ?? '') + (reporting.stderr ?? ''));
assert.notEqual(reporting.status, 0);
assert.match(reporting.stderr, /inconsistent final_status/);
assert.equal(fs.existsSync(path.join(report, 'RESULTS.json')), false);
results.report = 'PASS: dynamic artifact verified, inconsistent reviewed status refused before aggregation';

// Reuse only the existing local compiler, copied into the trusted isolated toolchain.
const require = createRequire(path.join(repo, 'packages/model-reaction/package.json'));
const tsRoot = path.dirname(require.resolve('typescript/package.json'));
fs.cpSync(tsRoot, path.join(toolchain, 'node_modules/typescript'), { recursive: true, dereference: true });
write(path.join(root, 'tsconfig.json'), {
  compilerOptions: { target: 'ES2022', module: 'CommonJS', strict: true, types: [], outDir: 'dist', rootDir: 'src' },
  include: ['src/**/*.ts'],
});
const marker = path.join(work, 'outside-submission-marker');
write(marker, 'OFFLINE_MARKER_MUST_NOT_LEAK');
write(path.join(root, 'src/solution.ts'), `
declare function require(name: string): { readFileSync(file: string, encoding: 'utf8'): string };
export function createUsernameModel() {
  throw new Error(require('node:fs').readFileSync(${JSON.stringify(marker)}, 'utf8'));
}
`);
process.env.MR_EVALUATION_SECRET = 'must-not-be-inherited';
const capability = await sandboxWorker(root, environment, { mode: 'probe' });
writeNew(path.join(work, 'native-probe.json'), capability.record);
const acceptance = await grade(tasks[4], root, path.join(work, 'grade'), immutable(root), environment);
assert.notEqual(acceptance.status, 'PASS');
assert.ok(!acceptance.diagnostic.includes('OFFLINE_MARKER_MUST_NOT_LEAK'));
assert.equal(read(marker), 'OFFLINE_MARKER_MUST_NOT_LEAK');
if (capability.ok) {
  assert.equal(acceptance.status, 'FAIL');
  assert.equal(acceptance.compile, true);
  assert.equal(acceptance.constraints, true);
  assert.match(acceptance.diagnostic, /EPERM|EACCES/);
  results.sandbox = 'PASS: native denied-marker/env probe and compiled runtime denied read';
} else {
  assert.equal(acceptance.status, 'BLOCKED');
  assert.equal(acceptance.compile, false);
  assert.equal(acceptance.runtime, false);
  assert.equal(fs.existsSync(path.join(root, 'dist')), false);
  results.sandbox = `BLOCKED, fail-closed verified; compile/runtime not run: ${capability.limitation}`;
}
await assert.rejects(() => grade(tasks[4], root, path.join(work, 'grade'), immutable(root), environment),
  /Refusing to overwrite grading evidence/);
writeNew(path.join(work, 'results.json'), { work, results });
console.log(JSON.stringify({ work, results }, null, 2));
