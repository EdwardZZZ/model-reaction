import { useCallback, useSyncExternalStore } from 'react';
import { ModelEvents } from '../types';
import type { ModelReturn } from '../types';

/** Subscribe to one committed field value. */
export function useModelField<T extends Record<string, any>, K extends keyof T>(
    model: ModelReturn<T>,
    field: K
): T[K] {
    const subscribe = useCallback(
        (notify: () => void) => model.on(ModelEvents.FIELD_CHANGE, (event) => {
            if (event.field === field) notify();
        }),
        [model, field]
    );
    const getSnapshot = useCallback(() => model.getField(field), [model, field]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export type FieldSetter<V> = (value: V) => void;

/** A committed value and synchronous setter. */
export function useModelFieldState<T extends Record<string, any>, K extends keyof T>(
    model: ModelReturn<T>,
    field: K
): [T[K], FieldSetter<T[K]>] {
    const value = useModelField(model, field);
    const setter = useCallback<FieldSetter<T[K]>>(
        (next) => model.setField(field, next),
        [model, field]
    );
    return [value, setter];
}
