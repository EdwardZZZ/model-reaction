import { useRef } from 'react';
import { createModel } from '../index';
import { useModelSelector } from '../react';
import type { ModelReturn } from '../types';

export interface Cart {
    qty: number;
    price: number;
    coupon: string;
    items: Record<string, { name: string }>;
}

export function makeCart() {
    return createModel<Cart>({
        qty:    { type: 'number', default: 1 },
        price:  { type: 'number', default: 100 },
        coupon: { type: 'string', default: '' },
        items:  {
            type: 'object',
            default: { a: { name: 'A' }, b: { name: 'B' } },
        },
    });
}

export interface OrderState {
    items: Array<{ id: string; qty: number }>;
    coupon: string;
    note: string;
}

export function makeOrderModel() {
    return createModel<OrderState>({
        items: {
            type: 'array',
            default: [
                { id: 'a', qty: 1 },
                { id: 'b', qty: 2 },
            ],
        },
        coupon: { type: 'string', default: '' },
        note: { type: 'string', default: '' },
    });
}

/**
 * Hook harness: counts renders without polluting the hook under test.
 */
export function useTracked<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (d: Readonly<T>) => R,
    isEqual?: (a: R, b: R) => boolean,
    useSelection: typeof useModelSelector = useModelSelector
) {
    const renders = useRef(0);
    renders.current += 1;
    const value = useSelection(model, selector, isEqual);
    return { value, renders: renders.current };
}
