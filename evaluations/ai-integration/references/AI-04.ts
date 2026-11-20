import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
export function createCartModel() {
  return createModel({
    price: { type: 'number', default: 10 },
    quantity: { type: 'number', default: 2 },
    discount: { type: 'number', default: 2 },
    subtotal: { type: 'number', default: 0, validator: [V.max(100)], reaction: {
      fields: ['price', 'quantity'], computed: d => d.price * d.quantity,
    } },
    total: { type: 'number', default: 0, reaction: {
      fields: ['subtotal', 'discount'], computed: d => d.subtotal - d.discount,
    } },
  }, { debounceReactions: 10 });
}
export async function updateCart(model: ReturnType<typeof createCartModel>, changes: {
  price?: number; quantity?: number; discount?: number;
}) {
  await model.setFields(changes);
  await model.settled();
  return model.data;
}
