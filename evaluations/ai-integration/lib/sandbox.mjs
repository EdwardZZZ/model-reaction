import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { permissionArgs } from './agent.mjs';
import { files, suite, write } from './environment.mjs';

const within = (file, directory) => file === directory || file.startsWith(directory + path.sep);
const overlaps = (a, b) => within(a, b) || within(b, a);
const maxOutput = 8 * 1024 * 1024;

function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute)) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch {}
  }
  throw new Error(`${name} is unavailable on PATH; no unsandboxed fallback`);
}

function toolchainPaths(root, environment) {
  if (!fs.lstatSync(root).isDirectory() || !fs.lstatSync(environment.toolchain).isDirectory()) {
    throw new Error('Project and toolchain roots must be real directories, not symlinks');
  }
  const runtime = fs.realpathSync(environment.runtime);
  root = fs.realpathSync(root);
  const toolchain = fs.realpathSync(environment.toolchain);
  const trusted = ['lib', 'checks'].map(dir => fs.realpathSync(path.join(suite, dir)));
  if (!within(root, runtime) || !within(toolchain, runtime) || overlaps(root, toolchain) ||
      [root, toolchain].some(dir => overlaps(dir, suite))) {
    throw new Error('Project and toolchain must be separate canonical runtime directories outside the suite');
  }
  if (fs.realpathSync(path.join(root, 'node_modules')) !== path.join(toolchain, 'node_modules')) {
    throw new Error('Project node_modules must point to the trusted toolchain');
  }
  for (const file of files(toolchain)) {
    if (fs.lstatSync(file).isSymbolicLink() && !within(fs.realpathSync(file), toolchain)) {
      throw new Error(`Toolchain symlink leaves its trusted root: ${file}`);
    }
  }
  return { root, toolchain, trusted };
}

export function workerPolicy(root, toolchain, trusted, node, immutable = []) {
  if (process.platform !== 'darwin') throw new Error('Grading sandbox is currently verified/configured only for macOS');
  // These are OS libraries, not broad /usr, /Library, home, or repository grants.
  const system = ['/System/Library', '/usr/lib',
    '/System/Volumes/Preboot/Cryptexes/OS/System/Library',
    '/System/Volumes/Preboot/Cryptexes/OS/usr/lib', '/dev/random', '/dev/urandom']
    .filter(file => fs.existsSync(file)).map(file => fs.realpathSync(file));
  const fixed = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'TASK.md',
    'node_modules', 'src/support.ts', 'src/support.tsx', ...immutable]);
  for (const file of fixed) {
    if (!within(path.resolve(root, file), root) || path.resolve(root, file) === root) {
      throw new Error(`Invalid immutable project path: ${file}`);
    }
  }
  return JSON.stringify({
    filesystem: {
      '/': 'deny',
      ...Object.fromEntries([...system, node, toolchain, ...trusted].map(file => [file, 'read'])),
      '/dev/null': 'write',
      [root]: 'write',
      ...Object.fromEntries([...fixed].map(file => [path.resolve(root, file), 'read'])),
    },
    network: { enabled: false },
  }, null, 2);
}

async function launch(exe, args, cwd, env, request, timeout) {
  return new Promise(resolve => {
    const child = spawn(exe, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, error, timedOut = false, overflow = false;
    const kill = () => {
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    const collect = which => chunk => {
      bytes += chunk.length;
      if (bytes > maxOutput) { overflow = true; kill(); return; }
      if (which === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
    child.on('error', caught => { error = caught.message; });
    // Terminate remaining children even if the worker exits before its descendants.
    child.on('exit', kill);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, error, timed_out: timedOut, output_limit: overflow, stdout, stderr });
    });
  });
}

export async function sandboxWorker(root, environment, request) {
  let control, local, execution;
  const record = { boundary: 'codex sandbox -P evaluation', network: 'disabled; no network probe performed' };
  try {
    const paths = toolchainPaths(root, environment);
    root = paths.root;
    const node = fs.realpathSync(process.execPath), cli = executable('codex');
    fs.accessSync(node, fs.constants.X_OK);
    if (within(node, root) || within(cli, root)) throw new Error('Worker executables cannot come from the submission');
    const policy = workerPolicy(root, paths.toolchain, paths.trusted, node, Object.keys(request.expectedImmutable ?? {}));
    // Resolve CLI configuration outside the submission and outside the repository.
    control = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mr-evaluation-control-'));
    local = fs.mkdtempSync(path.join(root, '.evaluation-'));
    const home = path.join(control, 'home'), tmp = path.join(control, 'tmp');
    for (const dir of [home, tmp, path.join(local, 'home'), path.join(local, 'tmp')]) fs.mkdirSync(dir);
    const denied = path.join(control, 'denied-marker');
    write(denied, 'EVALUATION_OUTSIDE_MARKER\n');
    const readable = path.join(local, 'readable-marker');
    write(readable, 'EVALUATION_INSIDE_MARKER\n');
    const link = path.join(local, 'denied-link');
    fs.symlinkSync(denied, link);
    const env = {
      PATH: `${path.dirname(node)}:/usr/bin:/bin`, HOME: home, CODEX_HOME: home, TMPDIR: tmp,
      LANG: 'C', NO_COLOR: '1',
    };
    const args = ['sandbox', '-P', 'evaluation', ...permissionArgs(policy), '-C', control,
      node, path.join(suite, 'lib/worker.mjs')];
    Object.assign(record, { policy: JSON.parse(policy), executable: cli, node, args, cwd: control, env });
    execution = await launch(cli, args, control, env, {
      ...request, root, toolchain: paths.toolchain, local,
      probe: { denied, link, readable, reference: path.join(suite, 'references/AI-01.ts') },
    }, request.mode === 'probe' ? 15000 : 180000);
    Object.assign(record, execution);
    let response;
    try { response = JSON.parse(execution.stdout); } catch {}
    if (execution.status !== 0 || execution.error || execution.timed_out || execution.output_limit ||
        response?.probe !== 'PASS' || !response?.result) {
      throw new Error(response?.limitation ??
        `Native worker did not complete: exit=${execution.status}, signal=${execution.signal}, ` +
        `timeout=${execution.timed_out}, output_limit=${execution.output_limit}` +
        (execution.error ? `, error=${execution.error}` : '') +
        (execution.stderr ? `\n${execution.stderr}` : ''));
    }
    return { ok: true, result: response.result, record };
  } catch (error) {
    record.limitation = error.message;
    return { ok: false, record, limitation: `Grading sandbox unavailable or failed closed: ${error.message}` };
  } finally {
    // Only delete parent-owned control data. Submission-writable local paths stay in the project.
    if (control) fs.rmSync(control, { recursive: true, force: true });
  }
}
