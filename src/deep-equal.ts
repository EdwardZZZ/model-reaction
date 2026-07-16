/**
 * Deep structural equality check.
 *
 * Handles:
 *   - primitives (===)
 *   - Date / RegExp
 *   - Arrays
 *   - Plain objects
 *   - Cyclic references (via WeakSet so infinite recursion is avoided)
 *
 * The `seen` set tracks only the nodes on the *current* comparison path:
 * each node is added before descending into its children and removed on the
 * way back up. This means a value shared by sibling branches (a DAG, e.g.
 * `{ x: shared, y: shared }`) is compared structurally each time, while a
 * true cycle (a node reachable from itself) short-circuits to reference
 * identity to stop the recursion.
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

    // Date / RegExp are leaves — compare structurally without cycle tracking.
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

    // This node is already on the current path — we've hit a cycle. Fall back
    // to reference identity to stop the recursion.
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
    } finally {
        // Pop this node off the current path so sibling branches sharing the
        // same reference are still compared structurally.
        seen.delete(a);
        seen.delete(b);
    }
}
