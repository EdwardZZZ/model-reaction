import assert from 'node:assert/strict';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function service() {
  const calls = [], waiters = [], queue = [];
  const invoke = (...args) => {
    const request = { args, ...deferred() };
    calls.push(request);
    if (waiters.length) waiters.shift()(request); else queue.push(request);
    return request.promise;
  };
  return { invoke, calls, next: () => queue.length ? Promise.resolve(queue.shift()) :
    new Promise(resolve => waiters.push(resolve)) };
}
export const empty = value => assert.deepEqual(Object.keys(value), []);
const noErrors = value => assert.deepEqual(Object.values(value).flat(), []);
const values = (model, expected) => {
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(model.data[key], value, `committed ${key}`);
};
export async function core(id, s, own, require) {
  if (id === 'AI-01') {
    const m = own(s.createUserModel()); values(m, { name: '', age: 18 }); empty(m.validationErrors);
    assert.equal(await m.validateAll(), false, 'unvalidated required default');
    assert.equal(await m.setField('name', 'Ada'), true); assert.equal(await m.validateAll(), true);
    for (const age of [17, NaN, Infinity]) {
      assert.equal(await m.setField('age', age), false, `reject age=${age}`); assert.equal(m.data.age, 18);
    }
    assert.equal(await m.setField('age', 21), true); assert.equal(m.data.age, 21);
  }
  if (id === 'AI-02') {
    const m = own(s.createNameModel()), errors = [];
    const off = m.on('validation:error', e => errors.push(e));
    assert.equal(await m.setField('name', 'Bo'), false); values(m, { name: 'Ada' });
    assert.equal(m.getDirtyData().name, 'Bo'); assert.equal(m.validationErrors.name.length, 1);
    assert.equal(await m.setField('name', ''), false);
    assert.equal(m.validationErrors.name.length, 1);
    assert.match(m.validationErrors.name[0].rule ?? m.validationErrors.name[0].message, /required|必填/i);
    assert.equal(errors.length, 2);
    m.clearDirtyData(); empty(m.getDirtyData()); assert.equal(m.validationErrors.name.length, 1);
    values(m, { name: 'Ada' }); assert.equal(await m.setField('name', 'Grace'), true);
    noErrors(m.validationErrors); empty(m.getDirtyData()); off();
    await m.setField('name', ''); assert.equal(errors.length, 2, 'unsubscribe error events');
  }
  if (id === 'AI-03') {
    const m = own(s.createPasswordModel());
    assert.equal(await m.setFields({ password: '  new-secret  ', confirm: 'new-secret' }), true);
    values(m, { password: 'new-secret', confirm: 'new-secret' });
    assert.equal(await m.setFields({ password: 'next-secret', confirm: 'wrong', memo: 'saved' }), false);
    values(m, { password: 'next-secret', confirm: 'new-secret', memo: 'saved' });
    assert.equal(m.getDirtyData().confirm, 'wrong');
    let transforms = 0, missing = 0;
    const n = own(s.createPasswordModel(() => transforms++));
    const off = n.on('field:not-found', () => missing++);
    await assert.rejects(n.setFields({ password: 'different', unknownField: true }));
    assert.equal(missing, 1); assert.equal(transforms, 0);
    values(n, { password: 'old-password', confirm: 'old-password', memo: 'old' }); off();
  }
  if (id === 'AI-04') {
    const clock = require('@sinonjs/fake-timers').install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    async function advance(promise) {
      let done = false, result, failure;
      promise.then(v => { result = v; done = true; }, e => { failure = e; done = true; });
      for (let n = 0; !done && n < 100; n++) await clock.tickAsync(10);
      assert.equal(done, true, 'operation must settle within virtual debounce ticks');
      if (failure) throw failure; return result;
    }
    try {
      const m = own(s.createCartModel());
      await advance(m.settled()); values(m, { subtotal: 20, total: 18 });
      const first = await advance(s.updateCart(m, { price: 20, quantity: 3, discount: 5 }));
      assert.equal(first.subtotal, 60); assert.equal(first.total, 55);
      const second = await advance(s.updateCart(m, { discount: 10 }));
      assert.equal(second.total, 50);
      await advance(s.updateCart(m, { price: 200, quantity: 1 }));
      values(m, { subtotal: 60, total: 50 }); assert.equal(m.getDirtyData().subtotal, 200);
      // Direct writes also exercise the declared graph, independently of the business wrapper.
      await advance(m.setFields({ price: 5, quantity: 4 })); await advance(m.settled());
      values(m, { subtotal: 20, total: 10 });
    } finally { clock.uninstall(); }
  }
  if (id === 'AI-05') {
    for (const bobOK of [true, false]) {
      const availability = service(), m = own(s.createUsernameModel(availability.invoke));
      const aliceWrite = m.setField('username', 'alice'), alice = await availability.next();
      const bobWrite = m.setField('username', 'bob'), bob = await availability.next();
      assert.deepEqual([alice.args[0], bob.args[0]], ['alice', 'bob']);
      bob.resolve(bobOK); await bobWrite; alice.resolve(!bobOK);
      await aliceWrite; await m.settled();
      values(m, { username: bobOK ? 'bob' : 'guest' });
      if (bobOK) { noErrors(m.validationErrors); empty(m.getDirtyData()); }
      else { assert.equal(m.getDirtyData().username, 'bob'); assert.equal(m.validationErrors.username.length, 1); }
    }
  }
  if (id === 'AI-06') {
    const quote = service(), audit = service();
    const m = own(s.createShippingModel({ quote: quote.invoke, audit: audit.invoke }));
    await m.settled(); assert.equal(quote.calls.length, 0);
    await m.setField('postcode', ' 10001 ');
    const q = await quote.next(); assert.deepEqual(q.args, ['10001']);
    let settled = false; const waiting = m.settled().then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false, 'quote is tracked');
    q.resolve(12); const a = await audit.next(); assert.deepEqual(a.args, [12]);
    assert.equal(m.data.fee, 12); await Promise.resolve(); assert.equal(settled, false, 'audit is tracked');
    a.resolve(); await waiting; values(m, { fee: 12, total: 112 });
    await m.setField('postcode', ''); await m.settled();
    assert.equal(quote.calls.length, 1); values(m, { fee: 12, total: 112 });
    await m.setField('postcode', 'abc'); await m.settled();
    assert.equal(quote.calls.length, 1); assert.equal(m.getDirtyData().requestKey, 'abc');
    assert.ok(m.validationErrors.requestKey?.length);
    const failure = service(), errors = [];
    const n = own(s.createShippingModel({ quote: failure.invoke, audit: async () => {} }));
    const off = n.on('reaction:error', e => errors.push(e));
    await n.setField('postcode', '10001'); const f = await failure.next();
    f.reject(new Error('quote failed')); await n.settled();
    assert.equal(errors.length, 1); assert.equal(errors[0].field, 'requestKey');
    assert.ok(n.validationErrors.requestKey?.some(e => /quote failed/.test(e.message)));
    assert.equal(n.data.fee, 0); off();
  }
  if (id === 'AI-11') {
    const m = own(s.createBusinessModel()), n = own(s.createBusinessModel());
    values(m, { name: 'Ada', status: 'draft', note: undefined, address: { city: 'Hangzhou' }, lines: [{ sku: 'book', qty: 1 }] });
    let city = 0, lines = 0;
    const offA = m.subscribe(d => d.address, () => city++);
    const offL = m.subscribe(d => d.lines, () => lines++);
    await s.changeCity(m, 'Shanghai'); await s.appendLine(m, { sku: 'pen', qty: 2 });
    assert.equal(city, 1); assert.equal(lines, 1);
    assert.equal(m.data.address.city, 'Shanghai'); assert.equal(m.data.lines.length, 2);
    assert.equal(n.data.address.city, 'Hangzhou'); assert.equal(n.data.lines.length, 1);
    assert.equal(await m.setField('status', 'invalid-status'), false); assert.equal(m.data.status, 'draft');
    offA(); offL();
  }
  if (id === 'AI-12') {
    const saved = [], m = own(s.createLegacyCart(data => { saved.push({ ...data }); }));
    await m.settled(); saved.length = 0;
    const prices = [], off = s.subscribePrice(m, p => prices.push(p));
    assert.equal(typeof off, 'function');
    assert.equal(await m.setFields({ price: 20, quantity: 3 }), true); await m.settled();
    values(m, { subtotal: 60, total: 60 }); assert.equal(saved.length, 1, 'shared action deduplicated');
    assert.deepEqual(saved[0], { price: 20, quantity: 3, subtotal: 60, total: 60 });
    assert.deepEqual(prices, [20]); off();
    const missing = [], invalid = [];
    const offM = m.on('field:not-found', e => missing.push(e));
    const offV = m.on('validation:error', e => invalid.push(e));
    await assert.rejects(m.setFields({ unknownField: 1 })); assert.equal(missing.length, 1);
    assert.equal(await m.setField('price', -1), false); assert.equal(m.data.price, 20);
    assert.equal(await m.setField('quantity', 1.5), false);
    assert.equal(await m.setField('quantity', 0), false);
    assert.equal(await m.setField('price', Infinity), false);
    assert.ok(invalid.length); await m.setField('price', 21); await m.settled();
    assert.deepEqual(prices, [20]); offM(); offV();
  }
}
