import { useModelComputed, useModelFieldState, shallow } from 'model-reaction/react';
import type { SelectionModel } from './support';
export function ItemPrice({ model, id, onRender }: {
  model: SelectionModel; id: 'a' | 'b'; onRender: () => void;
}) {
  onRender();
  const selected = useModelComputed(model, d => ({ price: d.items[id] }), shallow);
  return <span data-testid="item-price">{selected.price}</span>;
}
export function AmountError({ model }: { model: SelectionModel }) {
  const [, , meta] = useModelFieldState(model, 'amount');
  return <span data-testid="amount-error">{meta.error}</span>;
}
