import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
export function createLegacyCart(save: (data: {
  price: number; quantity: number; subtotal: number; total: number;
}) => void | Promise<void>) {
  const persist = async () => { await save(model.data); };
  const model = createModel({
    price: { type: 'number', default: 10, validator: [V.number, V.min(0)] },
    quantity: { type: 'number', default: 2, validator: [V.integer, V.min(1)] },
    subtotal: { type: 'number', default: 0, reaction: {
      fields: ['price', 'quantity'], computed: d => d.price * d.quantity, action: [persist],
    } },
    total: { type: 'number', default: 0, reaction: {
      fields: ['subtotal'], computed: d => d.subtotal, action: [persist],
    } },
  });
  return model;
}
export function subscribePrice(model: ReturnType<typeof createLegacyCart>, listener: (value: number) => void) {
  return model.subscribe(d => d.price, listener);
}
