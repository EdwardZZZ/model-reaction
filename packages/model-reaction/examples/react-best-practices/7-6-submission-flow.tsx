/**
 * docs/REACT.md#submission-flow — Submission flow
 *
 * Submission and lifecycle contract: docs/REACT.md.
 */
import * as React from 'react';
void React;

import { createModel } from 'model-reaction';
import { useModel } from 'model-reaction/react';

interface User {
    name: string;
    email: string;
}

const userModel = createModel<User>({
    name:  { type: 'string', default: '' },
    email: { type: 'string', default: '' },
});

const api = {
    save: async (_data: User): Promise<void> => {
        // pretend network call
    },
};

export function SubmitButton() {
    const model = useModel<User>();
    const [error, setError] = React.useState('');
    async function onSubmit() {
        await model.settled();
        const snapshot = model.data;
        const message = !snapshot.name.trim() ? 'Name is required'
            : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.email) ? 'Invalid email' : '';
        setError(message);
        if (message) return;
        await api.save(snapshot);
    }
    return <div><button onClick={onSubmit}>Submit</button>{error && <span role="alert">{error}</span>}</div>;
}

export { userModel };
