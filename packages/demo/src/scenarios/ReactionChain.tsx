import { createModel } from 'model-reaction/devtools';
import { ValidationRules } from 'model-reaction';
import { useModelField } from 'model-reaction/react';
import { TextField } from '../TextField';
import { useOwnedModel } from '../useOwnedModel';

interface NameForm {
    firstName: string;
    lastName: string;
    fullName: string;
    greeting: string;
}

/**
 * Reaction chain scenario: firstName/lastName → fullName → greeting.
 * Two dependency layers, so the DevTools graph shows firstName,lastName feeding
 * fullName, and fullName feeding greeting.
 */
export function ReactionChain() {
    const model = useOwnedModel<NameForm>(() =>
        createModel<NameForm>({
            firstName: {
                type: 'string',
                default: 'Ada',
                validator: [ValidationRules.required.withMessage('First name required')],
            },
            lastName: {
                type: 'string',
                default: 'Lovelace',
                validator: [ValidationRules.required.withMessage('Last name required')],
            },
            fullName: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['firstName', 'lastName'],
                    computed: ({ firstName, lastName }) =>
                        `${firstName} ${lastName}`.trim(),
                },
            },
            greeting: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['fullName'],
                    computed: ({ fullName }) =>
                        fullName ? `Hello, ${fullName}!` : 'Hello, stranger!',
                },
            },
        })
    );

    const fullName = useModelField(model, 'fullName');
    const greeting = useModelField(model, 'greeting');

    return (
        <section className="scenario">
            <h2>Reaction chain</h2>
            <p className="scenario-desc">
                <code>firstName</code>, <code>lastName</code> →{' '}
                <code>fullName</code> → <code>greeting</code>. Edit a name and
                watch two derivation layers cascade in the DevTools dependency
                graph.
            </p>
            <div className="row">
                <TextField model={model} field="firstName" label="First name" />
                <TextField model={model} field="lastName" label="Last name" />
            </div>
            <div className="derived">
                <div><span className="derived-label">fullName</span> {fullName || '—'}</div>
                <div><span className="derived-label">greeting</span> {greeting || '—'}</div>
            </div>
        </section>
    );
}
