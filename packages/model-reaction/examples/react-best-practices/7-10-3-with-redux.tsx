/**
 * BEST_PRACTICES §7.10.3 — Combine with Redux Toolkit
 *
 * In Redux apps, keep RTK as the application skeleton and drop a
 * `model-reaction` model wherever you would otherwise spawn a slice
 * purely for an editor / wizard / form.
 *
 * NOTE: this demo imports `react-redux`. If it is not installed in your
 * project, run `npm install react-redux` before using it.
 *
 * `userSchema`, `selectCurrentUserId` and `saveUser` are project-specific
 * placeholders — replace them with your real implementations.
 */
import * as React from 'react';
import { useEffect, useMemo } from 'react';
void React;

// eslint-disable-next-line import/no-unresolved
import { useDispatch, useSelector } from 'react-redux';

import { createModel, type ModelReturn } from '../../src/index';
import { ModelProvider } from '../../src/react';

interface User {
    id: string;
    name: string;
}

// Project-provided slice glue (placeholders).
declare const userSchema: Parameters<typeof createModel<User>>[0];
declare function selectCurrentUserId(state: unknown): string;
declare function saveUser(data: User): { type: string; payload: User };

function UserForm({ onSubmit }: { onSubmit: () => void }) {
    return <button onClick={onSubmit}>Save</button>;
}

export function EditUserPage() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const userId = useSelector(selectCurrentUserId);
    const dispatch = useDispatch();
    const model: ModelReturn<User> = useMemo(() => createModel<User>(userSchema), []);

    useEffect(() => () => model.dispose(), [model]);

    async function onSave() {
        if (!(await model.validateAll())) return;
        await model.settled();
        dispatch(saveUser(model.data));
    }

    return (
        <ModelProvider model={model}>
            <UserForm onSubmit={onSave} />
        </ModelProvider>
    );
}
