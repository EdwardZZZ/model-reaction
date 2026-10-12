import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
} from 'react';
import { ModelEvents } from '../types';
import type { ModelReturn } from '../types';

/**
 * Shallow equality for plain objects / arrays. Useful as the `isEqual`
 * argument of `useModelSelector` / `useModelFields` when the selector
 * returns a fresh container each call.
 */
export function shallow<T>(a: T, b: T): boolean {
    if (Object.is(a, b)) return true;
    if (
        typeof a !== 'object' ||
        a === null ||
        typeof b !== 'object' ||
        b === null
    ) {
        return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!Object.is(a[i], b[i])) return false;
        }
        return true;
    }
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (
            !Object.is(
                (a as Record<string, unknown>)[k],
                (b as Record<string, unknown>)[k]
            )
        ) {
            return false;
        }
    }
    return true;
}

/**
 * Build a render-local snapshot getter while retaining the last committed
 * selection for equality checks when selector references change.
 */
function useSelectionSnapshot<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean
): () => R {
    const committedSelectionRef = useRef<{ value: R } | null>(null);
    const getSnapshot = useMemo(() => {
        let previous: { data: Readonly<T>; value: R } | null = null;

        return (): R => {
            const data = model.data;
            if (previous !== null && Object.is(previous.data, data)) {
                return previous.value;
            }

            const nextSelection = selector(data);
            const committed = committedSelectionRef.current;
            const selection =
                committed !== null && isEqual(committed.value, nextSelection)
                    ? committed.value
                    : nextSelection;

            previous = { data, value: selection };
            return selection;
        };
    }, [model, selector, isEqual]);

    // Only committed renders may update the cross-render equality baseline.
    // The memoized getter above keeps speculative render state local.
    useEffect(() => {
        committedSelectionRef.current = { value: getSnapshot() };
    });

    return getSnapshot;
}

/**
 * Subscribe a component to a derived value. The component re-renders only
 * when `selector(data)` changes (compared via `isEqual`, default Object.is).
 *
 * The model subscription filters changes before notifying React. Changing the
 * selector or equality reference rebuilds that subscription and immediately
 * evaluates the current snapshot. Keep reusable selectors stable with
 * `useCallback`; use `useModelComputed` for inline selectors with render values.
 */
export function useModelSelector<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    const getSnapshot = useSelectionSnapshot(model, selector, isEqual);

    const subscribe = useCallback(
        (notify: () => void) =>
            model.subscribe(selector, () => notify(), isEqual),
        [model, selector, isEqual]
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Select a derived value using the current render's selector while subscribing
 * only by model identity. Inline selectors may close over current props without
 * resubscribing. Each field change notifies React; the shared snapshot getter
 * retains equivalent selections via `isEqual` (default Object.is).
 *
 * Use `shallow` or domain equality for fresh objects/arrays when equivalent
 * results should retain their reference across updates. Keep selectors pure;
 * stable references can reuse computation for unchanged snapshots.
 *
 * ```tsx
 * const item = useModelComputed(cart, (data) => data.items[id]);
 * ```
 */
export function useModelComputed<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    const getSnapshot = useSelectionSnapshot(model, selector, isEqual);

    const subscribe = useCallback(
        (notify: () => void) => model.on(ModelEvents.FIELD_CHANGE, notify),
        [model]
    );

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe a component to a set of fields and receive them as an object.
 * Re-renders only when any of the listed fields shallowly changes.
 *
 * Equivalent to `useModelSelector(model, d => pick(d, fields), shallow)`
 * but with stable selector / equality references.
 */
export function useModelFields<
    T extends Record<string, any>,
    K extends keyof T,
>(model: ModelReturn<T>, fields: readonly K[]): Pick<T, K> {
    // JSON encoding handles arbitrary string field names without delimiter
    // collisions and keeps inline field arrays stable when their contents match.
    const key = JSON.stringify(fields);
    const pick = useCallback((data: Readonly<T>): Pick<T, K> => {
        const out = {} as Pick<T, K>;
        for (const f of fields) out[f] = data[f];
        return out;
        // `key` covers `fields` content; intentional dep list.
    }, [key]);

    return useModelSelector(model, pick, shallow);
}
