import { strict as assert } from 'node:assert';
import { renderToString } from 'react-dom/server';
import { ModelProvider } from 'model-reaction/react';
import { CartContents, createCartModel, createTaxModel } from './react-bindings';
import { createDeliveryModel, FieldUiExample } from './react-field-ui';

async function runExample(): Promise<void> {
    const cart = createCartModel();
    const inferred = createTaxModel();
    const delivery = createDeliveryModel();
    try {
        inferred.subscribe(
            (d) => d.tax * d.rate,
            (v) => console.log('[inferred] tax * rate →', v)
        );
        cart.subscribe((d) => d.name, (v) => console.log('name changed →', v));
        cart.subscribe(
            (d) => d.qty * d.price,
            (total, prev) => console.log(`total: ${prev} → ${total}`)
        );

        console.log('=== React Bindings SSR Example ===');
        console.log(renderToString(<ModelProvider model={cart}><CartContents /></ModelProvider>));
        await cart.setField('name', 'Zephyr');
        await cart.setField('qty', 3);
        await cart.setField('coupon', 'SAVE10');
        await cart.settled();
        console.log(renderToString(<ModelProvider model={cart}><CartContents /></ModelProvider>));
        await inferred.setField('tax', 200);

        console.log('=== Field UI State SSR Example ===');
        const renderDelivery = () => renderToString(<FieldUiExample model={delivery} />);
        const editable = renderDelivery();
        assert.match(editable, /data-field="leaveAtDoor"/);
        assert.doesNotMatch(editable, /disabled=""/);
        console.log(editable);
        await delivery.setField('readonly', true);
        const disabled = renderDelivery();
        assert.match(disabled, /data-field="leaveAtDoor"[^>]*disabled=""/);
        console.log(disabled);
        await delivery.setField('deliveryRequired', false);
        const hidden = renderDelivery();
        assert.doesNotMatch(hidden, /data-field="leaveAtDoor"/);
        console.log(hidden);
    } finally {
        cart.dispose();
        inferred.dispose();
        delivery.dispose();
    }
}

runExample().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
