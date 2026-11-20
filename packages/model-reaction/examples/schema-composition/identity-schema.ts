import type { FieldSchema } from 'model-reaction';

const statusValues = ['draft', 'published'] as const;

export function createIdentitySchema() {
  return {
    name: { type: 'string', default: 'Ada' },
    status: {
      type: 'enum',
      values: statusValues,
      default: statusValues[0],
      validator: [{
        type: 'business-status',
        message: 'Status must be draft or published',
        validate: (value: unknown) => statusValues.some(status => status === value),
      }],
    },
    note: { type: 'string' },
    address: { type: 'object', default: { city: 'Hangzhou' } },
  } satisfies Record<string, FieldSchema>;
}
