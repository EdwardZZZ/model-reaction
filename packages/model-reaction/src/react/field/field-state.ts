import {
    useCallback,
    useMemo,
    useState,
    useSyncExternalStore,
} from 'react';
import { ModelEvents } from '../../types';
import type { ModelFieldKey, ModelReturn, ValidationError } from '../../types';

/** Metadata returned alongside a field value by `useModelFieldState`. */
export interface FieldMeta {
    /** Validation errors for this field (empty array if none). */
    errors: readonly ValidationError[];
    /** True while an async setField is in flight from this hook. */
    validating: boolean;
    /** True if the field currently has unsaved/invalid data in dirtyData. */
    dirty: boolean;
}

/** Setter signature returned by `useModelFieldState`. */
export type FieldSetter<V> = (value: V) => Promise<boolean>;

/**
 * Subscribe a component to a single field. The component re-renders only
 * when that field's committed value changes.
 */
export function useModelField<T extends Record<string, any>, K extends ModelFieldKey<T>>(
    model: ModelReturn<T>,
    field: K
): T[K] {
    const subscribe = useCallback(
        (notify: () => void) => model.on(ModelEvents.FIELD_CHANGE, (event) => {
            if (event.field === String(field)) notify();
        }),
        [model, field]
    );
    const getSnapshot = useCallback(
        () => model.getField(field),
        [model, field]
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Committed field binding with setters and metadata; see docs/REACT.md. */
export function useModelFieldState<
    T extends Record<string, any>, K extends ModelFieldKey<T>,
>(
    model: ModelReturn<T>,
    field: K
): [T[K], FieldSetter<T[K]>, FieldMeta] {
    const binding = useMemo(() => createFieldBinding(model, field), [model, field]);
    const { value, errors, dirty } = useSyncExternalStore(
        binding.subscribe, binding.getSnapshot, binding.getSnapshot
    );

    const [validation, setValidation] = useState(() => ({ binding, pending: 0 }));
    if (validation.binding !== binding) setValidation({ binding, pending: 0 });
    const validating = validation.binding === binding && validation.pending > 0;
    const setValue = useCallback<FieldSetter<T[K]>>(async (next) => {
        const changePending = (delta: number) => setValidation((current) =>
            current.binding === binding
                ? { binding, pending: current.pending + delta }
                : current
        );
        changePending(1);
        try {
            return await model.setField(field, next);
        } finally {
            changePending(-1);
        }
    }, [binding, model, field]);

    return [value, setValue, { errors, dirty, validating }];
}

const EMPTY_ERRORS: readonly ValidationError[] = [];

function createFieldBinding<T extends Record<string, any>, K extends ModelFieldKey<T>>(
    model: ModelReturn<T>,
    field: K
) {
    const fieldName = String(field);
    let snapshot: { value: T[K]; errors: readonly ValidationError[]; dirty: boolean } | undefined;

    return {
        getSnapshot() {
            const errorsByField = model.validationErrors;
            const errors = Object.prototype.hasOwnProperty.call(errorsByField, fieldName)
                ? errorsByField[fieldName]! : EMPTY_ERRORS;
            const dirty = Object.prototype.hasOwnProperty.call(model.getDirtyData(), fieldName);
            const value = model.getField(field);
            if (!snapshot || !Object.is(snapshot.value, value) ||
                snapshot.errors !== errors || snapshot.dirty !== dirty) {
                snapshot = { value, errors, dirty };
            }
            return snapshot;
        },
        subscribe(notify: () => void) {
            const onValidation = (event: { field?: string }) => {
                if (event.field === fieldName) notify();
            };
            const unsubscribe = [
                model.on(ModelEvents.FIELD_CHANGE, notify),
                model.on(ModelEvents.VALIDATION_ERROR, onValidation),
                model.on(ModelEvents.REACTION_ERROR, onValidation),
                model.on(ModelEvents.FIELD_VALIDATION_COMPLETE, onValidation),
                model.on(ModelEvents.DIRTY_DATA_CLEARED, (event) => {
                    if (event.fields.some((name) => name === fieldName)) notify();
                }),
            ];
            return () => unsubscribe.forEach((off) => off());
        },
    };
}
