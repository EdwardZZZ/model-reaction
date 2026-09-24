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
 * A new selector reference is evaluated immediately against the current
 * snapshot. Wrap expensive selectors in `useCallback`; use `useModelComputed`
 * when you want to pass an inline selector that closes over render values.
 */
export function useModelSelector<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    const getSnapshot = useSelectionSnapshot(model, selector, isEqual);

    const subscribe = useCallback(
        (notify: () => void) =>
            model.subscribe(
                selector,
                () => notify(),
                isEqual
            ),
        [model, selector, isEqual]
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Same shape as {@link useModelSelector}, but the subscription stays stable
 * while the selector is read from the latest render snapshot.
 *
 * Use this variant when:
 *   - The selector is an inline arrow function and you don't want to pay
 *     for `useCallback` ceremony.
 *   - The selector closes over per-render variables (e.g. `id`, `index`)
 *     and you want those updates to be reflected without resubscribing.
 *
 * Trade-offs vs. {@link useModelSelector}:
 *   - The selector is re-run when the model snapshot or selector changes, so
 *     keep it cheap — heavy selectors should still memoise inputs.
 *   - Notifications fire on any field change; the equality check happens
 *     in `getSnapshot` instead of inside the model subscription, so the
 *     model layer can't dedupe before reaching React.
 *
 * If the selector returns a **fresh object/array** (`(d) => d.items.map(...)`,
 * `(d) => ({...})`), pass an `isEqual` (e.g. `shallow`) when equivalent
 * selections should keep the same reference across model updates. With the
 * default `Object.is`, each changed snapshot produces a new selection.
 *
 * ```tsx
 * function Row({ id }: { id: string }) {
 *     // No useCallback needed; closure variable `id` always reflects the
 *     // latest render.
 *     const item = useModelComputed(cart, (d) => d.items[id]);
 *     return <span>{item?.name}</span>;
 * }
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
