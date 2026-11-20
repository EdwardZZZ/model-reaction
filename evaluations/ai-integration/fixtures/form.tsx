import { useEffect } from 'react';
import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
import { useDraftField } from 'model-reaction/react';

export function createFormModel(
  quote: (price: number, quantity: number) => Promise<number>,
  checkName: (name: string) => Promise<boolean> = async () => true,
) {
  const model = createModel({
    name: { type: 'string', default: '', validator: [
      V.required, { type: 'availability', message: 'Name unavailable', validate: checkName },
    ] },
    price: { type: 'number', default: 10, transform: (text: unknown) => {
      if (text === '!') throw new Error('Invalid price text');
      return Number(text);
    }, validator: [V.number, V.min(0)] },
    quantity: { type: 'number', default: 2, transform: Number, validator: [V.integer, V.min(1)] },
    fee: { type: 'number', default: 0, reaction: {
      fields: ['price', 'quantity'], computed: () => 0,
      action: [async () => { await model.setField('fee', await quote(model.data.price, model.data.quantity)); }],
    } },
    total: { type: 'number', default: 0, reaction: {
      fields: ['price', 'quantity', 'fee'], computed: d => d.price * d.quantity + d.fee,
    } },
  });
  return model;
}
export type FormModel = ReturnType<typeof createFormModel>;
export type Payload = FormModel['data'];
export interface InputStatus { pending: boolean; writeError: Error | null }
export function InputFields({ model, disabled, onStatus }: {
  model: FormModel; disabled: boolean; onStatus: (status: InputStatus) => void;
}) {
  const name = useDraftField(model, 'name');
  const price = useDraftField(model, 'price');
  const quantity = useDraftField(model, 'quantity');
  const pending = name.meta.validating || price.meta.validating || quantity.meta.validating;
  const writeError = name.writeError ?? price.writeError ?? quantity.writeError;
  useEffect(() => onStatus({ pending, writeError }), [pending, writeError, onStatus]);
  return <fieldset disabled={disabled}>
    <input aria-label="name" value={name.draft} onChange={e => name.setDraft(e.target.value)} />
    <input aria-label="price" value={price.draft} onChange={e => price.setDraft(e.target.value)} />
    <input aria-label="quantity" value={quantity.draft} onChange={e => quantity.setDraft(e.target.value)} />
  </fieldset>;
}
