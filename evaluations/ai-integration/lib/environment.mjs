import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const suite = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repo = path.resolve(suite, '../..');
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const read = file => fs.readFileSync(file, 'utf8');
export const json = file => JSON.parse(read(file));
export function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
export function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
export function treeHash(dir) {
  return sha(files(dir).sort().map(file => `${path.relative(dir, file)}\0${sha(fs.readFileSync(file))}`).join('\n'));
}
export function command(exe, args, cwd, log, timeout = 120000) {
  const result = spawnSync(exe, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const text = (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? `\n${result.error.stack}` : '');
  if (log) write(log, text);
  return { ok: result.status === 0 && !result.error, status: result.status, text };
}
export function prepare(output) {
  const runtime = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mr-ai-v1-'));
  const toolchain = path.join(runtime, 'toolchain');
  fs.mkdirSync(toolchain);
  const build = command('pnpm', ['--filter', 'model-reaction', 'run', 'build'], repo, path.join(output, 'build.log'));
  if (!build.ok) throw new Error(`Build failed; see ${output}/build.log`);
  const packed = command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', toolchain],
    path.join(repo, 'packages/model-reaction'), path.join(output, 'pack.log'));
  if (!packed.ok) throw new Error('Pack failed');
  const packInfo = JSON.parse(packed.text);
  const tarballName = (Array.isArray(packInfo) ? packInfo[0] : packInfo['model-reaction']).filename;
  const dependencies = {
    'model-reaction': `file:./${tarballName}`,
    typescript: '5.9.3', react: '19.3.0', 'react-dom': '19.3.0',
    '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@types/node': '24.13.5',
    '@testing-library/react': '16.3.3', jsdom: '26.1.0', '@sinonjs/fake-timers': '15.4.0',
  };
  write(path.join(toolchain, 'package.json'), { name: 'mr-ai-toolchain', private: true, dependencies });
  const installed = command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', 'https://registry.npmmirror.com'], toolchain, path.join(output, 'install.log'), 600000);
  if (!installed.ok) throw new Error(`Install failed; see ${output}/install.log`);
  fs.copyFileSync(path.join(toolchain, tarballName), path.join(output, tarballName));
  fs.copyFileSync(path.join(toolchain, 'package-lock.json'), path.join(output, 'consumer-package-lock.json'));
  const source = command('git', ['rev-parse', 'HEAD'], repo).text.trim();
  const diff = command('git', ['diff', '--binary'], repo).text;
  write(path.join(output, 'source.diff'), diff);
  const manifest = {
    suite_version: 'ai-integration-v1', source_commit: source,
    source_diff_hash: sha(diff), package_version: '1.2.0',
    tarball_sha256: sha(fs.readFileSync(path.join(toolchain, tarballName))),
    docs_hash: treeHash(path.join(toolchain, 'node_modules/model-reaction/docs')),
    consumer_lock_hash: sha(read(path.join(toolchain, 'package-lock.json'))),
    node_version: process.version, package_manager_version: command('npm', ['--version'], repo).text.trim(),
    agent_product: command('codex', ['--version'], repo).text.trim(),
    runtime, toolchain, dependencies, prepared_at: new Date().toISOString(),
  };
  write(path.join(output, 'environment.json'), manifest);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? path.join(suite, 'runs/baseline-v1'));
  fs.mkdirSync(output, { recursive: true });
  console.log(JSON.stringify(prepare(output), null, 2));
}
