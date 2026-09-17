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
 *
 * ⚠️ If the selector returns a *fresh* object/array each call, pair it with
 * a structural `isEqual` such as `shallow` (see example 3). Without it the
 * default `Object.is` never matches, the per-render cache never hits, and
 * React aborts with "Maximum update depth exceeded".
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

// 3. Selector that builds a *fresh* object each call. MUST pass `shallow`
//    (or another structural `isEqual`) — otherwise the default `Object.is`
//    sees a new reference every render and loops on "Maximum update depth".
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
