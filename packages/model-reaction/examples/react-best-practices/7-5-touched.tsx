/**
 * BEST_PRACTICES §7.5 — Touched semantics
 *
 * `useDraftField` keeps `touched` in the React adapter rather than the model
 * and exposes `onBlur` / `showError` for the standard text-input flow.
 */
import * as React from 'react';
void React;

import { createModel, ValidationRules } from '../../src/index';
import { useDraftField } from '../../src/react';

interface User {
    name: string;
}

const userModel = createModel<User>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
});

export function NameInput() {
    const { draft, setDraft, meta, onBlur, showError } = useDraftField(
        userModel,
        'name'
    );
    return (
        <label>
            <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={onBlur}
            />
            {showError && <span>{meta.error}</span>}
        </label>
    );
}
