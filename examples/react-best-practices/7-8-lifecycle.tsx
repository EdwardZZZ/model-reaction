/**
 * BEST_PRACTICES §7.8 — Lifecycle and cleanup
 *
 * In long-lived SPAs, dispose models when their owning route unmounts.
 * Do NOT dispose a model that still has mounted subscribers — they will
 * throw on next read.
 */
import * as React from 'react';
import { useEffect, useMemo } from 'react';
void React;

import { createModel, ValidationRules } from '../../src/index';
import { ModelProvider } from '../../src/react';

interface User {
    name: string;
}

export function UserRoute() {
    const model = useMemo(
        () =>
            createModel<User>({
                name: {
                    type: 'string',
                    default: '',
                    validator: [ValidationRules.required],
                },
            }),
        [],
    );

    useEffect(() => {
        return () => model.dispose();
    }, [model]);

    return (
        <ModelProvider model={model}>
            <div>{/* form goes here */}</div>
        </ModelProvider>
    );
}
