import { createModel, SKIP_REACTION } from 'model-reaction';
import { ValidationRules as V } from 'model-reaction/validation';
export function createShippingModel(services: {
  quote: (postcode: string) => Promise<number>; audit: (fee: number) => Promise<void>;
}) {
  const model = createModel({
    postcode: { type: 'string', default: '' }, base: { type: 'number', default: 100 },
    fee: { type: 'number', default: 0 },
    total: { type: 'number', default: 0, reaction: {
      fields: ['base', 'fee'], computed: d => d.base + d.fee,
    } },
    requestKey: { type: 'string', default: '', validator: [V.pattern(/^\d{5}$/)], reaction: {
      fields: ['postcode'], computed: d => d.postcode.trim() || SKIP_REACTION,
      action: [async ({ value }) => {
        const fee = await services.quote(value);
        await model.setField('fee', fee);
        await services.audit(fee);
      }],
    } },
  });
  return model;
}
