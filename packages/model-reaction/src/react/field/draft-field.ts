import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModelEvents } from '../../types';
import type { ModelFieldKey, ModelReturn } from '../../types';
import { useModelFieldState, type FieldMeta } from './field-state';

/**
 * Render a committed/pending value as input text (hydration path only, never
 * live keystrokes). `format` defaults to `String`; nullish and non-finite
 * numbers collapse to `''` first, so an unset field or an unparseable `NaN`
 * (e.g. "12a" via `transform: Number`) shows blank rather than "null"/"NaN".
 */
function toDisplay<V>(value: V, format: (value: V) => string): string {
    if (value == null) return '';
    if (typeof value === 'number' && !Number.isFinite(value)) return '';
    return format(value);
}

function seedDraft<T extends Record<string, any>, K extends ModelFieldKey<T>>(
    model: ModelReturn<T>,
    field: K,
    committed: T[K],
    display: (value: T[K]) => string
): string {
    const dirtyData = model.getDirtyData();
    const value = Object.prototype.hasOwnProperty.call(dirtyData, field)
        ? dirtyData[field]
        : committed;
    return display(value as T[K]);
}

function asWriteError(error: unknown): Error {
    if (error instanceof Error) return error;
    try {
        return new Error(String(error));
    } catch {
        return new Error('Field write failed');
    }
}

/** What {@link useDraftField} hands back to a controlled input. */
export interface DraftField<V> {
    /** Text shown in the input; updates on every keystroke regardless of validity. */
    draft: string;
    /** Reflect an edit locally, then validate-then-commit it. Wire to `onChange`. */
    setDraft: (next: string) => void;
    /** Model-side metadata for this field (errors, validating, dirty). */
    meta: FieldMeta;
    /** Latest edit's write exception, kept locally rather than in model errors. */
    writeError: Error | null;
    /** True once the input has been blurred at least once. */
    touched: boolean;
    /** Flips `touched` on. Wire to `onBlur`. */
    onBlur: () => void;
    /** `touched && (writeError || meta.errors.length > 0)`; prefer `writeError.message`. */
    showError: boolean;
    /** The last value the model committed to `data`. Rarely needed directly. */
    committed: V;
}

/** Options for {@link useDraftField}. */
export interface UseDraftFieldOptions<V> {
    /**
     * How a committed/pending value becomes input text on reseed. Defaults to
     * `String`. Override to keep a format the model doesn't store — e.g. a cents
     * field can show `(c) => (c / 100).toFixed(2)`. Nullish/non-finite values
     * still collapse to `''` first; the text→value direction stays with the
     * schema's `transform`.
     */
    format?: (value: V) => string;
}

interface DraftSession<V> {
    committed: V;
    pending: Set<() => void>;
    edit: number;
    acceptedEdit: number;
    active: boolean;
}

interface DraftState<V> {
    session: DraftSession<V>;
    draft: string;
    touched: boolean;
    writeError: Error | null;
}

/**
 * Bind a model field to a controlled text input, owning the edit-lifecycle
 * UI state (draft text, `touched`, error gating) so the rendering component
 * stays presentational. This is the recommended form binding for text inputs;
 * use {@link useModelFieldState} directly for non-text controls.
 *
 * The draft — "the text being edited" — lives in local state, not the model:
 * under verify-then-commit an invalid or still-in-flight keystroke never reaches
 * `data`, so binding an input straight to the model makes it feel un-typeable.
 * Full rationale in docs/REACT.md.
 *
 * On mount the draft seeds from `dirtyData` (the last failed input), then the
 * committed value, so a model that outlives the input restores a not-yet-valid
 * entry across remount. Live editing never reads back from the model.
 *
 * Field-type contract (string-only; non-string needs a schema `transform`) and
 * the `format` option: see docs/REACT.md "Field-type contract".
 */
export function useDraftField<
    T extends Record<string, any>,
    K extends ModelFieldKey<T>,
>(
    model: ModelReturn<T>,
    field: K,
    options: UseDraftFieldOptions<T[K]> = {}
): DraftField<T[K]> {
    const [committed, setValue, meta] = useModelFieldState(model, field);

    const formatRef = useRef<(value: T[K]) => string>(options.format ?? String);
    // Publish only committed renders, before reconciliation; see docs/REACT.md.
    useEffect(() => {
        formatRef.current = options.format ?? String;
    }, [options.format]);
    const display = useCallback(
        (value: T[K]) => toDisplay(value, formatRef.current),
        []
    );

    const session = useMemo<DraftSession<T[K]>>(() => ({
        committed: model.getField(field),
        pending: new Set<() => void>(),
        edit: 0,
        acceptedEdit: 0,
        active: false,
    }), [model, field]);

    const seedState = (): DraftState<T[K]> => ({
        session,
        draft: seedDraft(model, field, committed, (value) => toDisplay(value, options.format ?? String)),
        touched: false,
        writeError: null,
    });
    const [state, setState] = useState(seedState);
    // Reset before effects can edit the new session; abandoned renders stay isolated.
    const current = state.session === session ? state : seedState();
    if (current !== state) setState(current);
    const { draft, touched, writeError } = current;
    const updateState = useCallback((patch: Partial<Omit<DraftState<T[K]>, 'session'>>) => {
        setState((value) => value.session === session ? { ...value, ...patch } : value);
    }, [session]);

    const activeSession = useRef(session);
    useEffect(() => {
        activeSession.current = session;
        session.active = true;
        return () => {
            session.active = false;
            queueMicrotask(() => {
                if (!session.active) session.pending.forEach((unsubscribe) => unsubscribe());
            });
        };
    }, [session]);

    useEffect(() => {
        // Edit/commit reconciliation: docs/REACT.md "useDraftField".
        if (session.pending.size > 0 || Object.is(session.committed, committed)) return;
        session.committed = committed;
        updateState({ draft: display(committed) });
    }, [committed, display, session, updateState]);

    const edit = useCallback(
        (next: string) => {
            updateState({ draft: next, writeError: null });
            const editId = ++session.edit;
            let ownCommitted = session.committed;
            let observed = false;
            let unsubscribe = () => {};
            const stopObserving = () => unsubscribe();
            session.pending.add(stopObserving);
            // Register before this write resumes, after any reentrant dispatch; see docs/REACT.md.
            queueMicrotask(() => {
                if (!session.active || activeSession.current !== session) return;
                unsubscribe = model.on(ModelEvents.FIELD_VALIDATION_COMPLETE, (event) => {
                    if (event.field !== String(field) || observed) return;
                    observed = true;
                    ownCommitted = model.getField(field);
                });
            });
            // Draft is always a string; non-string fields rely on schema `transform`.
            void setValue(next as unknown as T[K]).then((accepted) => {
                if (accepted && editId >= session.acceptedEdit) {
                    session.acceptedEdit = editId;
                    session.committed = ownCommitted;
                }
            }).finally(() => {
                session.pending.delete(stopObserving);
                stopObserving();
                if (!session.active || activeSession.current !== session || session.pending.size > 0) return;
                const current = model.getField(field);
                if (!Object.is(session.committed, current)) {
                    session.committed = current;
                    updateState({ draft: display(current) });
                }
            }).catch((error: unknown) => {
                if (session.active && activeSession.current === session && editId === session.edit) {
                    updateState({ writeError: asWriteError(error) });
                }
            });
        },
        [model, field, setValue, display, session, updateState]
    );

    const onBlur = useCallback(() => updateState({ touched: true }), [updateState]);
    const showError = Boolean(touched && (writeError || meta.errors.length > 0));

    return { draft, setDraft: edit, meta, writeError, touched, onBlur, showError, committed };
}
