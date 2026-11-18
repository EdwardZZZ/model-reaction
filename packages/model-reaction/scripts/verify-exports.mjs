import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entries = [
  ['model-reaction', 'createModel', 'function'],
  ['model-reaction', 'SKIP_REACTION', 'symbol'],
  ['model-reaction/validation', 'Rule', 'function'],
  ['model-reaction/validation', 'ValidationRules', 'object'],
  ['model-reaction/validation', 'formatValidationErrors', 'function'],
  ['model-reaction/react', 'useDraftField', 'function'],
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

const esmRoot = await import('model-reaction');
const cjsRoot = require('model-reaction');
const esmDevtools = await import('model-reaction/devtools');
const cjsDevtools = require('model-reaction/devtools');

assert.deepEqual(Object.keys(esmDevtools), ['createModel'], 'ESM DevTools public exports');
assert.deepEqual(Object.keys(cjsDevtools), ['createModel'], 'CommonJS DevTools public exports');

for (const entry of [esmRoot, cjsRoot, esmDevtools, cjsDevtools]) {
  for (const name of ['Rule', 'ValidationRules', 'formatValidationErrors']) {
    assert.equal(name in entry, false, `${name} is available only via validation`);
  }
  const model = entry.createModel({ value: { type: 'string', default: '' } });
  assert.equal('subscribeField' in model, false, 'removed field subscription API');
  model.dispose();
}
for (const entry of [await import('model-reaction/validation'), require('model-reaction/validation')]) {
  const model = esmRoot.createModel({
    value: {
      type: 'string',
      default: 'valid',
      validator: [entry.ValidationRules.required.withMessage('required')],
    },
  });
  assert.equal(await model.setField('value', ''), false, 'validation helpers compose with core');
  assert.equal(entry.formatValidationErrors(model.validationErrors), 'value: required');
  model.dispose();
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

  await model.setField('source', 'update');
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
  await model.setField('source', 3);
  await model.settled();
  assert.deepEqual(observed, [4, 4, 6, 6], `${label} runs later groups`);
  model.dispose();
}

await verifyActionArray(esmRoot.createModel, 'ESM root');
await verifyActionArray(cjsRoot.createModel, 'CommonJS root');
await verifyActionArray(esmDevtools.createModel, 'ESM DevTools');
await verifyActionArray(cjsDevtools.createModel, 'CommonJS DevTools');

console.log('Verified ESM and CommonJS package exports.');
