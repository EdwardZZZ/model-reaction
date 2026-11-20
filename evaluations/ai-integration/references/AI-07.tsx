import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
import { useDraftField } from 'model-reaction/react';
export function createAmountModel(check: (amount: number) => Promise<boolean>) {
  return createModel({ amount: { type: 'number', default: 10, transform: (v: unknown) => {
    if (v === '!') throw new Error('Invalid amount text');
    return Number(v);
  }, validator: [V.number, V.min(0), { type: 'remote', message: 'Amount unavailable', validate: check }] } });
}
export function AmountInput({ model }: { model: ReturnType<typeof createAmountModel> }) {
  const field = useDraftField(model, 'amount');
  return <>
    <input aria-label="amount" value={field.draft} onChange={e => field.setDraft(e.target.value)} onBlur={field.onBlur} />
    <span data-testid="amount-error">{field.showError ? field.writeError?.message ?? field.meta.error : ''}</span>
  </>;
}
