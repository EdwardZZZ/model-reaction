import { createModel } from 'model-reaction/devtools';
import type { ModelReturn } from 'model-reaction';
import { ModelProvider, useModel, useModelField } from 'model-reaction/react';
import { TextField } from '../TextField';
import { useOwnedModel } from '../useOwnedModel';

interface SignupForm {
    username: string;
    checkedUsername: string;
    availability: string;
}

const TAKEN = new Set(['admin', 'root', 'ada']);

function makeSignupModel(): ModelReturn<SignupForm> {
    let active = true;
    let revision = 0;
    const model: ModelReturn<SignupForm> = createModel<SignupForm>({
        username: { type: 'string', default: '' },
        availability: { type: 'string', default: 'Enter a username' },
        checkedUsername: {
            type: 'string',
            default: '',
            reaction: {
                fields: ['username'],
                computed: ({ username }) => username.trim().toLowerCase(),
                action: [async () => {
                    const version = revision;
                    const username = model.data.checkedUsername;
                    if (username.length < 3) {
                        model.setField('availability', 'Use at least 3 characters');
                        return;
                    }
                    model.setField('availability', 'Checking…');
                    await new Promise<void>((resolve) => setTimeout(resolve, 600));
                    if (!active || version !== revision) return;
                    model.setField('availability', TAKEN.has(username) ? 'Already taken' : 'Available');
                }],
            },
        },
    });
    const off = model.subscribe((data) => data.username, () => { revision++; });
    const dispose = model.dispose;
    model.dispose = () => { active = false; off(); dispose(); };
    return model;
}

export function AsyncAction() {
    const model = useOwnedModel(makeSignupModel);
    if (!model) return null;
    return <ModelProvider model={model}><AsyncActionView /></ModelProvider>;
}

function AsyncActionView() {
    const model = useModel<SignupForm>();
    const availability = useModelField(model, 'availability');
    return (
        <section className="scenario">
            <h2>Async action</h2>
            <p className="scenario-desc">
                Username edits commit immediately. An action checks availability
                after ~600ms; the application ignores responses for an older username.
                Try <code>ada</code>, <code>admin</code> or <code>root</code>.
            </p>
            <TextField<SignupForm> field="username" label="Username" placeholder="try 'ada'" />
            <p role="status">{availability}</p>
        </section>
    );
}
