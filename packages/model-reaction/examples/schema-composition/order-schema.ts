import type { FieldSchema } from 'model-reaction';

export function createOrderSchema() {
  return {
    lines: { type: 'array', default: [{ sku: 'book', qty: 1 }] },
  } satisfies Record<string, FieldSchema>;
}
