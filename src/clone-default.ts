/**
 * Clone a schema `default` so mutable defaults (arrays / plain objects) are
 * not shared across model instances created from the same schema literal.
 *
 * Primitives are returned as-is. `Date` / `RegExp` and other non-plain objects
 * are returned by reference intentionally — they are treated as immutable
 * leaves here, matching how `deepEqual` compares them. Cyclic structures are
 * guarded via a `WeakMap`.
 */
export function cloneDefault<V>(
    value: V,
    seen: WeakMap<object, any> = new WeakMap()
): V {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date || value instanceof RegExp) return value;

    const existing = seen.get(value as object);
    if (existing) return existing;

    if (Array.isArray(value)) {
        const copy: unknown[] = [];
        seen.set(value as object, copy);
        for (const item of value) copy.push(cloneDefault(item, seen));
        return copy as unknown as V;
    }

    // Only clone plain objects; leave class instances untouched by reference.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;

    const copy: Record<string, unknown> = {};
    seen.set(value as object, copy);
    for (const key of Object.keys(value as Record<string, unknown>)) {
        copy[key] = cloneDefault(
            (value as Record<string, unknown>)[key],
            seen
        );
    }
    return copy as unknown as V;
}
