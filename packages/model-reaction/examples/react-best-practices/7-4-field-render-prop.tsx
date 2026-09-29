/**
 * BEST_PRACTICES §7.4 — `<Field>` for committed-value controls
 *
 * Use the `<Field>` render-prop form for controls such as selects that can
 * bind directly to committed data without an edit-in-progress text value.
 */
import * as React from 'react';
void React;

import { createModel } from '../../src/index';
import { Field, ModelProvider } from '../../src/react';

interface User {
    plan: 'free' | 'pro';
}

const userModel = createModel<User>({
    plan: { type: 'enum', values: ['free', 'pro'], default: 'free' },
});

export function PlanFieldDemo() {
    return (
        <ModelProvider model={userModel}>
            <Field<User, 'plan'> name="plan">
                {({ value, setValue, meta }) => (
                    <label>
                        <select
                            value={value}
                            onChange={(e) =>
                                setValue(e.target.value as User['plan'])
                            }
                            aria-invalid={!!meta.error}
                        >
                            <option value="free">Free</option>
                            <option value="pro">Pro</option>
                        </select>
                        {meta.error && <span>{meta.error}</span>}
                    </label>
                )}
            </Field>
        </ModelProvider>
    );
}
