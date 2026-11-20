import path from 'node:path';
import { createRequire } from 'node:module';
import { core } from './core.mjs';
import { mounted } from './react.mjs';

const [id, project] = process.argv.slice(2);
const require = createRequire(path.join(project, 'package.json'));
const owned = [], unhandled = [];
const own = model => { owned.push(model); return model; };
process.on('unhandledRejection', error => unhandled.push(error));
const watchdog = setTimeout(() => {
  console.error(`TIMEOUT ${id}: acceptance barrier not reached within 20 seconds`);
  process.exit(1);
}, 20000);
try {
  const reactTask = /^AI-(07|08|09|10)$/.test(id);
  let dom;
  if (reactTask) {
    const { JSDOM } = require('jsdom');
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent']) {
      Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name], writable: true });
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  }
  const solution = require(path.join(project, 'dist/solution.js'));
  if (reactTask) {
    const support = id === 'AI-07' ? {} : require(path.join(project, 'dist/support.js'));
    await mounted(id, solution, support, own, require);
  } else await core(id, solution, own, require);
  for (const model of owned) model.dispose();
  await new Promise(resolve => setImmediate(resolve));
  if (unhandled.length) throw new AggregateError(unhandled, 'Unhandled rejections');
  dom?.window.close();
  console.log(`PASS ${id}: runtime acceptance and cleanup`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const model of owned) model.dispose();
  clearTimeout(watchdog);
}
