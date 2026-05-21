/**
 * Deep structural equality check.
 *
 * Handles:
 *   - primitives (===)
 *   - Date / RegExp
 *   - Arrays
 *   - Plain objects
 *   - Cyclic references (via WeakSet so the same pair isn't compared twice)
 */
export function deepEqual(
    a: unknown,
    b: unknown,
    seen: WeakSet<object> = new WeakSet<object>()
): boolean {
    if (a === b) return true;

    if (
        a === null ||
        b === null ||
        typeof a !== 'object' ||
        typeof b !== 'object'
    ) {
        return false;
    }

    // Already comparing this pair somewhere up the stack — bail.
    if (seen.has(a) || seen.has(b)) return a === b;
    seen.add(a);
    seen.add(b);

    if (a instanceof Date || b instanceof Date) {
        return (
            a instanceof Date &&
            b instanceof Date &&
            a.getTime() === b.getTime()
        );
    }

    if (a instanceof RegExp || b instanceof RegExp) {
        return (
            a instanceof RegExp &&
            b instanceof RegExp &&
            a.source === b.source &&
            a.flags === b.flags
        );
    }

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

    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (
            !Object.prototype.hasOwnProperty.call(b, key) ||
            !deepEqual(
                (a as Record<string, unknown>)[key],
                (b as Record<string, unknown>)[key],
                seen
            )
        ) {
            return false;
        }
    }
    return true;
}
