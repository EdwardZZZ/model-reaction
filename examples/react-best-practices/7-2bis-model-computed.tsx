/**
 * BEST_PRACTICES §7.2bis — `useModelComputed` (ref-locked selector)
 *
 * Variant of `useModelSelector` that stores `selector` / `isEqual` in
 * refs refreshed on every render. The underlying subscription is **not**
 * recreated when the selector reference changes, so:
 *   - inline arrow functions are fine (no `useCallback` needed);
 *   - per-render closure variables (e.g. `id`) always reflect the latest
 *     render without resubscribing.
 *
 * Trade-off: the selector runs on every render (inside `getSnapshot`),
 * so keep it cheap.
 */
import * as React from 'react';
void React;

import { createModel } from '../../src/index';
import { useModelComputed } from '../../src/react';

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
