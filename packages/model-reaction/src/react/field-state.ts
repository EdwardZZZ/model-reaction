import {
    useCallback,
    useMemo,
    useState,
    useSyncExternalStore,
} from 'react';
import { ModelEvents, ValidationError } from '../types';
import type { ModelReturn } from '../types';

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

/** Metadata returned alongside a field value by `useModelFieldState`. */
export interface FieldMeta {
    /** Validation errors for this field (empty array if none). */
    errors: readonly ValidationError[];
    /** First error message, or null. Convenient for inline UI. */
    error: string | null;
    /** True while an async setField is in flight from this hook. */
    validating: boolean;
    /** True if the field currently has unsaved/invalid data in dirtyData. */
    dirty: boolean;
}

/** Setter signature returned by `useModelFieldState`. */
export type FieldSetter<V> = (value: V) => Promise<boolean>;

/**
 * Receive a committed field value plus a setter and metadata in one hook.
 * Use this lower-level binding for non-text controls or custom UI policies:
 *
 * ```tsx
 * const [enabled, setEnabled, meta] = useModelFieldState(model, 'enabled');
 * <input
 *   type="checkbox"
 *   checked={enabled}
 *   onChange={(e) => setEnabled(e.target.checked)}
 *   disabled={meta.validating}
 * />
 * {meta.error && <span>{meta.error}</span>}
 * ```
 *
 * For controlled text inputs, prefer `useDraftField` so rejected or in-flight
 * edits remain visible without an application-managed intermediate value.
 *
 * `touched` / blur-gated error display is intentionally not provided —
 * it is a local UI concern, easily handled with a single `useState(false)`
 * in the consumer component.
 */
export function useModelFieldState<
    T extends Record<string, any>,
    K extends keyof T,
>(
    model: ModelReturn<T>,
    field: K
): [T[K], FieldSetter<T[K]>, FieldMeta] {
    const value = useModelField(model, field);

    const metaSubscribe = useCallback(
        (notify: () => void) => {
            const validationHandler = (e: { field?: string }): void => {
                if (e.field === field) notify();
            };
            const unsubscribeError = model.on(
                ModelEvents.VALIDATION_ERROR,
                validationHandler
            );
            const unsubscribeReactionError = model.on(
                ModelEvents.REACTION_ERROR,
                validationHandler
            );
            const unsubscribeFieldValidation = model.on(
                ModelEvents.FIELD_VALIDATION_COMPLETE,
                validationHandler
            );
            const unsubscribeDirty = model.on(
                ModelEvents.DIRTY_DATA_CLEARED,
                (e) => {
                    if (e.fields.includes(field as keyof T & string)) notify();
                }
            );
            return () => {
                unsubscribeError();
                unsubscribeReactionError();
                unsubscribeFieldValidation();
                unsubscribeDirty();
            };
        },
        [model, field]
    );
    const metaSnapshot = useMemo(() => {
        let previous: {
            errors: readonly ValidationError[];
            dirty: boolean;
        } | null = null;

        return () => {
            const errors =
                model.validationErrors[field as string] ?? EMPTY_ERRORS;
            const dirty = Object.prototype.hasOwnProperty.call(
                model.getDirtyData(),
                field
            );
            if (
                previous !== null &&
                previous.errors === errors &&
                previous.dirty === dirty
            ) {
                return previous;
            }
            previous = { errors, dirty };
            return previous;
        };
    }, [model, field]);
    const { errors, dirty } = useSyncExternalStore(
        metaSubscribe,
        metaSnapshot,
        metaSnapshot
    );

    const [validationState, setValidationState] = useState(() => ({
        model,
        field,
        count: 0,
    }));
    const validating =
        validationState.model === model &&
        validationState.field === field &&
        validationState.count > 0;

    const setter = useCallback<FieldSetter<T[K]>>(
        async (next) => {
            setValidationState((current) => ({
                model,
                field,
                count:
                    current.model === model && current.field === field
                        ? current.count + 1
                        : 1,
            }));
            try {
                return await model.setField(field, next);
            } finally {
                setValidationState((current) => {
                    if (current.model !== model || current.field !== field) {
                        return current;
                    }
                    return {
                        model,
                        field,
                        count: Math.max(0, current.count - 1),
                    };
                });
            }
        },
        [model, field]
    );

    const meta: FieldMeta = {
        errors,
        error: errors[0]?.message ?? null,
        validating,
        dirty,
    };

    return [value, setter, meta];
}

const EMPTY_ERRORS: ValidationError[] = [];
