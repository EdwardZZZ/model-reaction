import { isPlainObject, ownEnumerableKeys } from './object';

/** Structural comparison with path-local cycle guards; see docs/ARCHITECTURE.md#value-handling. */
export function deepEqual(
    a: unknown,
    b: unknown,
    seen?: WeakSet<object>
): boolean {
    if (a === b) return true;

    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }

    // Date / RegExp are leaves — compare structurally without cycle tracking.
    if (a instanceof Date || b instanceof Date) {
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }

    if (a instanceof RegExp || b instanceof RegExp) {
        return (
            a instanceof RegExp &&
            b instanceof RegExp &&
            a.source === b.source &&
            a.flags === b.flags
        );
    }

    // This node is already on the current path — we've hit a cycle. Fall back
    // to reference identity to stop the recursion.
    seen ??= new WeakSet<object>();
    if (seen.has(a) || seen.has(b)) return a === b;
    seen.add(a);
    seen.add(b);

    try {
        const isArrA = Array.isArray(a);
        const isArrB = Array.isArray(b);
        if (isArrA !== isArrB) return false;

        if (isArrA && isArrB) {
            const arrA = a as unknown[];
            const arrB = b as unknown[];
            if (arrA.length !== arrB.length) return false;
            for (let i = 0; i < arrA.length; i++) {
                if (!deepEqual(arrA[i], arrB[i], seen)) return false;
            }
            return true;
        }

        // Only plain objects expose all of their value through own fields.
        // Map, Set and class instances must be replaced by a new reference.
        if (!isPlainObject(a) || !isPlainObject(b)) return false;

        const keysA = ownEnumerableKeys(a);
        const keysB = ownEnumerableKeys(b);
        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (
                !Object.prototype.propertyIsEnumerable.call(b, key) ||
                !deepEqual(
                    (a as Record<PropertyKey, unknown>)[key],
                    (b as Record<PropertyKey, unknown>)[key],
                    seen
                )
            ) {
                return false;
            }
        }
        return true;
    } finally {
        // Pop this node off the current path so sibling branches sharing the
        // same reference are still compared structurally.
        seen.delete(a);
        seen.delete(b);
    }
}
