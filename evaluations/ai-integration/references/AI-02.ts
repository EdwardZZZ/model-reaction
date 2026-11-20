import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
export function createNameModel() {
  return createModel({ name: { type: 'string', default: 'Ada', validator: [V.required, V.minLength(3)] } });
}
