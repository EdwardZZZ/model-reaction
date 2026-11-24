import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
            assert.deepEqual(args, [{ field: 'target', value: model.data.target }], `${label} passes action context`);
            observed.push(args[0].value);
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

async function verifyDeclarations() {
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const temporary = await mkdtemp(path.join(tmpdir(), 'model-reaction-declarations-'));
  try {
    await mkdir(path.join(temporary, 'node_modules'));
    await symlink(packageRoot, path.join(temporary, 'node_modules/model-reaction'), 'junction');
    const contracts = (await readFile(
      new URL('../src/__tests__/public-type-contracts.ts', import.meta.url), 'utf8',
    )).replaceAll("'../index'", "'model-reaction'");
    const entryContracts = `
import { createModel as createDevtoolsModel } from 'model-reaction/devtools';
import { formatValidationErrors } from 'model-reaction/validation';
import { useDraftField, useModelField, useModelFields, useModelFieldState, useModelSelector, useModelComputed, Field } from 'model-reaction/react';
import type { ModelFieldKey, ModelFieldName, ValidationErrors } from 'model-reaction';
const devtools: typeof createModel = createDevtoolsModel;
const root: typeof createDevtoolsModel = createModel;
function verifyEntries() {
  const model = createModel({ 0: { type: 'number', default: 1 } });
  const key: ModelFieldKey<typeof model.data> = 0;
  const name: ModelFieldName<typeof model.data> = '0';
  const errors: ValidationErrors = model.validationErrors;
  const field: number = useModelField(model, key);
  const fields: { 0: number } = useModelFields(model, [key]);
  const state: number = useModelFieldState(model, key)[0];
  const draft: number = useDraftField(model, key).committed;
  const selected: number = useModelSelector(model, (data) => data[0], Object.is);
  const computed: number = useModelComputed(model, (data) => data[0] * 2, Object.is);
  // @ts-expect-error selector hooks have no debug argument
  useModelSelector(model, (data) => data[0], undefined, 'selected');
  // @ts-expect-error selector hooks have no debug argument
  useModelComputed(model, (data) => data[0], undefined, { fields: [0] });
  Field({ model, name: key, children: ({ value }) => { const v: number = value; return v; } });
  formatValidationErrors(errors);
  // @ts-expect-error React fields share the string/number key contract
  useModelField(model, Symbol('field'));
  void [devtools, root, name, field, fields, state, draft, selected, computed];
}
void verifyEntries;
`;
    for (const [label, module, moduleResolution, extension] of [
      ['Bundler ESM', ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler, '.mts'],
      ['NodeNext ESM', ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext, '.mts'],
      ['NodeNext CommonJS', ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext, '.cts'],
    ]) {
      const source = path.join(temporary, `contracts${extension}`);
      await writeFile(source, contracts + entryContracts);
      const program = ts.createProgram([source], {
        target: ts.ScriptTarget.ES2022,
        module,
        moduleResolution,
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        types: [],
        noEmit: true,
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      assert.equal(diagnostics.length, 0, `${label} declarations:\n${ts.formatDiagnosticsWithColorAndContext(
        diagnostics,
        {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => temporary,
          getNewLine: () => '\n',
        },
      )}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await verifyDeclarations();
console.log('Verified runtime exports and exact declaration contracts in Bundler/NodeNext ESM/CommonJS.');
