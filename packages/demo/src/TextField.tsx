import { useDraftField, useModel } from 'model-reaction/react';

/**
 * A controlled text input bound to the nearest provided model.
 *
 * All edit-lifecycle state (the draft, seeding from committed data, the
 * validate-then-commit on change, and the `touched`/blur gate for errors) lives
 * in `useDraftField` from `model-reaction/react`. This component owns only
 * presentation: layout, the validating/dirty badges, and rendering the gated
 * error.
 */
export function TextField<T extends Record<string, any>>({
    field,
    label,
    placeholder,
    readOnly,
}: {
    field: keyof T & string;
    label: string;
    placeholder?: string;
    readOnly?: boolean;
}) {
    const model = useModel<T>();
    const { draft, setDraft, meta, onBlur, showError } = useDraftField(model, field);

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
                aria-invalid={showError}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
            />
            {showError && <small role="alert" className="field-error">{meta.error}</small>}
        </label>
    );
}
