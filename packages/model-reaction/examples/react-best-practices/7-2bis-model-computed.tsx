/**
 * BEST_PRACTICES §7.2bis — `useModelComputed`
 *
 * Variant of `useModelSelector` whose subscription does not depend on selector
 * identity. The current render's selector is used for snapshots, so:
 *   - inline arrow functions are fine (no `useCallback` needed);
 *   - per-render closure variables (e.g. `id`) always reflect the latest
 *     render without resubscribing.
 *
 * Snapshots are cached. Use `shallow` when equivalent new containers should
 * retain their reference across updates; see docs/REACT.md.
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

// 1. Inline selector — no `useCallback` ceremony required.
export function Total() {
    const total = useModelComputed(cart, (d) => d.qty * d.price);
    return <span>Total: {total}</span>;
}

// 2. Per-render closure variable. With `useModelSelector` this would
//    require `useCallback(..., [id])`; with `useModelComputed` it Just Works.
export function Row({ id }: { id: string }) {
    const item = useModelComputed(cart, (d) => d.items[id]);
    return <span>{item?.name ?? '—'}</span>;
}

// 3. Shallow equality preserves equivalent summaries across model updates.
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
