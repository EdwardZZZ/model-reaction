/**
 * BEST_PRACTICES §7.5 — Touched semantics
 *
 * `useModelFieldState` does not auto-flip `touched`. Wire it on `onBlur`
 * so errors only appear after the user leaves the field. Use
 * `helpers.reset()` after a successful submit to clear local hook state.
 */
import * as React from 'react';
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
    const [name, setName, meta, helpers] = useModelFieldState(userModel, 'name');
    return (
        <label>
            <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => helpers.setTouched()}
            />
            {meta.touched && meta.error && <span>{meta.error}</span>}
            <button type="button" onClick={() => helpers.reset()}>
                Reset local state
            </button>
        </label>
    );
}
