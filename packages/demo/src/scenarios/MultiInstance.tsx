import { createModel } from 'model-reaction/devtools';
import { ValidationRules } from 'model-reaction';
import { ModelProvider, useModel, useModelField } from 'model-reaction/react';
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

function LineItemCard({
    title,
    label,
    unitPriceCents,
    quantity,
}: {
    title: string;
    label: string;
    unitPriceCents: number;
    quantity: number;
}) {
    const model = useOwnedModel<PriceForm>(() =>
        makeLineItem(label, unitPriceCents, quantity)
    );

    if (!model) return null;

    return (
        <ModelProvider model={model}>
            <LineItemCardView title={title} />
        </ModelProvider>
    );
}

function LineItemCardView({ title }: { title: string }) {
    const model = useModel<PriceForm>();
    const total = useModelField(model, 'totalCents');
    return (
        <div className="card">
            <h3>{title}</h3>
            <div className="row">
                <TextField<PriceForm> field="unitPriceCents" label="Unit price (¢)" />
                <TextField<PriceForm> field="quantity" label="Quantity" />
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
    return (
        <section className="scenario">
            <h2>Multiple instances</h2>
            <p className="scenario-desc">
                Two separate models on one page. Open the DevTools panel and use
                the instance picker (top-right) to switch between them.
            </p>
            <div className="row">
                <LineItemCard
                    title="Line item #1"
                    label="Coffee"
                    unitPriceCents={350}
                    quantity={2}
                />
                <LineItemCard
                    title="Line item #2"
                    label="Bagel"
                    unitPriceCents={275}
                    quantity={1}
                />
            </div>
        </section>
    );
}
