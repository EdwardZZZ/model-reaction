/**
 * BEST_PRACTICES §7.8 — Lifecycle and cleanup
 *
 * Create a model after the owner commits, then dispose that same instance when
 * the owner and its subscribers unmount.
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
void React;

import { createModel, ValidationRules, type ModelReturn } from '../../src/index';
import { ModelProvider } from '../../src/react';

interface User {
    name: string;
}

export function UserRoute() {
    const [model, setModel] = useState<ModelReturn<User> | null>(null);
    useEffect(() => {
        const owned = createModel<User>({
            name: {
                type: 'string',
                default: '',
                validator: [ValidationRules.required],
            },
        });
        setModel(owned);
        return () => owned.dispose();
    }, []);

    if (!model) return null;

    return (
        <ModelProvider model={model}>
            <div>{/* form goes here */}</div>
        </ModelProvider>
    );
}
