import { ModelProvider, useModel, useModelField } from 'model-reaction/react';
import { TextField } from '../TextField';
import { nameModel, type NameForm } from './reaction-chain-model';

/**
 * Reaction chain scenario: firstName/lastName → fullName → greeting.
 * Two dependency layers, so the DevTools graph shows firstName,lastName feeding
 * fullName, and fullName feeding greeting.
 */
export function ReactionChain() {
    return (
        <ModelProvider model={nameModel}>
            <ReactionChainView />
        </ModelProvider>
    );
}

function ReactionChainView() {
    const model = useModel<NameForm>();
    const fullName = useModelField(model, 'fullName');
    const greeting = useModelField(model, 'greeting');
    const nameActionRuns = useModelField(model, 'nameActionRuns');
    const capturedFullName = useModelField(model, 'capturedFullName');
    const capturedGreeting = useModelField(model, 'capturedGreeting');

    return (
        <section className="scenario">
            <h2>Reaction chain</h2>
            <p className="scenario-desc">
                <code>firstName</code>, <code>lastName</code> →{' '}
                <code>fullName</code> → <code>greeting</code>. Edit a name and
                watch two derivation layers cascade in the DevTools dependency
                graph. This model is shared across the app, so switching scenarios
                preserves its state.
            </p>
            <div className="row">
                <TextField<NameForm> field="firstName" label="First name" />
                <TextField<NameForm> field="lastName" label="Last name" />
            </div>
            <div className="derived">
                <div><span className="derived-label">fullName</span> {fullName || '—'}</div>
                <div><span className="derived-label">greeting</span> {greeting || '—'}</div>
            </div>
            <p className="scenario-desc">
                <code>fullName</code> runs <code>countNameAction</code> and{' '}
                <code>captureFullName</code>; <code>greeting</code> runs{' '}
                <code>captureFullName</code> and <code>captureGreeting</code>.
                Both fields share the same <code>captureFullName</code> function,
                which reads the committed full name and is deduplicated while queued.
                Dependencies shows one shared <code>captureFullName</code> node
                connected to both fields by dashed arrows. Inspect the actions in
                Dependencies and the writebacks below in Data Tree / Timeline.
                Actions also run during initialization.
            </p>
            <div className="derived" role="region" aria-label="Action results">
                <div><span className="derived-label">nameActionRuns</span> {nameActionRuns}</div>
                <div><span className="derived-label">capturedFullName</span> {capturedFullName || '—'}</div>
                <div><span className="derived-label">capturedGreeting</span> {capturedGreeting || '—'}</div>
            </div>
        </section>
    );
}
