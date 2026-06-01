/**
 * BEST_PRACTICES §7.5 — Touched semantics
 *
 * `useModelFieldState` deliberately does NOT track `touched` — it is a
 * pure UI concern with no place on the model. Keep it as a single
 * component-local `useState(false)` and wire `setTouched(true)` on
 * `onBlur` so errors only appear after the user leaves the field.
 */
import * as React from 'react';
import { useState } from 'react';
void React;

import { createModel, ValidationRules } from '../../src/index';
import { useModelFieldState } from '../../src/react';

interface User {
    name: string;
}

const userModel = createModel<User>({
    name: { type: 'string', default: '', validator: [ValidationRules.required] },
});

export function NameInput() {
    const [name, setName, meta] = useModelFieldState(userModel, 'name');
    const [touched, setTouched] = useState(false);
    return (
        <label>
            <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
            />
            {touched && meta.error && <span>{meta.error}</span>}
            <button type="button" onClick={() => setTouched(false)}>
                Reset touched
            </button>
        </label>
    );
}
