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
import { useEffect, useState, type ReactNode } from 'react';
void React;

import { create } from 'zustand';

import {
    createModel,
    ValidationRules,
    type ModelReturn,
} from '../../src/index';
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

function UserForm() {
    return <div>{/* fields consume the owned model through context */}</div>;
}

function UserModelOwner({ children }: { children: ReactNode }) {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    useEffect(() => {
        const owned = createModel<User>({
            name: {
                type: 'string',
                default: '',
                validator: [ValidationRules.required],
            },
            email: {
                type: 'string',
                default: '',
                validator: [ValidationRules.email],
            },
        });
        setModel(owned);
        return () => owned.dispose();
    }, []);
    if (!model) return null;
    return <ModelProvider model={model}>{children}</ModelProvider>;
}

export function UserDrawer() {
    const open = useUI((s) => s.drawerOpen);
    if (!open) return null;
    return (
        <UserModelOwner>
            <UserForm />
        </UserModelOwner>
    );
}
