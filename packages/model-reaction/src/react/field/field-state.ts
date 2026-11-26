import {
    useCallback,
    useMemo,
    useState,
    useSyncExternalStore,
} from 'react';
import { ModelEvents, ValidationError } from '../../types';
import type { ModelFieldKey, ModelReturn } from '../../types';
import { shallow } from '../selectors';

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

type IsUnion<T, Whole = T> = T extends unknown ? [Whole] extends [T] ? false : true : never;

/** Merge independent properties; wrap correlated union state in a nested property. */
export type FieldMetaSetter<M extends object = object> = (
    patch: true extends IsUnion<M> ? never : Partial<M> & { [P in keyof FieldMeta]?: never }
) => void;

/** Pure synchronous selector; reserved FieldMeta keys cannot be overridden. */
export type FieldMetaSelector<T extends Record<string, any>, M extends object> =
    (data: Readonly<T>) => M &
        { [P in keyof FieldMeta]?: never } &
        (M extends PromiseLike<unknown> ? never : unknown);

/** Optional UI metadata; reserved FieldMeta keys cannot be overridden. */
export interface UseModelFieldStateOptions<
    T extends Record<string, any>,
    M extends object = object,
> {
    /** Selector for this binding; see docs/REACT.md. */
    meta?: FieldMetaSelector<T, M>;
}

/** Committed field binding with setters and metadata; see docs/REACT.md. */
export function useModelFieldState<
    T extends Record<string, any>, K extends ModelFieldKey<T>, M extends object,
>(
    model: ModelReturn<T>,
    field: K,
    options: Required<UseModelFieldStateOptions<T, M>>
): [T[K], FieldSetter<T[K]>, FieldMeta & M, FieldMetaSetter<M>];
export function useModelFieldState<
    T extends Record<string, any>, K extends ModelFieldKey<T>, M extends object = object,
>(
    model: ModelReturn<T>,
    field: K,
    options?: UseModelFieldStateOptions<T, M>
): [T[K], FieldSetter<T[K]>, FieldMeta & Partial<M>, FieldMetaSetter<M>];
export function useModelFieldState<
    T extends Record<string, any>,
    K extends ModelFieldKey<T>,
    M extends object = object,
>(
    model: ModelReturn<T>,
    field: K,
    options: UseModelFieldStateOptions<T, M> = {}
): [T[K], FieldSetter<T[K]>, FieldMeta & Partial<M>, FieldMetaSetter<M>] {
    const selectMeta = options.meta;
    const metaStore = useMemo(createFieldMetaStore, [model, field]);

    const subscribe = useCallback(
        (notify: () => void) => {
            const fieldName = String(field);
            const validationHandler = (e: { field?: string }): void => {
                if (e.field === fieldName) notify();
            };
            const unsubscribers = [
                metaStore.subscribe(notify),
                model.on(ModelEvents.FIELD_CHANGE, notify),
                model.on(ModelEvents.VALIDATION_ERROR, validationHandler),
                model.on(ModelEvents.REACTION_ERROR, validationHandler),
                model.on(ModelEvents.FIELD_VALIDATION_COMPLETE, validationHandler),
                model.on(ModelEvents.DIRTY_DATA_CLEARED, (e) => {
                    if (e.fields.some((name) => name === fieldName)) notify();
                }),
            ];
            return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
        },
        [model, field, metaStore]
    );
    const getSnapshot = useMemo(() => {
        let cache: {
            data: Readonly<T>;
            patch: ReturnType<typeof metaStore.getSnapshot>;
            snapshot: { value: T[K]; meta: Omit<FieldMeta, 'validating'> & Partial<M> };
        } | undefined;

        return () => {
            const data = model.data;
            const patch = metaStore.getSnapshot();
            const errorMap = model.validationErrors;
            const errors = Object.prototype.hasOwnProperty.call(errorMap, field)
                ? errorMap[String(field)]!
                : EMPTY_ERRORS;
            const dirty = Object.prototype.hasOwnProperty.call(
                model.getDirtyData(),
                field
            );
            if (
                cache && cache.data === data && cache.patch === patch &&
                cache.snapshot.meta.errors === errors &&
                cache.snapshot.meta.dirty === dirty
            ) {
                return cache.snapshot;
            }
            const next = {
                value: model.getField(field),
                meta: {
                    ...(cache?.data === data ? cache.snapshot.meta : selectMeta?.(data)),
                    ...patch,
                    errors,
                    dirty,
                } as Omit<FieldMeta, 'validating'> & Partial<M>,
            };
            const snapshot = cache &&
                Object.is(cache.snapshot.value, next.value) &&
                shallow(cache.snapshot.meta, next.meta)
                ? cache.snapshot : next;
            cache = { data, patch, snapshot };
            return snapshot;
        };
    }, [model, field, selectMeta, metaStore]);
    const { value, meta: fieldMeta } = useSyncExternalStore(
        subscribe,
        getSnapshot,
        getSnapshot
    );

    const [validationState, setValidationState] = useState(() => ({
        session: { model, field },
        count: 0,
    }));
    const { session } = validationState;
    if (session.model !== model || session.field !== field) {
        // Validation session isolation: docs/REACT.md.
        setValidationState({ session: { model, field }, count: 0 });
    }
    const validating =
        session.model === model &&
        session.field === field &&
        validationState.count > 0;

    const setter = useCallback<FieldSetter<T[K]>>(
        async (next) => {
            const changePending = (delta: number) => setValidationState((current) =>
                current.session === session
                    ? { session, count: current.count + delta }
                    : current
            );
            changePending(1);
            try {
                return await model.setField(field, next);
            } finally {
                changePending(-1);
            }
        },
        [model, field, session]
    );

    const meta = {
        ...fieldMeta,
        validating,
    } as FieldMeta & Partial<M>;

    return [value, setter, meta, metaStore.set];
}

const EMPTY_ERRORS: ValidationError[] = [];

interface FieldMetaStore {
    getSnapshot(): Readonly<Record<PropertyKey, unknown>>;
    subscribe(notify: () => void): () => void;
    set(patch: object): void;
}

/** Overrides for one mounted field binding. */
function createFieldMetaStore(): FieldMetaStore {
    let snapshot: Readonly<Record<PropertyKey, unknown>> = Object.freeze({});
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => snapshot,
        subscribe: (notify) => {
            listeners.add(notify);
            return () => { listeners.delete(notify); };
        },
        set: (patch) => {
            const next = { ...snapshot, ...patch };
            delete next.errors;
            delete next.validating;
            delete next.dirty;
            if (shallow(snapshot, next)) return;
            snapshot = Object.freeze(next);
            listeners.forEach((notify) => notify());
        },
    };
}
