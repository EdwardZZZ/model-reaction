import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entries = [
  ['model-reaction', 'createModel', 'function'],
  ['model-reaction', 'SKIP_REACTION', 'symbol'],
  ['model-reaction/react', 'useModelField', 'function'],
  ['model-reaction/react', 'useModelSelector', 'function'],
  ['model-reaction/react', 'useModelComputed', 'function'],
  ['model-reaction/react', 'useModelFieldState', 'function'],
  ['model-reaction/devtools', 'createModel', 'function'],
];

for (const [specifier, exportName, expectedType] of entries) {
  const esm = await import(specifier);
  assert.equal(typeof esm[exportName], expectedType, `${specifier} ESM export`);

  const cjs = require(specifier);
  assert.equal(typeof cjs[exportName], expectedType, `${specifier} CommonJS export`);
}
for (const entry of [await import('model-reaction/react'), require('model-reaction/react')]) {
  assert.equal('useDraftField' in entry, false, 'draft binding was removed');
}

const esmRoot = await import('model-reaction');
const cjsRoot = require('model-reaction');
const esmDevtools = await import('model-reaction/devtools');
const cjsDevtools = require('model-reaction/devtools');

for (const entry of [esmRoot, cjsRoot, esmDevtools, cjsDevtools]) {
  for (const name of ['Rule', 'ValidationRules', 'formatValidationErrors']) {
    assert.equal(name in entry, false, `${name} was removed`);
  }
  const model = entry.createModel({ value: { type: 'string', default: '' } });
  assert.equal('subscribeField' in model, false, 'removed field subscription API');
  for (const name of ['validateAll', 'validationErrors', 'getDirtyData', 'clearDirtyData']) {
    assert.equal(name in model, false, `${name} was removed`);
  }
  assert.equal(model.setField('value', 'ready'), undefined, 'setter returns synchronously');
  assert.equal(model.data.value, 'ready');
  assert.throws(() => model.setField('unknown', 1), /does not exist/);
  model.dispose();
}
await assert.rejects(import('model-reaction/validation'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
assert.throws(() => require('model-reaction/validation'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
for (const entry of [esmRoot, cjsRoot]) {
  assert.deepEqual(Object.values(entry.ModelEvents).sort(), [
    'dependency:error', 'field:change', 'field:not-found', 'reaction:error',
  ]);
}

assert.equal(
  esmRoot.SKIP_REACTION,
  cjsRoot.SKIP_REACTION,
  'SKIP_REACTION identity across ESM and CommonJS',
);

async function verifySkipReaction(createModel, label) {
  let actionCalls = 0;
  const model = createModel({
    source: { type: 'string' },
    target: {
      type: 'string',
      default: 'initial',
      reaction: {
        fields: ['source'],
        computed: () => esmRoot.SKIP_REACTION,
        action: [() => {
          actionCalls += 1;
        }],
      },
    },
  });

  model.setField('source', 'update');
  await model.settled();
  assert.equal(model.getField('target'), 'initial', `${label} skips commit`);
  assert.equal(actionCalls, 0, `${label} skips action`);
  model.dispose();
}

await verifySkipReaction(esmRoot.createModel, 'ESM root');
await verifySkipReaction(cjsRoot.createModel, 'CommonJS root');
await verifySkipReaction(esmDevtools.createModel, 'ESM DevTools');
await verifySkipReaction(cjsDevtools.createModel, 'CommonJS DevTools');

async function verifyActionArray(createModel, label) {
  const observed = [];
  const model = createModel({
    source: { type: 'number', default: 2 },
    target: {
      type: 'number',
      default: 0,
      reaction: {
        fields: ['source'],
        computed: ({ source }) => source * 2,
        action: [
          async (...args) => {
            assert.deepEqual(args, [], `${label} calls action without arguments`);
            observed.push(model.data.target);
          },
          () => { observed.push(model.data.target); },
        ],
      },
    },
  });
  assert.deepEqual(observed, [], `${label} defers initialization actions`);
  await model.settled();
  assert.deepEqual(observed, [4, 4], `${label} awaits the initialized group`);
  assert.equal(model.setField('source', 3), undefined, `${label} synchronous setter`);
  assert.equal(model.data.target, 6, `${label} computation completes synchronously`);
  await model.settled();
  assert.deepEqual(observed, [4, 4, 6, 6], `${label} runs later groups`);
  model.dispose();
}

await verifyActionArray(esmRoot.createModel, 'ESM root');
await verifyActionArray(cjsRoot.createModel, 'CommonJS root');
await verifyActionArray(esmDevtools.createModel, 'ESM DevTools');
await verifyActionArray(cjsDevtools.createModel, 'CommonJS DevTools');

console.log('Verified ESM and CommonJS package exports.');
