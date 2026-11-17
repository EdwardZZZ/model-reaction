import { useModelFieldState, useModel } from 'model-reaction/react';

/** A controlled input bound directly to the nearest provided model. */
export function TextField<T extends Record<string, any>>({
    field,
    label,
    placeholder,
    readOnly,
    type = 'text',
}: {
    field: keyof T & string;
    label: string;
    placeholder?: string;
    readOnly?: boolean;
    type?: 'text' | 'number';
}) {
    const model = useModel<T>();
    const [value, setValue] = useModelFieldState(model, field);
    const displayed = typeof value === 'number' && !Number.isFinite(value) ? '' : value ?? '';

    return (
        <label className="field">
            <span className="field-label">
                {label}
            </span>
            <input
                type={type}
                value={displayed}
                placeholder={placeholder}
                readOnly={readOnly}
                onChange={(e) => setValue(
                    (type === 'number' ? Number(e.target.value) : e.target.value) as T[keyof T & string]
                )}
            />
        </label>
    );
}
