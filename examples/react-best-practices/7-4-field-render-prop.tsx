/**
 * BEST_PRACTICES §7.4 — `<Field>` for declarative inputs
 *
 * Use the `<Field>` render-prop form to bind a leaf input + its error
 * without referencing the model directly.
 */
import * as React from 'react';
void React;

import { createModel, ValidationRules } from '../../src/index';
import { Field, ModelProvider } from '../../src/react';

interface User {
    name: string;
}

const userModel = createModel<User>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
});

export function NameFieldDemo() {
    return (
        <ModelProvider model={userModel}>
            <Field<User, 'name'> name="name">
                {({ value, setValue, meta, helpers }) => (
                    <label>
                        <input
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onBlur={() => helpers.setTouched()}
                            aria-invalid={!!meta.error}
                        />
                        {meta.touched && meta.error && <span>{meta.error}</span>}
                    </label>
                )}
            </Field>
        </ModelProvider>
    );
}
