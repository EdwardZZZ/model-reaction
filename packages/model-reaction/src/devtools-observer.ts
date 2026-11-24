import type { ModelReturn } from './types';

/** Private in-page capability; not part of the package's public exports. */
export interface ObservedSelection<R> {
    value: R;
    fields?: string[];
}

export type SelectorObserver = <T extends Record<string, any>, R>(
    data: Readonly<T>,
    selector: (data: Readonly<T>) => R
) => ObservedSelection<R>;

// Stable public snapshots preserve identity; see docs/DEVTOOLS.md.
export function observeModelSelectors<T extends Record<string, any>>(
    model: ModelReturn<T>
): SelectorObserver {
    const prototype = Object.getPrototypeOf(model);
    const snapshots = new WeakMap<Readonly<T>, Readonly<T>>();
    const active: Array<{ data: object; fields: Set<string> }> = [];

    const wrap = (raw: Readonly<T>): Readonly<T> => {
        const cached = snapshots.get(raw);
        if (cached) return cached;
        const record = (key: string | symbol): void => {
            if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(raw, key)) return;
            for (const frame of active) {
                if (frame.data === snapshot) frame.fields.add(key);
            }
        };
        const snapshot = new Proxy(raw, {
            get(target, key, receiver) {
                record(key);
                return Reflect.get(target, key, receiver);
            },
            has(target, key) {
                record(key);
                return Reflect.has(target, key);
            },
            getOwnPropertyDescriptor(target, key) {
                record(key);
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
            ownKeys(target) {
                const keys = Reflect.ownKeys(target);
                keys.forEach(record);
                return keys;
            },
        });
        snapshots.set(raw, snapshot);
        return snapshot;
    };

    Object.defineProperty(model, 'data', {
        configurable: true,
        get: () => wrap(Reflect.get(prototype, 'data', model) as Readonly<T>),
    });

    return (data, selector) => {
        const frame = { data, fields: new Set<string>() };
        active.push(frame);
        try {
            const value = selector(data);
            if (Object.is(value, data)) Object.keys(data).forEach((key) => frame.fields.add(key));
            return { value, fields: [...frame.fields].sort() };
        } finally {
            active.pop();
        }
    };
}
