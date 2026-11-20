import assert from 'node:assert/strict';
import { deferred, service } from './core.mjs';

export async function mounted(id, s, support, own, require) {
  const React = require('react'), { act, createElement: h, StrictMode } = React;
  const { render, fireEvent, cleanup, within } = require('@testing-library/react');
  const errorText = (view, id) => view.queryByTestId(id)?.textContent ?? '';
  const change = async (view, label, value) => act(async () => { fireEvent.change(view.getByLabelText(label), { target: { value } }); });
  try {
    if (id === 'AI-07') {
      const check = service(), m = own(s.createAmountModel(check.invoke));
      const view = render(h(s.AmountInput, { model: m }));
      await change(view, 'amount', '3.50');
      const first = await check.next(); assert.equal(first.args[0], 3.5);
      assert.equal(view.getByLabelText('amount').value, '3.50'); assert.equal(m.data.amount, 10);
      await act(async () => { first.resolve(true); await m.settled(); });
      assert.equal(m.data.amount, 3.5); assert.equal(view.getByLabelText('amount').value, '3.50');
      await change(view, 'amount', '-1'); await act(async () => { await m.settled(); fireEvent.blur(view.getByLabelText('amount')); });
      assert.equal(view.getByLabelText('amount').value, '-1'); assert.equal(m.data.amount, 3.5);
      assert.equal(m.getDirtyData().amount, -1); assert.ok(errorText(view, 'amount-error'));
      const dirty = m.getDirtyData();
      await change(view, 'amount', '!');
      assert.match(errorText(view, 'amount-error'), /Invalid amount text/);
      assert.deepEqual(m.getDirtyData(), dirty, 'transform exception is not dirty input');
      await change(view, 'amount', '4'); const next = await check.next();
      await act(async () => { next.resolve(true); await m.settled(); });
      assert.equal(m.data.amount, 4); assert.equal(errorText(view, 'amount-error'), '');
      await act(async () => {
        const write = m.setField('amount', 8); const external = await check.next();
        external.resolve(true); await write; await m.settled();
      });
      assert.equal(view.getByLabelText('amount').value, '8');
    }
    if (id === 'AI-08') {
      const m = own(support.createFormModel(async () => 12));
      await m.settled(); let saved = 0;
      let view = render(h(s.Form, { model: m, save: async () => { saved++; } }));
      await act(async () => { fireEvent.submit(view.getByRole('button').closest('form')); });
      assert.equal(saved, 0, 'required untouched name blocks save'); assert.ok(errorText(view, 'submit-error'));
      await act(async () => { await m.setField('name', 'Ada'); });
      await change(view, 'price', '!');
      await act(async () => { fireEvent.submit(view.getByRole('button').closest('form')); });
      assert.equal(saved, 0, 'input-layer exception blocks valid old data');
      assert.ok(errorText(view, 'submit-error')); view.unmount();

      const quote = deferred(), checkName = deferred(), save = service();
      const n = own(support.createFormModel(() => quote.promise, () => checkName.promise));
      const originalValidate = n.validateAll.bind(n); let fullChecks = 0, inputReady = false;
      n.validateAll = async () => {
        assert.equal(inputReady, true, 'full validation starts after existing work settles');
        fullChecks++; return originalValidate();
      };
      view = render(h(s.Form, { model: n, save: save.invoke }));
      await change(view, 'name', 'Ada'); await change(view, 'price', '20'); await change(view, 'quantity', '3');
      await act(async () => {
        const form = view.getByRole('button').closest('form'); fireEvent.submit(form); fireEvent.submit(form);
      });
      assert.equal(fullChecks, 0, 'pending quote/name precede full validation');
      for (const input of view.getAllByRole('textbox')) assert.ok(input.disabled || input.closest('fieldset')?.disabled, 'editing locked');
      let firstSave;
      await act(async () => {
        inputReady = true; quote.resolve(12); checkName.resolve(true);
        firstSave = await save.next();
      });
      assert.deepEqual(firstSave.args[0], { name: 'Ada', price: 20, quantity: 3, fee: 12, total: 72 });
      assert.equal(save.calls.length, 1); assert.equal(fullChecks, 1);
      await act(async () => { firstSave.reject(new Error('save failed')); });
      assert.match(errorText(view, 'submit-error'), /save failed/);
      assert.equal(view.getByRole('button').disabled, false);
      let retry;
      await act(async () => { fireEvent.submit(view.getByRole('button').closest('form')); retry = await save.next(); retry.resolve(); });
      assert.equal(save.calls.length, 2);
      n.validateAll = async () => { throw new Error('validation exploded'); };
      await act(async () => { fireEvent.submit(view.getByRole('button').closest('form')); });
      assert.equal(save.calls.length, 2); assert.match(errorText(view, 'submit-error'), /validation exploded/);
      assert.equal(view.getByRole('button').disabled, false);
    }
    if (id === 'AI-09') {
      const made = [], recorded = [], pending = service();
      const factory = id => {
        const model = own(support.createEditorModel(id, name => name === 'later' ? pending.invoke(name) : Promise.resolve(true)));
        const entry = { id, model, disposed: false, subscriptions: 0 }; made.push(entry);
        for (const method of ['on', 'subscribe']) {
          const original = model[method].bind(model);
          model[method] = (...args) => {
            entry.subscriptions++; const off = original(...args); let active = true;
            return () => { if (active) { active = false; entry.subscriptions--; } off(); };
          };
        }
        const dispose = model.dispose.bind(model);
        model.dispose = () => { entry.disposed = true; dispose(); };
        return model;
      };
      const record = (...args) => recorded.push(args);
      const editor = id => h(StrictMode, null, h(s.Editor, { recordId: id, factory, record }));
      const a = render(editor('A')), b = render(editor('B'));
      assert.equal(within(a.container).getByLabelText('name').value, 'Ada');
      assert.equal(within(b.container).getByLabelText('name').value, 'Bob');
      await act(async () => { fireEvent.change(within(a.container).getByLabelText('name'), { target: { value: 'Grace' } }); });
      assert.equal(within(b.container).getByLabelText('name').value, 'Bob'); assert.deepEqual(recorded.at(-1), ['A', 'Grace']);
      await act(async () => { fireEvent.change(within(a.container).getByLabelText('name'), { target: { value: '' } }); });
      assert.ok(made.some(e => e.id === 'A' && !e.disposed && e.model.validationErrors.name));
      await act(async () => { fireEvent.change(within(a.container).getByLabelText('name'), { target: { value: 'later' } }); });
      const request = await pending.next(); const retired = made.filter(e => e.id === 'A');
      await act(async () => { a.rerender(editor('B')); });
      assert.equal(within(a.container).getByLabelText('name').value, 'Bob');
      assert.equal(within(a.container).queryByTestId('name-error')?.textContent ?? '', '');
      for (const old of retired) { assert.equal(old.disposed, true); assert.equal(old.subscriptions, 0); }
      const count = recorded.length;
      await act(async () => { request.resolve(true); await Promise.all(retired.map(e => e.model.settled())); });
      assert.equal(recorded.length, count); assert.equal(within(a.container).getByLabelText('name').value, 'Bob');
      await act(async () => { a.unmount(); b.unmount(); });
      for (const entry of made) { assert.equal(entry.disposed, true); assert.equal(entry.subscriptions, 0, 'unsubscribe all owned subscriptions'); }
    }
    if (id === 'AI-10') {
      const m = own(support.createSelectionModel()); let renders = 0;
      const onRender = () => { renders++; };
      const view = render(h(s.ItemPrice, { model: m, id: 'a', onRender }));
      assert.equal(view.getByTestId('item-price').textContent, '10');
      view.rerender(h(s.ItemPrice, { model: m, id: 'b', onRender }));
      assert.equal(view.getByTestId('item-price').textContent, '20');
      await act(async () => { await m.setField('items', { a: 10, b: 21 }); });
      assert.equal(view.getByTestId('item-price').textContent, '21');
      const before = renders; await act(async () => { await m.setField('note', 'irrelevant'); });
      assert.equal(renders, before, 'object selection equality isolates note changes');
      view.unmount(); const errors = render(h(s.AmountError, { model: m }));
      await act(async () => { assert.equal(await m.setField('amount', -1), false); });
      assert.equal(m.data.amount, 10); assert.ok(errorText(errors, 'amount-error'));
      await act(async () => { await m.setField('amount', 8); });
      assert.equal(errorText(errors, 'amount-error'), '');
    }
  } finally { cleanup(); }
}
