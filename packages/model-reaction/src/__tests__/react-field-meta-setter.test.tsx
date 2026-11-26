/** @jest-environment jsdom */
import * as React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { createModel } from '../index';
import { ValidationRules } from '../validation';
import {
    Field,
    useDraftField,
    useModelFieldState,
    type FieldMetaSetter,
} from '../react';

function makeModel() {
    return createModel({
        address: { type: 'string', default: 'Home', validator: [ValidationRules.required] },
        note: { type: 'string', default: 'Other' },
        readonly: { type: 'boolean', default: false },
    });
}

const selectMeta = (data: ReturnType<typeof makeModel>['data']) => ({
    disabled: data.readonly,
    description: data.note,
});

describe('field metadata setters', () => {
    it('merges patches without writes, validation, or redundant renders', () => {
        const model = makeModel();
        const data = model.data;
        const write = jest.spyOn(model, 'setField');
        let renders = 0;
        const { result, unmount } = renderHook(() => {
            renders++;
            return useModelFieldState(model, 'address', { meta: selectMeta });
        });
        try {
            const setMeta = result.current[3];
            act(() => { setMeta({ disabled: true }); });
            act(() => { setMeta({ description: 'Locked' }); });
            expect(result.current[2]).toMatchObject({ disabled: true, description: 'Locked' });
            expect(result.current[3]).toBe(setMeta);
            const before = renders;
            act(() => { setMeta({ description: 'Locked' }); setMeta({}); });
            expect(renders).toBe(before);
            expect(model.data).toBe(data);
            expect(model.getDirtyData()).toEqual({});
            expect(write).not.toHaveBeenCalled();
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('preserves nested selector values when only patches or validation metadata change', async () => {
        const model = makeModel();
        const selector = jest.fn((data: typeof model.data) => ({
            hint: { label: data.note },
            disabled: false,
        }));
        const { result, unmount } = renderHook(() =>
            useModelFieldState(model, 'address', { meta: selector })
        );
        try {
            const hint = result.current[2].hint;
            act(() => { result.current[3]({ disabled: true }); });
            expect(result.current[2].hint).toBe(hint);
            await act(async () => { await model.setField('address', ''); });
            expect(result.current[2].errors).toHaveLength(1);
            expect(result.current[2].dirty).toBe(true);
            act(() => { model.clearDirtyData(); });
            expect(result.current[2].dirty).toBe(false);
            expect(result.current[2].hint).toBe(hint);
            expect(selector).toHaveBeenCalledTimes(1);
            await act(async () => { await model.setField('note', 'Changed'); });
            expect(result.current[2].hint).toEqual({ label: 'Changed' });
            expect(result.current[2].disabled).toBe(true);
            expect(selector).toHaveBeenCalledTimes(2);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('keeps explicit overrides while refreshing unpatched selector properties and props', async () => {
        const model = makeModel();
        const { result, rerender, unmount } = renderHook(
            ({ label }) => useModelFieldState(model, 'address', {
                meta: (data) => ({ ...selectMeta(data), description: `${label}: ${data.note}` }),
            }),
            { initialProps: { label: 'First' } }
        );
        try {
            const setMeta = result.current[3];
            act(() => { setMeta({ disabled: true }); });
            await act(async () => { await model.setField('note', 'Changed'); });
            expect(result.current[2]).toMatchObject({ disabled: true, description: 'First: Changed' });
            rerender({ label: 'Second' });
            expect(result.current[2]).toMatchObject({ disabled: true, description: 'Second: Changed' });
            expect(result.current[3]).toBe(setMeta);
            await act(async () => { await model.setField('readonly', true); });
            await act(async () => { await model.setField('readonly', false); });
            expect(result.current[2].disabled).toBe(true);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('keeps patches local even when bindings reuse the same selector', () => {
        const model = makeModel();
        const { result, unmount } = renderHook(() => ({
            first: useModelFieldState(model, 'address', { meta: selectMeta }),
            second: useModelFieldState(model, 'address', { meta: selectMeta }),
        }));
        try {
            act(() => { result.current.first[3]({ description: 'First binding' }); });
            expect(result.current.first[2].description).toBe('First binding');
            expect(result.current.second[2].description).toBe('Other');
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('resets overrides and detaches old setters when switching models or fields', () => {
        const first = makeModel();
        const second = makeModel();
        let renders = 0;
        const { result, rerender, unmount } = renderHook(
            ({ model, field }: { model: typeof first; field: 'address' | 'note' }) => {
                renders++;
                return useModelFieldState(model, field, { meta: selectMeta });
            },
            { initialProps: { model: first, field: 'address' as 'address' | 'note' } }
        );
        try {
            const firstSetter = result.current[3];
            act(() => { firstSetter({ disabled: true }); });
            rerender({ model: first, field: 'note' });
            expect(result.current[2].disabled).toBe(false);
            expect(result.current[3]).not.toBe(firstSetter);
            const before = renders;
            act(() => { firstSetter({ description: 'Old address' }); });
            expect(renders).toBe(before);
            rerender({ model: first, field: 'address' });
            expect(result.current[2]).toMatchObject({ disabled: false, description: 'Other' });
            act(() => { result.current[3]({ description: 'First model' }); });
            rerender({ model: second, field: 'address' });
            expect(result.current[2].description).toBe('Other');
            rerender({ model: first, field: 'address' });
            expect(result.current[2].description).toBe('Other');
        } finally {
            unmount();
            first.dispose();
            second.dispose();
        }
    });

    it('ignores reserved patch keys at runtime without hiding real errors', async () => {
        const model = makeModel();
        const { result, unmount } = renderHook(() =>
            useModelFieldState(model, 'address', { meta: selectMeta })
        );
        try {
            const patch = {
                errors: [], validating: true, dirty: false, disabled: true,
            } as unknown as Parameters<typeof result.current[3]>[0];
            act(() => { result.current[3](patch); });
            expect(result.current[2]).toMatchObject({ errors: [], validating: false, dirty: false });
            await act(async () => { await model.setField('address', ''); });
            act(() => { result.current[3](patch); });
            expect(result.current[2]).toMatchObject({ disabled: true, dirty: true, validating: false });
            expect(result.current[2].errors).toHaveLength(1);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('supports extension-only fields and special own property names', () => {
        const model = createModel<{ __proto__: string; constructor: string }>({
            ['__proto__']: { type: 'string', default: 'Home' },
            constructor: { type: 'string', default: 'Other' },
        });
        const { result, unmount } = renderHook(() =>
            useModelFieldState<typeof model.data, '__proto__', { __proto__?: string; constructor?: string }>(
                model, '__proto__'
            )
        );
        try {
            act(() => { result.current[3]({ ['__proto__']: 'Own', constructor: 'Safe' }); });
            expect(Object.hasOwn(result.current[2], '__proto__')).toBe(true);
            expect(result.current[2].__proto__).toBe('Own');
            expect(result.current[2].constructor).toBe('Safe');
            expect(result.current[0]).toBe('Home');
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('passes setters through draft and Field without resetting a rejected draft', async () => {
        const model = makeModel();
        const draft = renderHook(() => useDraftField(model, 'address', { meta: selectMeta }));
        const field = render(
            <Field model={model} name="address" meta={selectMeta}>
                {({ meta, setMeta }) => (
                    <button onClick={() => setMeta({ disabled: !meta.disabled })}>
                        {String(meta.disabled)}
                    </button>
                )}
            </Field>
        );
        try {
            await act(async () => {
                draft.result.current.setDraft('');
                await model.settled();
            });
            fireEvent.click(field.getByRole('button'));
            expect(field.getByRole('button').textContent).toBe('true');
            expect(draft.result.current.meta.disabled).toBe(false);
            fireEvent.click(field.getByRole('button'));
            act(() => { draft.result.current.setMeta({ disabled: true }); });
            expect(field.getByRole('button').textContent).toBe('false');
            expect(draft.result.current.meta.disabled).toBe(true);
            expect(draft.result.current.meta.dirty).toBe(true);
            expect(draft.result.current.draft).toBe('');
        } finally {
            field.unmount();
            draft.unmount();
            model.dispose();
        }
    });

    it('preserves committed selectors when local metadata updates during suspended rendering', () => {
        const model = makeModel();
        const suspended = new Promise<void>(() => {});
        const attempts = jest.fn();
        let changeId!: (id: 'a' | 'b') => void;
        let setMeta!: FieldMetaSetter<{ label: string; disabled: boolean }>;
        function Row({ id }: { id: 'a' | 'b' }) {
            const [, , meta, updateMeta] = useModelFieldState(model, 'address', {
                meta: (data) => ({ label: id === 'a' ? data.address : data.note, disabled: false }),
            });
            React.useEffect(() => { setMeta = updateMeta; }, [updateMeta]);
            attempts(id);
            if (id === 'b') throw suspended;
            return <span>{meta.label}: {String(meta.disabled)}</span>;
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
            act(() => { setMeta({ disabled: true }); });
            expect(getByText('Home: true')).toBeTruthy();
            act(() => { changeId('a'); });
            expect(getByText('Home: true')).toBeTruthy();
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('checks patch types and supports passing the setter to ordinary business functions', () => {
        function disable(setMeta: FieldMetaSetter<{ disabled: boolean; description: string }>) {
            setMeta({ disabled: true });
        }
        const receivePatch = jest.fn();
        disable(receivePatch);
        expect(receivePatch).toHaveBeenCalledWith({ disabled: true });
        const invalidDeclarations = (setMeta: FieldMetaSetter<{ disabled: boolean }>) => {
            // @ts-expect-error extension property types remain checked
            setMeta({ disabled: 'yes' });
            // @ts-expect-error unknown extension properties remain checked
            setMeta({ missing: true });
            // @ts-expect-error errors are read-only base metadata
            setMeta({ errors: [] });
            // @ts-expect-error async state is read-only base metadata
            setMeta({ validating: true });
            // @ts-expect-error dirty is read-only base metadata
            setMeta({ dirty: true });
            // @ts-expect-error setters accept object patches, not updater functions
            setMeta(() => ({ disabled: true }));
        };
        void invalidDeclarations;
    });
});
