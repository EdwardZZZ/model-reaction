/**
 * BEST_PRACTICES §7.6 — Submission flow
 *
 * Validation is async, so submit handlers should always
 * `await validateAll()` and then `await model.settled()` before reading
 * `model.data`.
 */
import * as React from 'react';
void React;

import { createModel, ValidationRules } from '../../src/index';
import { useModel } from '../../src/react';

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
        const ok = await model.validateAll();
        if (!ok) return;
        await model.settled();      // wait for any pending reactions
        await api.save(model.data);
    }
    return <button onClick={onSubmit}>Submit</button>;
}

export { userModel };
