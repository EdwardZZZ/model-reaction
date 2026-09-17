import { createModel } from 'model-reaction/devtools';
import { ValidationRules } from 'model-reaction';
import { TextField } from '../TextField';
import { useOwnedModel } from '../useOwnedModel';

interface SignupForm {
    username: string;
    email: string;
}

// Pretend these usernames are already taken; the check is async with latency.
const TAKEN = new Set(['admin', 'root', 'ada']);

function checkUsernameAvailable(value: string): Promise<boolean> {
    return new Promise((resolve) => {
        setTimeout(() => resolve(!TAKEN.has(value.toLowerCase())), 600);
    });
}

/**
 * Async validation scenario: the username field runs an async validator that
 * simulates a "is this taken?" server round-trip. Watch `validating` toggle and
 * failed values land in `dirtyData` in the DevTools data tree.
 */
export function AsyncValidation() {
    const model = useOwnedModel<SignupForm>(() =>
        createModel<SignupForm>({
            username: {
                type: 'string',
                default: '',
                validator: [
                    ValidationRules.required.withMessage('Username required'),
                    ValidationRules.minLength(3).withMessage('At least 3 characters'),
                    {
                        type: 'async-available',
                        message: 'That username is taken',
                        validate: (value: string) => checkUsernameAvailable(value),
                    },
                ],
            },
            email: {
                type: 'string',
                default: '',
                validator: [
                    ValidationRules.required.withMessage('Email required'),
                    ValidationRules.email.withMessage('Invalid email'),
                ],
            },
        })
    );

    return (
        <section className="scenario">
            <h2>Async validation</h2>
            <p className="scenario-desc">
                <code>username</code> runs an async availability check (~600ms).
                Try <code>ada</code>, <code>admin</code> or <code>root</code> —
                the field shows <em>validating…</em>, then the rejected value
                appears under <code>dirtyData</code> in the panel.
            </p>
            <div className="row">
                <TextField model={model} field="username" label="Username" placeholder="try 'ada'" />
                <TextField model={model} field="email" label="Email" placeholder="you@example.com" />
            </div>
        </section>
    );
}
