import { createModel } from 'model-reaction/devtools';
import { ValidationRules } from 'model-reaction';
import { useModelField } from 'model-reaction/react';
import type { ModelReturn } from 'model-reaction';
import { TextField } from '../TextField';
import { useOwnedModel } from '../useOwnedModel';

interface PriceForm {
    label: string;
    unitPriceCents: number;
    quantity: number;
    totalCents: number;
}

function makeLineItem(label: string, unit: number, qty: number): ModelReturn<PriceForm> {
    return createModel<PriceForm>({
        label: { type: 'string', default: label },
        unitPriceCents: {
            type: 'number',
            default: unit,
            transform: (v) => Number(v),
            validator: [ValidationRules.min(0).withMessage('Must be ≥ 0')],
        },
        quantity: {
            type: 'number',
            default: qty,
            transform: (v) => Number(v),
            validator: [ValidationRules.min(1).withMessage('Must be ≥ 1')],
        },
        totalCents: {
            type: 'number',
            default: 0,
            reaction: {
                fields: ['unitPriceCents', 'quantity'],
                computed: ({ unitPriceCents, quantity }) =>
                    (Number(unitPriceCents) || 0) * (Number(quantity) || 0),
            },
        },
    });
}

function LineItemCard({ model, title }: { model: ModelReturn<PriceForm>; title: string }) {
    const total = useModelField(model, 'totalCents');
    return (
        <div className="card">
            <h3>{title}</h3>
            <div className="row">
                <TextField model={model} field="unitPriceCents" label="Unit price (¢)" />
                <TextField model={model} field="quantity" label="Quantity" />
            </div>
            <div className="derived">
                <span className="derived-label">totalCents</span>{' '}
                {(total as number) ?? 0}¢
            </div>
        </div>
    );
}

/**
 * Multi-instance scenario: two independent models live on the page at once.
 * The DevTools panel's instance picker lets you switch between them.
 */
export function MultiInstance() {
    const coffee = useOwnedModel<PriceForm>(() => makeLineItem('Coffee', 350, 2));
    const bagel = useOwnedModel<PriceForm>(() => makeLineItem('Bagel', 275, 1));

    return (
        <section className="scenario">
            <h2>Multiple instances</h2>
            <p className="scenario-desc">
                Two separate models on one page. Open the DevTools panel and use
                the instance picker (top-right) to switch between them.
            </p>
            <div className="row">
                <LineItemCard model={coffee} title="Line item #1" />
                <LineItemCard model={bagel} title="Line item #2" />
            </div>
        </section>
    );
}
