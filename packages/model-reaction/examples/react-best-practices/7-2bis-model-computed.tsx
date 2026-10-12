/**
 * BEST_PRACTICES §7.2bis — `useModelComputed`
 *
 * The subscription depends only on the model. Snapshot reads use the current
 * render's selector, so inline selectors can close over props. Use `shallow`
 * when equivalent container results should retain their reference.
 */
import * as React from 'react';
void React;

import { createModel } from '../../src/index';
import { shallow, useModelComputed } from '../../src/react';

interface Cart {
    items: Record<string, { name: string; price: number }>;
    qty: number;
    price: number;
}

const cart = createModel<Cart>({
    items: { type: 'object', default: {} },
    qty:   { type: 'number', default: 1 },
    price: { type: 'number', default: 100 },
});

export function Total() {
    const total = useModelComputed(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

export function Row({ id }: { id: string }) {
    const item = useModelComputed(cart, (d) => d.items[id]);
    return <span>{item?.name ?? '—'}</span>;
}

export function Summary() {
    const { total, count } = useModelComputed(
        cart,
        (d) => ({
            total: d.qty * d.price,
            count: Object.keys(d.items).length,
        }),
        shallow,
    );
    return <span>{count} items · Total: {total}</span>;
}
