/**
 * BEST_PRACTICES §7.6 — Submission flow
 *
 * Submission and lifecycle contract: docs/REACT.md.
 */
import * as React from 'react';
void React;

import { createModel } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';
import { useModel } from 'model-reaction/react';

interface User {
    name: string;
    email: string;
}

const userModel = createModel<User>({
    name:  { type: 'string', default: '', validator: [ValidationRules.required] },
    email: { type: 'string', default: '', validator: [ValidationRules.email] },
});

const api = {
    save: async (_data: User): Promise<void> => {
        // pretend network call
    },
};

export function SubmitButton() {
    const model = useModel<User>();
    async function onSubmit() {
        await model.settled();
        const ok = await model.validateAll();
        await model.settled();
        if (!ok || Object.values(model.validationErrors).some((errors) => errors.length > 0)) return;
        await api.save(model.data);
    }
    return <button onClick={onSubmit}>Submit</button>;
}

export { userModel };
