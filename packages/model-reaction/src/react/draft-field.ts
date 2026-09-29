import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelReturn } from '../types';
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

/** What {@link useDraftField} hands back to a controlled input. */
export interface DraftField<V> {
    /** Text shown in the input; updates on every keystroke regardless of validity. */
    draft: string;
    /** Reflect an edit locally, then validate-then-commit it. Wire to `onChange`. */
    setDraft: (next: string) => void;
    /** Model-side metadata for this field (errors, validating, dirty). */
    meta: FieldMeta;
    /** True once the input has been blurred at least once. */
    touched: boolean;
    /** Flips `touched` on. Wire to `onBlur`. */
    onBlur: () => void;
    /** `touched && meta.error`; the message itself is `meta.error`. */
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
    K extends keyof T,
>(
    model: ModelReturn<T>,
    field: K,
    options: UseDraftFieldOptions<T[K]> = {}
): DraftField<T[K]> {
    const [committed, setValue, meta] = useModelFieldState(model, field);

    // Ref-lock `format` so an inline arrow needs no useCallback and doesn't
    // retrigger the reseed effect. `toDisplay` handles nullish / non-finite.
    const formatRef = useRef<(value: T[K]) => string>(options.format ?? String);
    formatRef.current = options.format ?? String;
    const display = useCallback(
        (value: T[K]) => toDisplay(value, formatRef.current),
        []
    );

    // Seed once on mount: pending dirty value if any, else committed value.
    const [draft, setDraft] = useState(() => {
        const pending = (model.getDirtyData() as Partial<T>)[field];
        return display((pending ?? committed) as T[K]);
    });
    const [touched, setTouched] = useState(false);

    // Reflect outside-driven commits (a reaction, a setField elsewhere). Keyed
    // off the previous committed value, not a "first render" flag: on mount it
    // matches so the seeded draft survives, and this stays correct under
    // StrictMode's setup→cleanup→setup double-invoke (a mount flag would not).
    const lastCommitted = useRef(committed);
    useEffect(() => {
        if (Object.is(lastCommitted.current, committed)) return;
        lastCommitted.current = committed;
        setDraft(display(committed));
    }, [committed, display]);

    const edit = useCallback(
        (next: string) => {
            setDraft(next); // show what was typed, valid or not
            // Draft is always a string; non-string fields rely on schema `transform`.
            void setValue(next as unknown as T[K]);
        },
        [setValue]
    );

    const onBlur = useCallback(() => setTouched(true), []);
    const showError = Boolean(touched && meta.error);

    return { draft, setDraft: edit, meta, touched, onBlur, showError, committed };
}
