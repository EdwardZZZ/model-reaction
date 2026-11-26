/** @jest-environment jsdom */
import * as React from 'react';
import { act, render } from '@testing-library/react';
import { createModel } from '../index';
import { ValidationRules } from '../validation';
import {
    Field,
    ModelProvider,
    useModel,
    useModelField,
    useModelSelector,
} from '../react';
import type { ModelReturn } from '../types';

// ---------------------------------------------------------------------------
// Provider-owned model lifecycle (docs/REACT.md#model-lifecycle-in-react)
//
// Verifies that wrapping `createModel(...)` in a Context Provider with a
// `useEffect` cleanup actually triggers `dispose()` exactly once when the
// owner unmounts — and that consumer hooks stop receiving updates afterwards.
// ---------------------------------------------------------------------------

describe('Provider-owned model dispose lifecycle', () => {
    interface UserData {
        name: string;
        email: string;
    }

    function makeUserModel() {
        return createModel<UserData>({
            name: { type: 'string', default: '' },
            email: { type: 'string', default: '' },
        });
    }

    it('dispose() is called exactly once when the Provider unmounts', () => {
        const model = makeUserModel();
        const disposeSpy = jest.spyOn(model, 'dispose');

        const Ctx = React.createContext<ModelReturn<UserData> | null>(null);

        function UserModelProvider({
            children,
            value,
        }: {
            children: React.ReactNode;
            value: ModelReturn<UserData>;
        }) {
            React.useEffect(() => {
                return () => {
                    value.dispose();
                };
            }, [value]);
            return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
        }

        function Consumer() {
            const m = React.useContext(Ctx)!;
            const name = useModelSelector(m, (d) => d.name);
            return <span data-testid="name">{name}</span>;
        }

        const { unmount } = render(
            <UserModelProvider value={model}>
                <Consumer />
            </UserModelProvider>
        );

        // Owner is alive — dispose should NOT have been called yet.
        expect(disposeSpy).not.toHaveBeenCalled();

        // Tear the tree down.
        act(() => {
            unmount();
        });

        // Cleanup of the Provider's effect must have triggered dispose exactly once.
        expect(disposeSpy).toHaveBeenCalledTimes(1);

        disposeSpy.mockRestore();
    });

    it('shared consumers stay in sync while the Provider is mounted, and the model is disposed afterwards', async () => {
        const model = makeUserModel();
        const disposeSpy = jest.spyOn(model, 'dispose');

        const Ctx = React.createContext<ModelReturn<UserData> | null>(null);

        function UserModelProvider({
            children,
            value,
        }: {
            children: React.ReactNode;
            value: ModelReturn<UserData>;
        }) {
            React.useEffect(() => () => value.dispose(), [value]);
            return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
        }

        function Profile() {
            const m = React.useContext(Ctx)!;
            const name = useModelSelector(m, (d) => d.name);
            return <span data-testid="profile-name">{name}</span>;
        }

        function Settings() {
            const m = React.useContext(Ctx)!;
            const email = useModelSelector(m, (d) => d.email);
            return <span data-testid="settings-email">{email}</span>;
        }

        const { getByTestId, unmount } = render(
            <UserModelProvider value={model}>
                <Profile />
                <Settings />
            </UserModelProvider>
        );

        // Both consumers see the same model instance.
        expect(getByTestId('profile-name').textContent).toBe('');
        expect(getByTestId('settings-email').textContent).toBe('');

        await act(async () => {
            await model.setField('name', 'Ada');
            await model.setField('email', 'ada@example.com');
        });

        expect(getByTestId('profile-name').textContent).toBe('Ada');
        expect(getByTestId('settings-email').textContent).toBe(
            'ada@example.com'
        );
        expect(disposeSpy).not.toHaveBeenCalled();

        // Unmount the whole tree → Provider effect cleanup runs → dispose().
        act(() => {
            unmount();
        });

        expect(disposeSpy).toHaveBeenCalledTimes(1);

        disposeSpy.mockRestore();
    });

    it('remounting the Provider with a fresh model does not re-dispose the old one', () => {
        const modelA = makeUserModel();
        const modelB = makeUserModel();
        const spyA = jest.spyOn(modelA, 'dispose');
        const spyB = jest.spyOn(modelB, 'dispose');

        const Ctx = React.createContext<ModelReturn<UserData> | null>(null);

        function UserModelProvider({
            children,
            value,
        }: {
            children: React.ReactNode;
            value: ModelReturn<UserData>;
        }) {
            React.useEffect(() => () => value.dispose(), [value]);
            return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
        }

        function Probe() {
            const m = React.useContext(Ctx)!;
            const name = useModelSelector(m, (d) => d.name);
            return <span>{name}</span>;
        }

        const { rerender, unmount } = render(
            <UserModelProvider value={modelA}>
                <Probe />
            </UserModelProvider>
        );

        // Swap in a different model — effect cleanup must fire for the old one.
        rerender(
            <UserModelProvider value={modelB}>
                <Probe />
            </UserModelProvider>
        );

        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).not.toHaveBeenCalled();

        unmount();

        // Final unmount tears down the live model (B).
        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).toHaveBeenCalledTimes(1);

        spyA.mockRestore();
        spyB.mockRestore();
    });
});


