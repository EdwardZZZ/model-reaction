import assert from 'node:assert/strict';
import { createBusinessModel } from './business-model.js';
import { createIdentitySchema } from './identity-schema.js';
import { appendLine, changeCity } from './operations.js';

async function run() {
  const model = createBusinessModel();
  const other = createBusinessModel();
  let cityChanges = 0;
  let lineChanges = 0;
  const offCity = model.subscribe(data => data.address, () => { cityChanges++; });
  const offLines = model.subscribe(data => data.lines, () => { lineChanges++; });

  try {
    assert.equal(model.data.note, undefined);
    assert.notEqual(model.data.address, other.data.address);
    assert.notEqual(model.data.lines, other.data.lines);
    assert.notEqual(model.data.lines[0], other.data.lines[0]);
    const statusRule = createIdentitySchema().status.validator[0];
    assert.ok(statusRule);
    assert.equal(statusRule.validate('deleted'), false);
    assert.equal(await model.setField('status', 'published'), true);
    assert.equal(await changeCity(model, 'Shanghai'), true);
    assert.equal(await appendLine(model, { sku: 'pen', qty: 2 }), true);
    assert.equal(cityChanges, 1);
    assert.equal(lineChanges, 1);
    assert.equal(model.data.address.city, 'Shanghai');
    assert.deepEqual(model.data.lines, [{ sku: 'book', qty: 1 }, { sku: 'pen', qty: 2 }]);
    assert.equal(other.data.address.city, 'Hangzhou');
    assert.deepEqual(other.data.lines, [{ sku: 'book', qty: 1 }]);
    console.log('PASS schema composition: validation rule, replacements, subscriptions, independent defaults');
    console.log(model.data);
  } finally {
    offCity();
    offLines();
    model.dispose();
    other.dispose();
  }
}

void run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
