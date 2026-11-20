import { createModel } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
export function createPasswordModel(onTransform: (value: unknown) => void = () => {}) {
  return createModel({
    password: { type: 'string', default: 'old-password', transform: (v: string) => {
      onTransform(v); return v.trim();
    }, validator: [V.minLength(8)] },
    confirm: { type: 'string', default: 'old-password', validator: [{
      type: 'match', message: 'Passwords must match', validate: (v, d) => v === d?.password,
    }] },
    memo: { type: 'string', default: 'old' },
  });
}
