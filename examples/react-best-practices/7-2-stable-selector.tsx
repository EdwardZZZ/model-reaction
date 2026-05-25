/**
 * BEST_PRACTICES §7.2 — Stable selector references
 *
 * Pass a stable `selector` reference to `useModelSelector` to avoid extra
 * subscriptions and renders. When the selector returns a fresh container,
 * pair it with `shallow`.
 */
import * as React from 'react';
import { useCallback } from 'react';
void React;

import { createModel } from '../../src/index';
import { shallow, useModelSelector } from '../../src/react';

interface Cart {
    qty: number;
    price: number;
}

const cart = createModel<Cart>({
    qty:   { type: 'number', default: 1 },
    price: { type: 'number', default: 100 },
});

// ❌ Re-subscribes every render.
export function TotalBad() {
    const total = useModelSelector(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

// ✅ Stable reference.
export function TotalGood() {
    const selectTotal = useCallback((d: Cart) => d.qty * d.price, []);
    const total = useModelSelector(cart, selectTotal);
    return <span>Total: {total}</span>;
}

// ✅ Selector returning a fresh container — use `shallow`.
export function CartSlice() {
    const slice = useModelSelector(
        cart,
        (d) => ({ qty: d.qty, price: d.price }),
        shallow,
    );
    return <span>Slice: {slice.qty} × {slice.price}</span>;
}