// ---------------------------------------------------------------------------
// useModel — Provider consumption
// ---------------------------------------------------------------------------

describe('useModel', () => {
    interface UserData {
        name: string;
    }

    it('reads the model from the nearest ModelProvider', () => {
        const model = createModel<UserData>({
            name: { type: 'string', default: 'Ada' },
        });

        function Consumer() {
            const m = useModel<UserData>();
            const name = useModelField(m, 'name');
            return <span data-testid="name">{name}</span>;
        }

        const { getByTestId } = render(
            <ModelProvider model={model}>
                <Consumer />
            </ModelProvider>
        );

        expect(getByTestId('name').textContent).toBe('Ada');
        model.dispose();
    });

    it('throws when used without a surrounding ModelProvider', () => {
        function Orphan() {
            useModel();
            return null;
        }
        // Silence the expected React error boundary logging.
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<Orphan />)).toThrow(/must be used inside/);
        spy.mockRestore();
    });
});


// ---------------------------------------------------------------------------
// Field — render-prop binding
// ---------------------------------------------------------------------------

describe('Field', () => {
    interface FormData {
        email: string;
    }

    function makeFormModel() {
        return createModel<FormData>({
            email: {
                type: 'string',
                default: '',
                validator: [ValidationRules.email],
            },
        });
    }

    it('binds a render-prop to a field via the surrounding provider', async () => {
        const model = makeFormModel();

        const { getByTestId } = render(
            <ModelProvider model={model}>
                <Field<FormData, 'email'> name="email">
                    {({ value, setValue, meta }) => (
                        <div>
                            <span data-testid="value">{value}</span>
                            <span data-testid="error">{meta.errors[0]?.message ?? ''}</span>
                            <button
                                data-testid="set"
                                onClick={() => setValue('me@example.com')}
                            >
                                set
                            </button>
                        </div>
                    )}
                </Field>
            </ModelProvider>
        );

        expect(getByTestId('value').textContent).toBe('');

        await act(async () => {
            await model.setField('email', 'me@example.com');
        });
        expect(getByTestId('value').textContent).toBe('me@example.com');

        model.dispose();
    });

    it('accepts an explicit model prop instead of a provider', () => {
        const model = makeFormModel();

        const { getByTestId } = render(
            <Field<FormData, 'email'> name="email" model={model}>
                {({ value }) => <span data-testid="v">{value}</span>}
            </Field>
        );
        expect(getByTestId('v').textContent).toBe('');
        model.dispose();
    });

    it('throws when neither a model prop nor a provider is available', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(() =>
            render(
                <Field name={'email' as never}>
                    {() => null}
                </Field>
            )
        ).toThrow(/requires either a `model` prop or a surrounding/);
        spy.mockRestore();
    });
});
