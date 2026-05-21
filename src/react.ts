/**
 * React adapter for model-reaction.
 *
 * Provides hooks that subscribe components to a model with field-level
 * granularity, leveraging `useSyncExternalStore` for tear-free reads.
 *
 * `react` is declared as a peer dependency. This module is published as a
 * separate entry point (`model-reaction/react`) so consumers without React
 * never pay for it.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { ModelReturn } from './types';

/**
 * Subscribe a component to a single field. The component re-renders only
 * when that field's committed value changes.
 */
export function useModelField<T extends Record<string, any>, K extends keyof T>(
    model: ModelReturn<T>,
    field: K
): T[K] {
    const subscribe = useCallback(
        (notify: () => void) => model.subscribeField(field, notify),
        [model, field]
    );
    const getSnapshot = useCallback(
        () => model.getField(field),
        [model, field]
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe a component to a derived value. The component re-renders only
 * when `selector(data)` changes (compared via `isEqual`, default Object.is).
 *
 * The selector and isEqual references are captured on first call; if you
 * pass new functions each render, wrap them in `useCallback`.
 */
export function useModelSelector<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: T) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    const cacheRef = useRef<R | undefined>(undefined);
    const initialized = useRef(false);
    if (!initialized.current) {
        cacheRef.current = selector(model.data);
        initialized.current = true;
    }

    const subscribe = useCallback(
        (notify: () => void) =>
            model.subscribe(
                selector,
                (next) => {
                    cacheRef.current = next;
                    notify();
                },
                isEqual
            ),
        [model, selector, isEqual]
    );
    const getSnapshot = useCallback(() => cacheRef.current as R, []);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
