import { createModel, type FieldSchema } from 'model-reaction';
function identitySchema() {
  return {
    name: { type: 'string', default: 'Ada' },
    status: { type: 'enum', default: 'draft' as const, values: ['draft', 'published'] as const,
      validator: [{ type: 'status', message: 'Invalid status', validate: (v: unknown) => v === 'draft' || v === 'published' }] },
    note: { type: 'string' },
    address: { type: 'object', default: { city: 'Hangzhou' } },
  } satisfies Record<string, FieldSchema>;
}
function orderSchema() {
  return { lines: { type: 'array', default: [{ sku: 'book', qty: 1 }] } } satisfies Record<string, FieldSchema>;
}
export function createBusinessModel() { return createModel({ ...identitySchema(), ...orderSchema() }); }
export async function changeCity(model: ReturnType<typeof createBusinessModel>, city: string) {
  return model.setField('address', { ...model.data.address, city });
}
export async function appendLine(model: ReturnType<typeof createBusinessModel>, line: { sku: string; qty: number }) {
  return model.setField('lines', [...model.data.lines, line]);
}
