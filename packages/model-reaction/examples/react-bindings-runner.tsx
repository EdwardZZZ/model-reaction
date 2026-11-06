import { renderToString } from 'react-dom/server';
import { ModelProvider } from 'model-reaction/react';
import { CartContents, createCartModel, createTaxModel } from './react-bindings';

async function runExample(): Promise<void> {
    const cart = createCartModel();
    const inferred = createTaxModel();
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
    } finally {
        cart.dispose();
        inferred.dispose();
    }
}

runExample().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
