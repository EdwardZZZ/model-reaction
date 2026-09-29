import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entries = [
  ['model-reaction', 'createModel'],
  ['model-reaction/react', 'useDraftField'],
  ['model-reaction/react', 'useModelFieldState'],
  ['model-reaction/devtools', 'createModel'],
];

for (const [specifier, exportName] of entries) {
  const esm = await import(specifier);
  assert.equal(typeof esm[exportName], 'function', `${specifier} ESM export`);

  const cjs = require(specifier);
  assert.equal(typeof cjs[exportName], 'function', `${specifier} CommonJS export`);
}

console.log('Verified ESM and CommonJS package exports.');
