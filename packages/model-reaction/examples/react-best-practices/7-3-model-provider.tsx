/**
 * BEST_PRACTICES §7.3 — Avoid prop drilling with `<ModelProvider>`
 *
 * Wrap the form root once, then descendants pull the model out via
 * `useModel<T>()` without prop-drilling.
 */
import * as React from 'react';
void React;

import { createModel, ValidationRules } from '../../src/index';
import {
    ModelProvider,
    useModel,
    useModelFieldState,
} from '../../src/react';

interface User {
    name: string;
    address: string;
}

const userModel = createModel<User>({
    name:    { type: 'string', default: '', validator: [ValidationRules.required] },
    address: { type: 'string', default: '' },
});

function NameField() {
    const model = useModel<User>();
    const [name, setName] = useModelFieldState(model, 'name');
    return (
        <input value={name} onChange={(e) => setName(e.target.value)} />
    );
}

function AddressFields() {
    const model = useModel<User>();
    const [address, setAddress] = useModelFieldState(model, 'address');
    return (
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
    );
}

function SubmitButton() {
    const model = useModel<User>();
    return <button onClick={() => model.validateAll()}>Submit</button>;
}

export function UserForm() {
    return (
        <ModelProvider model={userModel}>
            <NameField />
            <AddressFields />
            <SubmitButton />
        </ModelProvider>
    );
}
