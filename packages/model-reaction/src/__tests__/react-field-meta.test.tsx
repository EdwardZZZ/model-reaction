/** @jest-environment jsdom */
import * as React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { createModel } from '../index';
import { ValidationRules } from '../validation';
import {
    Field,
    ModelProvider,
    useDraftField,
    useModelFieldState,
    type FieldMeta,
    type UseModelFieldStateOptions,
} from '../react';

function makeAddressModel() {
    return createModel({
        address: {
            type: 'string',
            default: 'Home',
            validator: [ValidationRules.required],
        },
        deliveryRequired: { type: 'boolean', default: true },
        readonly: { type: 'boolean', default: false },
        note: { type: 'string', default: 'Other' },
    });
}

type AddressData = ReturnType<typeof makeAddressModel>['data'];
type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_value?: T): void {}

describe('optional field metadata', () => {
    it('always provides base metadata without rendering for unrelated changes', async () => {
        const model = makeAddressModel();
        let renders = 0;
        const { result, unmount } = renderHook(() => {
            renders++;
            return useModelFieldState(model, 'address');
        });
        try {
            expect(result.current[2]).toEqual({
                errors: [], validating: false, dirty: false,
            });
            const before = renders;
            await act(async () => { await model.setField('note', 'Changed'); });
            expect(renders).toBe(before);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('infers custom properties and updates only when the selected metadata changes', async () => {
        const model = makeAddressModel();
        let renders = 0;
        const { result, unmount } = renderHook(() => {
            renders++;
            const state = useModelFieldState(model, 'address', {
                meta: (data) => ({ show: data.deliveryRequired, disabled: data.readonly }),
            });
            expectType<Equal<typeof state[2], FieldMeta & { show: boolean; disabled: boolean }>>();
            return state;
        });
        try {
            expect(result.current[2]).toMatchObject({ show: true, disabled: false });
            const initialRenders = renders;
            await act(async () => { await model.setField('note', 'Changed'); });
            expect(renders).toBe(initialRenders);
            await act(async () => { await model.setField('deliveryRequired', false); });
            expect(result.current[0]).toBe('Home');
            expect(result.current[2].show).toBe(false);
            expect(renders).toBe(initialRenders + 1);
            await act(async () => { await model.setField('readonly', true); });
            expect(result.current[2].disabled).toBe(true);
            await act(async () => { await result.current[1]('Office'); });
            expect(result.current[0]).toBe('Office');
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('uses committed data while still refreshing errors and dirty state', async () => {
        const model = makeAddressModel();
        const { result, unmount } = renderHook(() =>
            useModelFieldState(model, 'address', {
                meta: (data) => ({ placeholder: data.address }),
            })
        );
        try {
            await act(async () => { await model.setField('address', ''); });
            expect(result.current[2]).toMatchObject({
                placeholder: 'Home', dirty: true,
            });
            expect(result.current[2].errors[0]?.message).toEqual(expect.any(String));
            await act(async () => { await model.setField('address', 'Office'); });
            expect(result.current[2]).toMatchObject({
                placeholder: 'Office', dirty: false,
            });
            expect(result.current[2].errors).toEqual([]);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('reads the field value and derived metadata from the same committed data', async () => {
        const model = makeAddressModel();
        const observed: Array<{ value: string; label: string }> = [];
        const { result, unmount } = renderHook(() => {
            const [value, , meta] = useModelFieldState(model, 'address', {
                meta: (data) => ({ label: data.address }),
            });
            observed.push({ value, label: meta.label });
            return { value, label: meta.label };
        });
        try {
            await act(async () => { await model.setField('address', 'Office'); });
            expect(result.current).toEqual({ value: 'Office', label: 'Office' });
            expect(observed.every(({ value, label }) => value === label)).toBe(true);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('uses current props without rebuilding subscriptions and can remove the selector', async () => {
        const model = makeAddressModel();
        const on = jest.spyOn(model, 'on');
        const { result, rerender, unmount } = renderHook(
            ({ label, enabled }) => useModelFieldState(model, 'address', enabled ? {
                meta: (data) => ({ placeholder: `${label}: ${data.note}` }),
            } : {}),
            { initialProps: { label: 'First', enabled: true } }
        );
        try {
            const subscriptions = on.mock.calls.length;
            rerender({ label: 'Second', enabled: true });
            expect(result.current[2].placeholder).toBe('Second: Other');
            expect(on).toHaveBeenCalledTimes(subscriptions);
            await act(async () => { await model.setField('note', 'Changed'); });
            expect(result.current[2].placeholder).toBe('Second: Changed');
            rerender({ label: 'Second', enabled: false });
            expect(result.current[2]).not.toHaveProperty('placeholder');
            expect(on).toHaveBeenCalledTimes(subscriptions);
            await act(async () => { await model.setField('note', 'Again'); });
            expect(result.current[2]).not.toHaveProperty('placeholder');
            rerender({ label: 'Third', enabled: true });
            expect(result.current[2].placeholder).toBe('Third: Again');
            expect(on).toHaveBeenCalledTimes(subscriptions);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('switches models and releases the previous metadata subscription', async () => {
        const first = makeAddressModel();
        const second = makeAddressModel();
        await second.setField('readonly', true);
        let renders = 0;
        const { result, rerender, unmount } = renderHook(
            ({ model }) => {
                renders++;
                return useModelFieldState(model, 'address', {
                    meta: (data) => ({ disabled: data.readonly }),
                });
            },
            { initialProps: { model: first } }
        );
        try {
            rerender({ model: second });
            expect(result.current[2].disabled).toBe(true);
            const before = renders;
            await act(async () => { await first.setField('readonly', true); });
            expect(renders).toBe(before);
            await act(async () => { await second.setField('readonly', false); });
            expect(result.current[2].disabled).toBe(false);
        } finally {
            unmount();
            first.dispose();
            second.dispose();
        }
    });

    it('protects base metadata at runtime when untyped callers return reserved keys', async () => {
        const model = makeAddressModel();
        const selector = (() => ({
            show: true, errors: [], dirty: false, validating: true,
        })) as unknown as NonNullable<UseModelFieldStateOptions<AddressData, { show: boolean }>['meta']>;
        const { result, unmount } = renderHook(() =>
            useModelFieldState(model, 'address', { meta: selector })
        );
        try {
            expect(result.current[2]).toMatchObject({ errors: [], validating: false });
            await act(async () => { await model.setField('address', ''); });
            expect(result.current[2].errors).toHaveLength(1);
            expect(result.current[2].dirty).toBe(true);
            expect(result.current[2].show).toBe(true);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('preserves the committed selector when a new render suspends', async () => {
        const model = makeAddressModel();
        const suspended = new Promise<void>(() => {});
        const attempts = jest.fn();
        let changeId!: (id: 'a' | 'b') => void;
        function Row({ id }: { id: 'a' | 'b' }) {
            const [, , meta] = useModelFieldState(model, 'deliveryRequired', {
                meta: (data) => ({ label: id === 'a' ? data.address : data.note }),
            });
            attempts(id);
            if (id === 'b') throw suspended;
            return <span>{meta.label}</span>;
        }
        function App() {
            const [id, setId] = React.useState<'a' | 'b'>('a');
            changeId = setId;
            return <React.Suspense fallback="Loading"><Row id={id} /></React.Suspense>;
        }
        const { getByText, unmount } = render(<App />);
        try {
            act(() => { React.startTransition(() => changeId('b')); });
            expect(attempts).toHaveBeenCalledWith('b');
            expect(getByText('Home')).toBeTruthy();
            await act(async () => { await model.setField('address', 'Office'); });
            expect(getByText('Office')).toBeTruthy();
            act(() => changeId('a'));
            expect(getByText('Office')).toBeTruthy();
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('forwards metadata through draft bindings without resetting local input', async () => {
        const model = makeAddressModel();
        const { result, unmount } = renderHook(() => useDraftField(model, 'address', {
            format: (value) => value.toUpperCase(),
            meta: (data) => ({ disabled: data.readonly }),
        }));
        try {
            expectType<Equal<typeof result.current.meta.disabled, boolean>>();
            expect(result.current.draft).toBe('HOME');
            await act(async () => {
                result.current.setDraft('');
                await model.settled();
            });
            expect(result.current.draft).toBe('');
            await act(async () => { await model.setField('readonly', true); });
            expect(result.current.meta.disabled).toBe(true);
            expect(result.current.draft).toBe('');
            expect(result.current.meta.dirty).toBe(true);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('gates draft errors by their presence even when the first message is empty', async () => {
        const model = createModel({
            name: {
                type: 'string',
                default: 'Ada',
                validator: [{
                    type: 'required',
                    message: '',
                    validate: (value) => value.length > 0,
                }],
            },
        });
        const { result, unmount } = renderHook(() => useDraftField(model, 'name'));
        try {
            await act(async () => { await model.setField('name', ''); });
            expect(result.current.meta.errors[0]?.message).toBe('');
            expect(result.current.showError).toBe(false);
            act(() => result.current.onBlur());
            expect(result.current.showError).toBe(true);
            await act(async () => { await model.setField('name', 'Grace'); });
            expect(result.current.meta.errors).toEqual([]);
            expect(result.current.showError).toBe(false);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('forwards inferred metadata through Field with an explicit model or a provider', async () => {
        const model = makeAddressModel();
        const { getByTestId, unmount } = render(
            <ModelProvider model={model}>
                <Field model={model} name="address" meta={(data) => ({ show: data.deliveryRequired })}>
                    {({ meta, value }) => {
                        expectType<Equal<typeof meta.show, boolean>>();
                        expectType<Equal<typeof value, string>>();
                        return <span data-testid="explicit" title={value}>{String(meta.show)}</span>;
                    }}
                </Field>
                <Field<AddressData, 'address', { disabled: boolean }>
                    name="address"
                    meta={(data) => ({ disabled: data.readonly })}
                >
                    {({ meta }) => <span data-testid="provider">{String(meta.disabled)}</span>}
                </Field>
            </ModelProvider>
        );
        try {
            expect(getByTestId('explicit').textContent).toBe('true');
            expect(getByTestId('provider').textContent).toBe('false');
            await act(async () => {
                await model.setFields({ deliveryRequired: false, readonly: true });
            });
            expect(getByTestId('explicit').textContent).toBe('false');
            expect(getByTestId('provider').textContent).toBe('true');
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('rejects reserved keys and preserves model types in reusable options', () => {
        const invalidDeclarations = (model: ReturnType<typeof makeAddressModel>) => {
            // @ts-expect-error built-in validation metadata cannot be overridden
            useModelFieldState(model, 'address', { meta: () => ({ errors: [] }) });
            // @ts-expect-error default metadata has no first-error alias
            void useModelFieldState(model, 'address')[2].error;
            // @ts-expect-error built-in dirty metadata cannot be overridden
            useDraftField(model, 'address', { meta: () => ({ dirty: true }) });
            // @ts-expect-error selectors must return objects
            useModelFieldState(model, 'address', { meta: () => true });
            // @ts-expect-error selectors must return metadata synchronously
            useModelFieldState(model, 'address', { meta: async () => ({ show: true }) });
            // @ts-expect-error model keys remain checked
            useModelFieldState(model, 'address', { meta: (data) => ({ show: data.missing }) });
            // @ts-expect-error fields cannot override built-in async state
            Field({ model, name: 'address', meta: () => ({ validating: false }), children: () => null });
        };
        void invalidDeclarations;
        interface UiMeta { show: boolean }
        const options = {
            meta: (data) => ({ show: data.deliveryRequired }),
        } satisfies UseModelFieldStateOptions<AddressData, UiMeta>;
        expect(options.meta?.({
            address: 'Home', deliveryRequired: true, readonly: false, note: 'Other',
        })).toEqual({ show: true });
    });
});
