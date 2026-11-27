import { isPlainObject, ownEnumerableKeys } from './object';

/** Isolate mutable schema defaults; clone boundaries are in docs/ARCHITECTURE.md#value-handling. */
export function cloneDefault<V>(value: V, seen?: WeakMap<object, any>): V {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date || value instanceof RegExp) return value;

    // Only clone plain objects and arrays; leave class instances by reference.
    const isArray = Array.isArray(value);
    if (!isArray && !isPlainObject(value)) return value;

    seen ??= new WeakMap();
    const existing = seen.get(value as object);
    if (existing) return existing;

    if (isArray) {
        const copy: unknown[] = [];
        seen.set(value as object, copy);
        for (const item of value) copy.push(cloneDefault(item, seen));
        return copy as unknown as V;
    }

    const copy: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(value));
    seen.set(value as object, copy);
    for (const key of ownEnumerableKeys(value)) {
        Object.defineProperty(copy, key, {
            value: cloneDefault((value as Record<PropertyKey, unknown>)[key], seen),
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }
    return copy as unknown as V;
}
