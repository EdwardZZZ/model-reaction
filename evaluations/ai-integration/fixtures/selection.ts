import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';

export function createSelectionModel() {
  return createModel({
    items: { type: 'object', default: { a: 10, b: 20 } },
    note: { type: 'string', default: '' },
    amount: { type: 'number', default: 10, validator: [V.number, V.min(0)] },
  });
}
export type SelectionModel = ReturnType<typeof createSelectionModel>;
