import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const suite = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repo = path.resolve(suite, '../..');
export const historicalVersion = '1.2.0';
export const historicalCommit = '8678594c9f0b6f828d97258f6b01a4aaf0f785fa';
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const read = file => fs.readFileSync(file, 'utf8');
export const json = file => JSON.parse(read(file));
export function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
export function writeNew(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function tarballName(environment) {
  const name = environment.tarball_name ?? `model-reaction-${environment.package_version ?? historicalVersion}.tgz`;
  if (!/^model-reaction-[0-9][0-9A-Za-z.+-]*\.tgz$/.test(name)) throw new Error(`Invalid tarball filename: ${name}`);
  return name;
}
export function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
export function treeHash(dir) {
  return sha(files(dir).sort().map(file => {
    if (!fs.lstatSync(file).isFile()) throw new Error(`Cannot hash non-regular evidence file: ${file}`);
    return `${path.relative(dir, file)}\0${sha(fs.readFileSync(file))}`;
  }).join('\n'));
}
export function command(exe, args, cwd, log, timeout = 120000) {
  const result = spawnSync(exe, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const text = (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? `\n${result.error.stack}` : '');
  if (log) write(log, text);
  return { ok: result.status === 0 && !result.error, status: result.status, text,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
export function prepare(output, sourceRepo = repo) {
  sourceRepo = fs.realpathSync(sourceRepo);
  const packageDir = path.join(sourceRepo, 'packages/model-reaction');
  const target = json(path.join(packageDir, 'package.json'));
  if (target.name !== 'model-reaction' || target.version !== historicalVersion) {
    throw new Error(`ai-integration-v1 requires historical model-reaction ${historicalVersion}, not ${target.version}. ` +
      `Use a separate source checkout at ${historicalCommit} as prepare(output, sourceRepo); ` +
      'current APIs require a separately versioned reference suite. No build or install was started.');
  }
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error(`Refusing to overwrite evidence: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  const runtime = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mr-ai-v1-'));
  const toolchain = path.join(runtime, 'toolchain');
  fs.mkdirSync(toolchain);
  const build = command('pnpm', ['--filter', 'model-reaction', 'run', 'build'], sourceRepo, path.join(output, 'build.log'));
  if (!build.ok) throw new Error(`Build failed; see ${output}/build.log`);
  const packed = command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', toolchain],
    packageDir, path.join(output, 'pack.log'));
  if (!packed.ok) throw new Error('Pack failed');
  const packInfo = JSON.parse(packed.stdout);
  const packedPackage = Array.isArray(packInfo) ? packInfo[0] : packInfo['model-reaction'];
  if (packedPackage?.name !== target.name || packedPackage.version !== target.version ||
      typeof packedPackage.filename !== 'string') throw new Error('Pack metadata does not match source package');
  const artifact = tarballName({ tarball_name: packedPackage.filename });
  const dependencies = {
    'model-reaction': `file:./${artifact}`,
    typescript: '5.9.3', react: '19.3.0', 'react-dom': '19.3.0',
    '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@types/node': '24.13.5',
    '@testing-library/react': '16.3.3', jsdom: '26.1.0', '@sinonjs/fake-timers': '15.4.0',
  };
  write(path.join(toolchain, 'package.json'), { name: 'mr-ai-toolchain', private: true, dependencies });
  const installed = command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', 'https://registry.npmmirror.com'], toolchain, path.join(output, 'install.log'), 600000);
  if (!installed.ok) throw new Error(`Install failed; see ${output}/install.log`);
  fs.copyFileSync(path.join(toolchain, artifact), path.join(output, artifact), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(toolchain, 'package-lock.json'), path.join(output, 'consumer-package-lock.json'));
  const source = command('git', ['rev-parse', 'HEAD'], sourceRepo).text.trim();
  const diff = command('git', ['diff', '--binary'], sourceRepo).text;
  write(path.join(output, 'source.diff'), diff);
  const manifest = {
    suite_version: 'ai-integration-v1', source_commit: source,
    source_diff_hash: sha(diff), package_version: target.version, tarball_name: artifact, source_repo: sourceRepo,
    tarball_sha256: sha(fs.readFileSync(path.join(toolchain, artifact))),
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
  console.log(JSON.stringify(prepare(output, process.argv[3] ? path.resolve(process.argv[3]) : repo), null, 2));
}
