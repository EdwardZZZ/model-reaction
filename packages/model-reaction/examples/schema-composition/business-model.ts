import { createModel } from 'model-reaction';
import { createIdentitySchema } from './identity-schema.js';
import { createOrderSchema } from './order-schema.js';

export function createBusinessModel() {
  return createModel({
    ...createIdentitySchema(),
    ...createOrderSchema(),
  });
}

export type BusinessModel = ReturnType<typeof createBusinessModel>;
export type BusinessData = BusinessModel['data'];
