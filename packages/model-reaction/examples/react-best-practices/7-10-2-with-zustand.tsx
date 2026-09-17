/**
 * BEST_PRACTICES §7.10.2 — Combine with zustand for global state
 *
 * Rule of thumb:
 *   zustand        owns *application* state (open / closed, current
 *                  user id, theme).
 *   model-reaction owns *entity* state (the user record being edited,
 *                  including its rules).
 *
 * NOTE: this demo imports `zustand`. If it is not installed in your
 * project, run `npm install zustand` before using it.
 */
import * as React from 'react';
void React;

// eslint-disable-next-line import/no-unresolved
import { create } from 'zustand';

import { createModel, ValidationRules } from '../../src/index';
import { ModelProvider } from '../../src/react';

interface User {
    name: string;
    email: string;
}

// Global UI store — zustand
const useUI = create<{ drawerOpen: boolean; toggle: () => void }>((set) => ({
    drawerOpen: false,
    toggle: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));

// Domain form — model-reaction
const userModel = createModel<User>({
    name:  { type: 'string', default: '', validator: [ValidationRules.required] },
    email: { type: 'string', default: '', validator: [ValidationRules.email] },
});

function UserForm() {
    return <div>{/* fields bound to userModel */}</div>;
}

export function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return (
        <ModelProvider model={userModel}>
            <UserForm />
        </ModelProvider>
    );
}
