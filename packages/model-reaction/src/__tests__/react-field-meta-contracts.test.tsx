/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { createModel } from '../index';
import { shallow, useModelFieldState } from '../react';

function makeModel() {
    return createModel({
        name: { type: 'string', default: 'Home' },
        locked: { type: 'boolean', default: false },
    });
}

type Data = ReturnType<typeof makeModel>['data'];

describe('field metadata contracts', () => {
    it('isolates independently typed inline bindings and clears local overrides on remount', () => {
        const model = makeModel();
        const text = renderHook(() => useModelFieldState(model, 'name', {
            meta: () => ({ description: 'Text' }),
        }));
        const number = renderHook(() => useModelFieldState(model, 'name', {
            meta: () => ({ description: 0 }),
        }));
        try {
            act(() => { number.result.current[3]({ description: 123 }); });
            expect(number.result.current[2].description.toFixed(0)).toBe('123');
            expect(text.result.current[2].description.toUpperCase()).toBe('TEXT');
            const oldSetter = text.result.current[3];
            act(() => { oldSetter({ description: 'Local' }); });
            expect(text.result.current[2].description).toBe('Local');
            text.unmount();
            act(() => { oldSetter({ description: 'Detached' }); });
            const remount = renderHook(() => useModelFieldState(model, 'name', {
                meta: () => ({ description: 'Text' }),
            }));
            expect(remount.result.current[2].description).toBe('Text');
            remount.unmount();
        } finally {
            text.unmount();
            number.unmount();
            model.dispose();
        }
    });

    it('replaces nested discriminated unions without retaining the previous branch', () => {
        type Status = { kind: 'text'; text: string } | { kind: 'count'; count: number };
        const model = makeModel();
        const { result, unmount } = renderHook(() =>
            useModelFieldState(model, 'name', {
                meta: (): { status: Status } => ({ status: { kind: 'text', text: 'Home' } }),
            })
        );
        try {
            act(() => { result.current[3]({ status: { kind: 'count', count: 2 } }); });
            const { status } = result.current[2];
            expect(status).toEqual({ kind: 'count', count: 2 });
            expect(status.kind === 'count' && status.count.toFixed(2)).toBe('2.00');
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('applies symbol patches without redundant renders', () => {
        const key = Symbol('disabled');
        const model = makeModel();
        let renders = 0;
        const { result, unmount } = renderHook(() => {
            renders++;
            return useModelFieldState(model, 'name', { meta: () => ({ [key]: false }) });
        });
        try {
            act(() => { result.current[3]({ [key]: true }); });
            expect(result.current[2][key]).toBe(true);
            const before = renders;
            act(() => { result.current[3]({ [key]: true }); });
            expect(renders).toBe(before);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('refreshes symbol-only selector changes', async () => {
        const key = Symbol('disabled');
        const model = makeModel();
        const selector = (data: Data) => ({ [key]: data.locked });
        const { result, unmount } = renderHook(() => useModelFieldState(model, 'name', { meta: selector }));
        try {
            await act(async () => { await model.setField('locked', true); });
            expect(result.current[2][key]).toBe(true);
            await act(async () => { await model.setField('locked', false); });
            expect(result.current[2][key]).toBe(false);
        } finally {
            unmount();
            model.dispose();
        }
    });

    it('compares enumerable symbol keys using the same policy as object spread', () => {
        const key = Symbol('value');
        const other = Symbol('value');
        expect(shallow({ [key]: true }, { [key]: true })).toBe(true);
        expect(shallow({ [key]: true }, { [key]: false })).toBe(false);
        expect(shallow({ [key]: true }, { [other]: true })).toBe(false);
        expect(shallow({ [key]: true }, {})).toBe(false);
        const hidden = Object.defineProperty({}, key, { value: true, enumerable: false });
        expect(shallow(hidden, {})).toBe(true);
        expect(shallow({ [key]: true }, hidden)).toBe(false);
    });
});
