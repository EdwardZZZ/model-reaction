import type { ModelReturn } from 'model-reaction';
import { useModelFieldState } from 'model-reaction/react';
import { useEffect, useState } from 'react';

/**
 * A controlled text input bound to one model field.
 *
 * The displayed text is held in local component state, not read back from the
 * model. This is deliberate and matches the library's design: the model stores
 * only validated truth (`data`) plus the last failed input (`dirtyData`), while
 * "the text currently being edited" is a UI concern that belongs to the
 * component (same rationale the library gives for `touched`; see AGENTS.md §5).
 *
 * Why it matters here: the library uses verify-then-commit, so a value that
 * fails validation never lands in `data`. If the input's `value` read straight
 * from `getField` (committed data), every keystroke that is transiently invalid
 * — e.g. "a" under a minLength(3) or email rule — would be rejected and the
 * field would snap back to empty, making the field feel impossible to type in.
 * Holding the draft locally lets the user type freely; validation errors are
 * surfaced separately via `meta`.
 */
export function TextField<T extends Record<string, any>>({
    model,
    field,
    label,
    placeholder,
    readOnly,
}: {
    model: ModelReturn<T>;
    field: keyof T & string;
    label: string;
    placeholder?: string;
    readOnly?: boolean;
}) {
    const [committed, setValue, meta] = useModelFieldState(model, field);
    // Local draft = what the user sees while editing. Seed from the committed
    // value (covers schema defaults on first render).
    const [draft, setDraft] = useState(() => String(committed ?? ''));
    const [touched, setTouched] = useState(false);
    const showError = touched && meta.error;

    // If the committed value changes from outside this input (a reaction, a
    // programmatic setField elsewhere), reflect it in the draft.
    useEffect(() => {
        setDraft(String(committed ?? ''));
    }, [committed]);

    return (
        <label className="field">
            <span className="field-label">
                {label}
                {meta.validating && <span className="badge">validating…</span>}
                {meta.dirty && <span className="badge badge-warn">dirty</span>}
            </span>
            <input
                value={draft}
                placeholder={placeholder}
                readOnly={readOnly}
                aria-invalid={Boolean(showError)}
                onChange={(e) => {
                    const next = e.target.value;
                    setDraft(next); // show what was typed, valid or not
                    void setValue(next as T[keyof T & string]); // validate + maybe commit
                }}
                onBlur={() => setTouched(true)}
            />
            {showError && <small role="alert" className="field-error">{meta.error}</small>}
        </label>
    );
}
