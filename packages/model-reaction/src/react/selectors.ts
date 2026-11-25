import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
} from 'react';
import { ModelEvents } from '../types';
import type { ModelFieldKey, ModelReturn } from '../types';
import type { ObservedSelection, SelectorObserver } from '../devtools-observer';

interface SelectionSource<T extends Record<string, any>, R> {
    getSnapshot(): R;
    select(data: Readonly<T>): R;
    fields?: readonly string[] | undefined;
    latest?: { data: Readonly<T>; selection: ObservedSelection<R> };
    onEvaluate?: (selection: ObservedSelection<R>) => void;
}

interface DerivedSelection {
    kind: 'useModelSelector' | 'useModelComputed';
    value: unknown;
    debugName?: string;
    fields?: string[];
}

interface DevtoolsHook {
    updateDerived?(model: object, token: object, selection: DerivedSelection | null): void;
    getDerivedObserver?(model: object): SelectorObserver | undefined;
}

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
    return useSelectorValue(model, selector, isEqual, 'useModelSelector');
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
    return useSelectorValue(model, selector, isEqual, 'useModelComputed');
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
    K extends ModelFieldKey<T>,
>(model: ModelReturn<T>, fields: readonly K[]): Pick<T, K> {
    // JSON encoding handles arbitrary string field names without delimiter
    // collisions and keeps inline field arrays stable when their contents match.
    const key = JSON.stringify(fields);
    const pick = useCallback((data: Readonly<T>): Pick<T, K> => {
        return Object.fromEntries(fields.map((f) => [f, data[f]])) as Pick<T, K>;
        // `key` covers `fields` content; intentional dep list.
    }, [key]);

    return useSelectorValue(model, pick, shallow);
}

function useSelectorValue<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean,
    kind?: 'useModelSelector' | 'useModelComputed'
): R {
    const observer = useMemo(() => kind ? getDerivedObserver(model) : undefined, [model, kind]);
    const { source, committed } = useSelectionSnapshot(model, selector, isEqual, observer);

    const subscribe = useCallback(
        (notify: () => void) =>
            model.subscribe(source.select, () => notify(), isEqual),
        [model, source, isEqual]
    );
    const subscribeComputed = useCallback(
        (notify: () => void) => model.on(ModelEvents.FIELD_CHANGE, notify),
        [model]
    );
    const value = useSyncExternalStore(
        kind === 'useModelComputed' ? subscribeComputed : subscribe,
        source.getSnapshot, source.getSnapshot
    );
    useEffect(() => { committed.current = { value }; });
    useDerivedValue(model, kind, value, selector, isEqual, source);
    return value;
}

// Each selector has a render-local cache; only commits update the equality baseline.
function useSelectionSnapshot<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean,
    observer?: SelectorObserver
) {
    const committed = useRef<{ value: R } | null>(null);
    const source = useMemo(() => {
        let previous: { data: Readonly<T>; value: R } | null = null;
        const evaluate = (data: Readonly<T>): ObservedSelection<R> => {
            if (source.latest?.data === data) return source.latest.selection;
            const selection = observer ? observer(data, selector) : { value: selector(data) };
            source.latest = { data, selection };
            source.onEvaluate?.(selection);
            return selection;
        };
        const source: SelectionSource<T, R> = {
            select: (data) => evaluate(data).value,
            getSnapshot: () => {
                const data = model.data;
                if (previous !== null && Object.is(previous.data, data)) return previous.value;
                const selection = evaluate(data);
                const value = committed.current !== null && isEqual(committed.current.value, selection.value)
                    ? committed.current.value : selection.value;
                if (!shallow(source.fields, selection.fields)) source.fields = selection.fields;
                previous = { data, value };
                return value;
            },
        };
        return source;
    }, [model, selector, isEqual, observer]);
    return { source, committed };
}

// Publish only committed render results; see docs/REACT.md#devtools-derived-values.
function useDerivedValue<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    kind: DerivedSelection['kind'] | undefined,
    value: R,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean,
    source: SelectionSource<T, R>
): void {
    const token = useRef({}).current;
    const lastReport = useRef<DerivedSelection | null>(null);
    const debugName = useMemo(() => {
        if (!kind) return undefined;
        try {
            const hook = (globalThis as Record<string, unknown>)
                .__MODEL_REACTION_DEVTOOLS_HOOK__ as DevtoolsHook | undefined;
            if (typeof hook?.updateDerived !== 'function') return undefined;
            if (selector.name) return selector.name;
            const text = Function.prototype.toString.call(selector).trim();
            return text && !/\{\s*\[native code\]\s*\}$/.test(text) ? text : undefined;
        } catch {
            return undefined;
        }
    }, [kind, selector]);
    const snapshotFields = source.fields;
    useEffect(() => {
        if (!kind) return;
        return () => {
            report(model, token, null);
            lastReport.current = null;
        };
    }, [model, token, kind]);

    useEffect(() => {
        if (!kind) return;
        let currentFields = snapshotFields;
        const publish = (fields: readonly string[] | undefined): void => {
            const previous = lastReport.current;
            if (previous && Object.is(previous.value, value) && previous.kind === kind &&
                previous.debugName === debugName && shallow(previous.fields, fields)) return;
            const next: DerivedSelection = {
                kind, value,
                ...(debugName === undefined ? {} : { debugName }),
                ...(fields === undefined ? {} : { fields: [...fields] }),
            };
            lastReport.current = next;
            report(model, token, next);
        };
        publish(currentFields);
        source.onEvaluate = (selection) => {
            const nextFields = selection.fields;
            if (!shallow(nextFields, currentFields) && isEqual(value, selection.value)) {
                currentFields = nextFields;
                publish(currentFields);
            }
        };
        // Reconcile equal-result changes between render and effect subscription.
        if (source.latest) source.onEvaluate(source.latest.selection);
        return () => { delete source.onEvaluate; };
    }, [model, token, kind, value, debugName, snapshotFields, source, isEqual]);
}

function getDerivedObserver(model: object): SelectorObserver | undefined {
    try {
        const hook = (globalThis as Record<string, unknown>)
            .__MODEL_REACTION_DEVTOOLS_HOOK__ as DevtoolsHook | undefined;
        return hook?.getDerivedObserver?.(model);
    } catch {
        return undefined;
    }
}

function report(model: object, token: object, selection: DerivedSelection | null): void {
    try {
        const hook = (globalThis as Record<string, unknown>)
            .__MODEL_REACTION_DEVTOOLS_HOOK__ as DevtoolsHook | undefined;
        hook?.updateDerived?.(model, token, selection);
    } catch {
        // Debugging must not interrupt a React commit or cleanup.
    }
}
