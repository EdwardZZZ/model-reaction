/** @jest-environment jsdom */
import * as React from 'react';
import { useState } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { createModel, ModelEvents } from '../index';
import { ValidationRules } from '../validation';
import { useDraftField, useModelFields } from '../react';
import type { ModelReturn } from '../types';

// ---------------------------------------------------------------------------
// useDraftField — controlled-input binding with a local draft
// ---------------------------------------------------------------------------

describe('useDraftField', () => {
    it.each(['price', 0] as const)(
        'preserves reentrant numeric edits for field %s',
        async (field) => {
            const model = createModel({
                price: { type: 'number', default: 0, transform: Number },
                0: { type: 'number', default: 0, transform: Number },
            });
            const { result, unmount } = renderHook(
                () => useDraftField(model, field),
                { wrapper: React.StrictMode }
            );
            const unsubscribe = model.on(ModelEvents.FIELD_CHANGE, (event) => {
                if (event.field === String(field) && event.value === 2) {
                    result.current.setDraft('3.50');
                }
            });
            try {
                await act(async () => {
                    result.current.setDraft('2.');
                    await model.settled();
                });
                expect(model.getField(field)).toBe(3.5);
                expect(result.current.committed).toBe(3.5);
                expect(result.current.draft).toBe('3.50');
                expect(result.current.meta.validating).toBe(false);
                await act(async () => { await model.setField(field, 42); });
                expect(result.current.draft).toBe('42');
            } finally {
                unsubscribe();
                unmount();
                model.dispose();
            }
        }
    );

    interface Signup {
        username: string;
        priceCents: number;
    }

    const makeSignup = () =>
        createModel<Signup>({
            username: {
                type: 'string',
                default: 'ada',
                validator: [ValidationRules.minLength(3).withMessage('too short')],
            },
            priceCents: {
                type: 'number',
                default: 350,
                transform: (v) => Number(v),
                validator: [ValidationRules.min(0)],
            },
        });

    it.each([new Error('cannot transform'), 'cannot transform', null])(
        'keeps rejected text and exposes a local writeError for %p',
        async (failure) => {
            const model = createModel({
                name: {
                    type: 'string', default: 'Ada',
                    transform: (value) => {
                        if (value === 'bad') throw failure;
                        return value;
                    },
                },
            });
            const { result, unmount } = renderHook(() => useDraftField(model, 'name'));
            await act(async () => { result.current.setDraft('bad'); });
            expect(result.current.draft).toBe('bad');
            expect(result.current.writeError?.message).toBe(String(failure instanceof Error ? failure.message : failure));
            if (failure instanceof Error) expect(result.current.writeError).toBe(failure);
            expect(result.current.showError).toBe(false);
            expect(result.current.meta.validating).toBe(false);
            expect(model.getDirtyData()).toEqual({});
            expect(model.validationErrors).toEqual({});
            expect(model.getField('name')).toBe('Ada');
            act(() => { result.current.onBlur(); });
            expect(result.current.showError).toBe(true);
            act(() => { result.current.setDraft('Grace'); });
            expect(result.current.writeError).toBeNull();
            await act(async () => { await model.settled(); });
            expect(result.current.draft).toBe('Grace');
            unmount();
            model.dispose();
        }
    );

    it('ignores a rejected older edit after a newer edit succeeds', async () => {
        const model = makeSignup();
        let reject!: (error: Error) => void;
        jest.spyOn(model, 'setField').mockImplementationOnce(() =>
            new Promise<boolean>((_resolve, fail) => { reject = fail; })
        );
        const { result, unmount } = renderHook(() => useDraftField(model, 'username'));
        act(() => { result.current.setDraft('old'); });
        await act(async () => { result.current.setDraft('new'); });
        await act(async () => { reject(new Error('old failure')); });
        expect(result.current.writeError).toBeNull();
        expect(result.current.draft).toBe('new');
        expect(result.current.meta.validating).toBe(false);
        unmount();
        model.dispose();
    });

    it.each(['field', 'model', 'unmount'] as const)(
        'clears write errors and ignores old rejections on %s change',
        async (change) => {
            const model = makeSignup();
            const other = makeSignup();
            let reject!: (error: Error) => void;
            const setter = jest.spyOn(model, 'setField')
                .mockRejectedValueOnce(new Error('first failure'));
            const { result, rerender, unmount } = renderHook(
                ({ target, field }: { target: ModelReturn<Signup>; field: keyof Signup }) =>
                    useDraftField(target, field),
                { initialProps: { target: model, field: 'username' as keyof Signup }, wrapper: React.StrictMode }
            );
            await act(async () => { result.current.setDraft('failed'); });
            expect(result.current.writeError?.message).toBe('first failure');
            if (change === 'field') rerender({ target: model, field: 'priceCents' });
            if (change === 'model') rerender({ target: other, field: 'username' });
            if (change !== 'unmount') expect(result.current.writeError).toBeNull();
            rerender({ target: model, field: 'username' });
            setter.mockImplementationOnce(() =>
                new Promise<boolean>((_resolve, fail) => { reject = fail; })
            );
            act(() => { result.current.setDraft('pending'); });
            if (change === 'field') rerender({ target: model, field: 'priceCents' });
            if (change === 'model') rerender({ target: other, field: 'username' });
            if (change === 'unmount') unmount();
            await act(async () => { reject(new Error('late failure')); });
            expect(result.current.writeError).toBeNull();
            if (change !== 'unmount') unmount();
            model.dispose();
            other.dispose();
        }
    );

    it('uses the committed formatter when a suspended render overlaps pending edit cleanup', async () => {
        let release!: (valid: boolean) => void;
        const model = createModel({
            amount: {
                type: 'number', default: 0, transform: Number,
                validator: [{
                    type: 'controlled', message: 'invalid',
                    validate: (value) => value === 2
                        ? new Promise<boolean>((resolve) => { release = resolve; })
                        : true,
                }],
            },
        });
        const suspended = new Promise<void>(() => {});
        let setPrefix!: (prefix: string) => void;
        let edit!: (text: string) => void;
        let attempted = false;
        function Input({ prefix }: { prefix: string }) {
            const binding = useDraftField(model, 'amount', { format: (value) => `${prefix}:${value}` });
            if (prefix === 'abandoned') {
                attempted = true;
                throw suspended;
            }
            edit = binding.setDraft;
            return <input readOnly value={binding.draft} />;
        }
        function App() {
            const [prefix, update] = useState('committed');
            setPrefix = update;
            return <React.Suspense fallback="loading"><Input prefix={prefix} /></React.Suspense>;
        }
        const { getByRole, unmount } = render(<App />);
        act(() => { edit('2.'); });
        await act(async () => { React.startTransition(() => setPrefix('abandoned')); });
        expect(attempted).toBe(true);
        await act(async () => { await model.setField('amount', 42); });
        await act(async () => { release(true); await model.settled(); });
        expect((getByRole('textbox') as HTMLInputElement).value).toBe('committed:42');
        unmount();
        model.dispose();
    });

    it('publishes a new format before reconciling a simultaneous outside commit', async () => {
        const model = makeSignup();
        const { result, rerender, unmount } = renderHook(
            ({ prefix }) => useDraftField(model, 'username', { format: (value) => `${prefix}:${value}` }),
            { initialProps: { prefix: 'old' } }
        );
        await act(async () => {
            const write = model.setField('username', 'Grace');
            rerender({ prefix: 'new' });
            await write;
        });
        expect(result.current.draft).toBe('new:Grace');
        unmount();
        model.dispose();
    });

    it('handles errors thrown by pending-write reconciliation without losing the text', async () => {
        const model = makeSignup();
        let reject!: (error: Error) => void;
        jest.spyOn(model, 'setField').mockImplementationOnce(() =>
            new Promise<boolean>((_resolve, fail) => { reject = fail; })
        );
        const failure = new Error('cannot format');
        const { result, unmount } = renderHook(() => useDraftField(model, 'username', {
            format: (value) => {
                if (value === 'Grace') throw failure;
                return value;
            },
        }));
        act(() => { result.current.setDraft('pending'); });
        await act(async () => { await model.setField('username', 'Grace'); });
        await act(async () => { reject(new Error('write failed')); });
        expect(result.current.draft).toBe('pending');
        expect(result.current.writeError).toBe(failure);
        expect(result.current.meta.validating).toBe(false);
        unmount();
        model.dispose();
    });

    it.each(['toString', 'constructor', '__proto__'])('binds an own %s field safely', async (field) => {
        const model = createModel<Record<string, string>>(Object.fromEntries([
            [field, { type: 'string', default: 'initial', validator: [ValidationRules.minLength(3)] }],
        ]));
        const { result, unmount } = renderHook(() => ({
            input: useDraftField(model, field),
            fields: useModelFields(model, [field]),
        }));
        expect(result.current.input.draft).toBe('initial');
        expect(result.current.input.meta.errors).toEqual([]);
        expect(Object.keys(result.current.fields)).toEqual([field]);
        expect(result.current.fields[field]).toBe('initial');
        await act(async () => { result.current.input.setDraft('x'); });
        expect(result.current.input.meta.dirty).toBe(true);
        expect(result.current.input.draft).toBe('x');
        unmount();
        model.dispose();
    });

    it('seeds the draft from the committed value on mount', () => {
        const model = makeSignup();
        const { result } = renderHook(() => useDraftField(model, 'username'));
        expect(result.current.draft).toBe('ada');
        model.dispose();
    });

    it('keeps invalid keystrokes in the draft while they stay out of data', async () => {
        const model = makeSignup();
        const { result } = renderHook(() => useDraftField(model, 'username'));

        await act(async () => {
            result.current.setDraft('ab'); // fails minLength(3)
        });

        // Draft shows what was typed; committed data is untouched.
        expect(result.current.draft).toBe('ab');
        expect(model.getField('username')).toBe('ada');
        expect(model.getDirtyData().username).toBe('ab');
        model.dispose();
    });

    it('commits a valid keystroke through to the model', async () => {
        const model = makeSignup();
        const { result } = renderHook(() => useDraftField(model, 'username'));

        await act(async () => {
            result.current.setDraft('alan');
        });

        expect(result.current.draft).toBe('alan');
        expect(model.getField('username')).toBe('alan');
        expect('username' in model.getDirtyData()).toBe(false);
        model.dispose();
    });

    it.each(['2.', '002', '3.50'])(
        'preserves numeric edit text %s after its own commit and still accepts outside updates',
        async (text) => {
            const model = makeSignup();
            const { result, unmount } = renderHook(
                () => useDraftField(model, 'priceCents'),
                { wrapper: React.StrictMode }
            );
            try {
                await act(async () => {
                    result.current.setDraft(text);
                    await model.settled();
                });
                expect(result.current.draft).toBe(text);
                expect(result.current.committed).toBe(Number(text));
                await act(async () => {
                    await model.setField('priceCents', 42);
                });
                expect(result.current.draft).toBe('42');
                expect(result.current.committed).toBe(42);
            } finally {
                unmount();
                model.dispose();
            }
        }
    );

    it('keeps the latest numeric text when validations complete out of order', async () => {
        const releases: Array<(valid: boolean) => void> = [];
        const model = createModel({
            price: {
                type: 'number',
                default: 0,
                transform: Number,
                validator: [{
                    type: 'controlled',
                    message: 'invalid',
                    validate: () => new Promise<boolean>((resolve) => releases.push(resolve)),
                }],
            },
        });
        const { result, unmount } = renderHook(() => useDraftField(model, 'price'));
        act(() => { result.current.setDraft('2.'); });
        act(() => { result.current.setDraft('3.50'); });
        try {
            await act(async () => { releases[1]!(true); });
            expect(result.current.committed).toBe(3.5);
            expect(result.current.draft).toBe('3.50');
            await act(async () => {
                releases[0]!(false);
                await model.settled();
            });
            expect(result.current.committed).toBe(3.5);
            expect(result.current.draft).toBe('3.50');
            expect(result.current.meta.validating).toBe(false);
        } finally {
            unmount();
            releases.forEach((release) => release(true));
            await model.settled();
            model.dispose();
        }
    });

    it('reflects an outside commit that supersedes an in-flight draft edit', async () => {
        const releases: Array<(valid: boolean) => void> = [];
        const model = createModel({
            price: {
                type: 'number',
                default: 0,
                transform: Number,
                validator: [{
                    type: 'controlled',
                    message: 'invalid',
                    validate: () => new Promise<boolean>((resolve) => releases.push(resolve)),
                }],
            },
        });
        const { result, unmount } = renderHook(() => useDraftField(model, 'price'));
        act(() => { result.current.setDraft('2.'); });
        let outside!: Promise<boolean>;
        act(() => { outside = model.setField('price', 42); });
        try {
            await act(async () => {
                releases[1]!(true);
                await outside;
            });
            await act(async () => {
                releases[0]!(true);
                await model.settled();
            });
            expect(result.current.committed).toBe(42);
            expect(result.current.draft).toBe('42');
            expect(result.current.meta.validating).toBe(false);
        } finally {
            unmount();
            releases.forEach((release) => release(true));
            await outside;
            await model.settled();
            model.dispose();
        }
    });

    it('does not let an old in-flight edit overwrite a new field session', async () => {
        let release!: (valid: boolean) => void;
        const model = createModel({
            price: {
                type: 'number',
                default: 0,
                transform: Number,
                validator: [{
                    type: 'controlled',
                    message: 'invalid',
                    validate: () => new Promise<boolean>((resolve) => { release = resolve; }),
                }],
            },
            name: { type: 'string', default: 'Ada' },
        });
        const { result, rerender, unmount } = renderHook(
            ({ field }: { field: 'price' | 'name' }) => useDraftField(model, field),
            { initialProps: { field: 'price' as 'price' | 'name' }, wrapper: React.StrictMode }
        );
        act(() => {
            result.current.setDraft('2.');
            result.current.onBlur();
        });
        rerender({ field: 'name' });
        try {
            expect(result.current.draft).toBe('Ada');
            expect(result.current.touched).toBe(false);
            await act(async () => {
                result.current.setDraft('Grace');
                release(true);
                await model.settled();
            });
            expect(result.current.draft).toBe('Grace');
            expect(result.current.committed).toBe('Grace');
            expect(result.current.meta.validating).toBe(false);
            expect(model.getField('price')).toBe(2);
        } finally {
            unmount();
            release(true);
            await model.settled();
            model.dispose();
        }
    });

    it('seeds from a pending dirtyData value when the model outlives the input', async () => {
        const model = makeSignup();
        // Stash a failed input, then mount a fresh hook (simulating remount).
        await act(async () => {
            await model.setField('username', 'xy'); // fails, lands in dirtyData
        });

        const { result } = renderHook(() => useDraftField(model, 'username'));
        expect(result.current.draft).toBe('xy'); // restored, not 'ada'
        model.dispose();
    });

    it('renders an unparseable NaN as blank rather than the text "NaN"', async () => {
        const model = makeSignup();
        // "12a" → transform Number → NaN, stashed in dirtyData.
        await act(async () => {
            await model.setField('priceCents', '12a' as unknown as number);
        });
        expect(Number.isNaN(model.getDirtyData().priceCents as number)).toBe(true);

        const { result } = renderHook(() => useDraftField(model, 'priceCents'));
        expect(result.current.draft).toBe('');
        model.dispose();
    });

    it('honours a custom format on reseed', () => {
        const model = makeSignup();
        const { result } = renderHook(() =>
            useDraftField(model, 'priceCents', {
                format: (c) => (c / 100).toFixed(2),
            })
        );
        expect(result.current.draft).toBe('3.50');
        model.dispose();
    });

    it('gates showError on touched', async () => {
        const model = makeSignup();
        const { result } = renderHook(() => useDraftField(model, 'username'));

        await act(async () => {
            result.current.setDraft('ab'); // invalid
        });
        // Error exists but is not shown until blurred.
        expect(result.current.meta.errors[0]?.message).toBe('too short');
        expect(result.current.showError).toBe(false);

        await act(async () => {
            result.current.onBlur();
        });
        expect(result.current.showError).toBe(true);
        model.dispose();
    });

    it('starts a fresh draft session when the model changes', async () => {
        const first = makeSignup();
        const second = makeSignup();
        await second.setField('username', 'bo');

        const { result, rerender } = renderHook(
            ({ model }) => useDraftField(model, 'username'),
            { initialProps: { model: first } }
        );

        await act(async () => {
            result.current.setDraft('xy');
            result.current.onBlur();
        });
        expect(result.current.draft).toBe('xy');
        expect(result.current.touched).toBe(true);

        rerender({ model: second });
        expect(result.current.draft).toBe('bo');
        expect(result.current.touched).toBe(false);
        expect(result.current.meta.dirty).toBe(true);

        first.dispose();
        second.dispose();
    });

    it('starts a fresh draft session when the field changes', async () => {
        const model = makeSignup();
        const { result, rerender } = renderHook(
            ({ field }: { field: keyof Signup }) => useDraftField(model, field),
            { initialProps: { field: 'username' as keyof Signup } }
        );

        await act(async () => {
            result.current.setDraft('xy');
            result.current.onBlur();
        });

        rerender({ field: 'priceCents' });
        expect(result.current.draft).toBe('350');
        expect(result.current.touched).toBe(false);
        expect(result.current.meta.dirty).toBe(false);

        model.dispose();
    });

    it.each([null, undefined])(
        'preserves an explicit dirty %s on mount and field reseed',
        async (value) => {
            const model = createModel<{
                name: string | null | undefined;
                other: string;
            }>({
                name: {
                    type: 'string',
                    default: 'committed',
                    validator: [ValidationRules.required],
                },
                other: { type: 'string', default: 'other' },
            });
            await model.setField('name', value);
            const { result, rerender, unmount } = renderHook(
                ({ field }: { field: 'name' | 'other' }) => useDraftField(model, field),
                { initialProps: { field: 'name' as 'name' | 'other' }, wrapper: React.StrictMode }
            );
            try {
                expect(model.getDirtyData()).toHaveProperty('name', value);
                expect(result.current.committed).toBe('committed');
                expect(result.current.draft).toBe('');
                rerender({ field: 'other' });
                expect(result.current.draft).toBe('other');
                rerender({ field: 'name' });
                expect(result.current.draft).toBe('');
            } finally {
                unmount();
                model.dispose();
            }
        }
    );

    it('keeps edits through format changes and uses the latest format for outside commits', async () => {
        const model = makeSignup();
        const { result, rerender, unmount } = renderHook(
            ({ prefix }) => useDraftField(model, 'username', {
                format: (value) => `${prefix}:${value}`,
            }),
            { initialProps: { prefix: 'first' }, wrapper: React.StrictMode }
        );
        try {
            expect(result.current.draft).toBe('first:ada');
            await act(async () => {
                result.current.setDraft('ab');
                result.current.onBlur();
            });
            rerender({ prefix: 'second' });
            expect(result.current.draft).toBe('ab');
            await act(async () => {
                await model.setField('username', 'ada');
            });
            expect(result.current.draft).toBe('ab');
            await act(async () => {
                await model.setField('username', 'grace');
            });
            expect(result.current.draft).toBe('second:grace');
            expect(result.current.committed).toBe('grace');
            expect(result.current.touched).toBe(true);
        } finally {
            unmount();
            model.dispose();
        }
    });
});
