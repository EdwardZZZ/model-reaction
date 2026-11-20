import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
export function createUserModel() {
  return createModel({
    name: { type: 'string', default: '', validator: [V.required] },
    age: { type: 'number', default: 18, validator: [V.number, V.min(18)] },
  });
}
