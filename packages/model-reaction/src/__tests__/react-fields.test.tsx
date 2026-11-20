/** @jest-environment jsdom */
import * as React from 'react';
import { useState } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { createModel } from '../index';
import { ValidationRules } from '../validation';
import { useModelField, useModelFields, useModelFieldState } from '../react';
import { makeCart, makeOrderModel } from './react-test-helpers';

// ---------------------------------------------------------------------------
// useModelField — single-field subscription
// ---------------------------------------------------------------------------

describe('useModelField', () => {
    it('receives numeric field commits through string event names', async () => {
        const model = createModel({ 0: { type: 'string', default: 'before' } });
        const { result, unmount } = renderHook(() => useModelField(model, 0));
        const picked = renderHook(() => useModelFields(model, [0]));
        await act(async () => { await model.setField(0, 'after'); });
        expect(result.current).toBe('after');
        expect(picked.result.current[0]).toBe('after');
        unmount();
        picked.unmount();
        model.dispose();
    });

    it('returns the current value and re-renders only when that field changes', async () => {
        const cart = makeCart();
        let renderCount = 0;
        let lastQty = 0;

        function Qty() {
            renderCount++;
            lastQty = useModelField(cart, 'qty');
            return <span>{lastQty}</span>;
        }

        render(<Qty />);
        const initial = renderCount;
        expect(lastQty).toBe(1);

        // Unrelated field → no re-render.
        await act(async () => {
            await cart.setField('coupon', 'SAVE10');
        });
        expect(renderCount).toBe(initial);
        expect(lastQty).toBe(1);

        // The subscribed field → exactly one re-render.
        await act(async () => {
            await cart.setField('qty', 7);
        });
        expect(lastQty).toBe(7);
        expect(renderCount).toBe(initial + 1);

        cart.dispose();
    });

    it('does not re-render when a failed set leaves the value unchanged', async () => {
        const model = makeOrderModel();
        let renderCount = 0;

        function Note() {
            renderCount++;
            const note = useModelField(model, 'note');
            return <span>{note}</span>;
        }

        render(<Note />);
        const initial = renderCount;

        // `note` only accepts strings; a number fails validation and is
        // diverted to dirtyData, so the committed value never changes.
        await act(async () => {
            await model.setField('note', 123 as unknown as string);
        });
        expect(renderCount).toBe(initial);

        model.dispose();
    });
});


// ---------------------------------------------------------------------------
// useModelFields — multi-field subscription
// ---------------------------------------------------------------------------

describe('useModelFields', () => {
    it('returns the picked fields and re-renders only on shallow change', async () => {
        const cart = makeCart();
        let renderCount = 0;
        let last: { qty: number; price: number } = { qty: 0, price: 0 };

        function Picked() {
            renderCount++;
            last = useModelFields(cart, ['qty', 'price']);
            return <span>{last.qty * last.price}</span>;
        }

        render(<Picked />);
        const initial = renderCount;
        expect(last).toEqual({ qty: 1, price: 100 });

        // A field outside the picked set → no re-render.
        await act(async () => {
            await cart.setField('coupon', 'SAVE10');
        });
        expect(renderCount).toBe(initial);

        // A picked field changes → one re-render.
        await act(async () => {
            await cart.setField('price', 250);
        });
        expect(last).toEqual({ qty: 1, price: 250 });
        expect(renderCount).toBe(initial + 1);

        cart.dispose();
    });

    it('rebuilds the snapshot when the list of fields changes', async () => {
        const cart = makeCart();
        let setFieldsList: (f: Array<'qty' | 'price' | 'coupon'>) => void =
            () => undefined;
        let last: Record<string, unknown> = {};

        function Picked() {
            const [fields, setFields] = useState<
                Array<'qty' | 'price' | 'coupon'>
            >(['qty']);
            setFieldsList = setFields;
            last = useModelFields(cart, fields);
            return <span>{Object.keys(last).join(',')}</span>;
        }

        render(<Picked />);
        expect(last).toEqual({ qty: 1 });

        // Change the requested field list → snapshot rebuilds to the new shape.
        await act(async () => {
            setFieldsList(['qty', 'coupon']);
        });
        expect(last).toEqual({ qty: 1, coupon: '' });

        cart.dispose();
    });
});


// ---------------------------------------------------------------------------
// useModelFieldState — value + setter + meta
// ---------------------------------------------------------------------------

describe('useModelFieldState', () => {
    it('tracks numeric field errors, dirty clearing and outside recovery', async () => {
        const model = createModel({
            0: { type: 'string', default: 'before', validator: [ValidationRules.required] },
        });
        const { result, unmount } = renderHook(() => useModelFieldState(model, 0));
        await act(async () => { expect(await model.setField(0, '')).toBe(false); });
        expect(result.current[2].error).not.toBeNull();
        expect(result.current[2].dirty).toBe(true);
        act(() => model.clearDirtyData());
        expect(result.current[2].dirty).toBe(false);
        await act(async () => { await model.setField(0, 'after'); });
        expect(result.current[0]).toBe('after');
        expect(result.current[2].error).toBeNull();
        unmount();
        model.dispose();
    });

    interface Signup {
        email: string;
    }

    function makeSignupModel() {
        return createModel<Signup>({
            email: {
                type: 'string',
                default: '',
                validator: [ValidationRules.required, ValidationRules.email],
            },
        });
    }

    it('commits a valid value and exposes clean meta', async () => {
        const model = makeSignupModel();
        const { result } = renderHook(() =>
            useModelFieldState(model, 'email')
        );

        expect(result.current[0]).toBe('');
        expect(result.current[2].error).toBeNull();
        expect(result.current[2].dirty).toBe(false);

        await act(async () => {
            const ok = await result.current[1]('user@example.com');
            expect(ok).toBe(true);
        });

        expect(result.current[0]).toBe('user@example.com');
        expect(result.current[2].error).toBeNull();
        expect(result.current[2].errors).toHaveLength(0);
        expect(result.current[2].dirty).toBe(false);

        model.dispose();
    });

    it('surfaces error + dirty meta when the set fails validation', async () => {
        const model = makeSignupModel();
        const { result } = renderHook(() =>
            useModelFieldState(model, 'email')
        );

        await act(async () => {
            const ok = await result.current[1]('not-an-email');
            expect(ok).toBe(false);
        });

        // Committed value stays at the default; the failed input is dirty.
        expect(result.current[0]).toBe('');
        expect(result.current[2].error).toBe('Invalid email format');
        expect(result.current[2].errors.length).toBeGreaterThan(0);
        expect(result.current[2].dirty).toBe(true);

        // Correcting it clears both error and dirty state.
        await act(async () => {
            await result.current[1]('user@example.com');
        });
        expect(result.current[2].error).toBeNull();
        expect(result.current[2].dirty).toBe(false);

        model.dispose();
    });

    it('surfaces reaction errors for the computed field', async () => {
        interface Schema {
            source: number;
            derived: string;
        }
        const model = createModel<Schema>({
            source: { type: 'number', default: 0 },
            derived: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['source'],
                    computed: ({ source }) => {
                        if (source === 1) {
                            throw new Error('Reaction failed');
                        }
                        return String(source);
                    },
                },
            },
        });
        await model.settled();
        const { result } = renderHook(() =>
            useModelFieldState(model, 'derived')
        );

        await act(async () => {
            await model.setField('source', 1);
            await model.settled();
        });

        expect(result.current[2].error).toBe('Reaction failed');
        expect(result.current[2].errors).toEqual([
            expect.objectContaining({ rule: 'reaction_error' }),
        ]);
        model.dispose();
    });

    it('does not leak validating state across model changes', async () => {
        let releaseValidation: (() => void) | undefined;
        const first = createModel<Signup>({
            email: {
                type: 'string',
                default: '',
                validator: [
                    {
                        type: 'slow',
                        message: 'slow',
                        validate: () =>
                            new Promise<boolean>((resolve) => {
                                releaseValidation = () => resolve(true);
                            }),
                    },
                ],
            },
        });
        const second = makeSignupModel();
        const { result, rerender } = renderHook(
            ({ model }) => useModelFieldState(model, 'email'),
            { initialProps: { model: first } }
        );

        let pending!: Promise<boolean>;
        act(() => {
            pending = result.current[1]('first@example.com');
        });
        expect(result.current[2].validating).toBe(true);

        rerender({ model: second });
        expect(result.current[2].validating).toBe(false);

        await act(async () => {
            releaseValidation?.();
            await pending;
        });
        expect(result.current[2].validating).toBe(false);

        first.dispose();
        second.dispose();
    });

    describe.each(['model', 'field'] as const)('%s round trips', (identity) => {
        test.each([
            { editB: false, finishOldFirst: true },
            { editB: false, finishOldFirst: false },
            { editB: true, finishOldFirst: true },
            { editB: true, finishOldFirst: false },
        ])(
            'isolates each A-B-A session (B request: $editB, old first: $finishOldFirst)',
            async ({ editB, finishOldFirst }) => {
                const releases = new Map<string, (valid: boolean) => void>();
                const requests: Promise<boolean>[] = [];
                const fieldSchema = {
                    type: 'string' as const,
                    default: '',
                    validator: [{
                        type: 'controlled',
                        message: 'invalid',
                        validate: (value: string) => new Promise<boolean>((resolve) => {
                            releases.set(value, resolve);
                        }),
                    }],
                };
                const first = createModel({ a: fieldSchema, b: fieldSchema });
                const second = createModel({ a: fieldSchema, b: fieldSchema });
                const a = { model: first, field: 'a' as 'a' | 'b' };
                const b = identity === 'model'
                    ? { model: second, field: 'a' as const }
                    : { model: first, field: 'b' as const };
                const { result, rerender, unmount } = renderHook(
                    ({ model, field }) => useModelFieldState(model, field),
                    { initialProps: a, wrapper: React.StrictMode }
                );
                const start = (value: string): Promise<boolean> => {
                    let pending!: Promise<boolean>;
                    act(() => {
                        pending = result.current[1](value);
                        requests.push(pending);
                    });
                    return pending;
                };
                const finish = async (value: string, pending: Promise<boolean>) => {
                    await act(async () => {
                        releases.get(value)!(true);
                        await pending;
                    });
                };

                try {
                    const oldA = start('old-a');
                    expect(result.current[2].validating).toBe(true);
                    rerender(b);
                    expect(result.current[2].validating).toBe(false);
                    const middle = editB ? start('middle-b') : undefined;
                    rerender(a);
                    expect(result.current[2].validating).toBe(false);
                    const newA = start('new-a');
                    let newFinished = false;
                    void newA.then(() => { newFinished = true; });
                    expect(result.current[2].validating).toBe(true);

                    if (finishOldFirst) {
                        await finish('old-a', oldA);
                        expect(newFinished).toBe(false);
                        expect(result.current[2].validating).toBe(true);
                        if (middle) {
                            await finish('middle-b', middle);
                            expect(result.current[2].validating).toBe(true);
                        }
                        await finish('new-a', newA);
                    } else {
                        await finish('new-a', newA);
                        expect(result.current[2].validating).toBe(false);
                        await finish('old-a', oldA);
                        if (middle) await finish('middle-b', middle);
                    }
                    expect(result.current[2].validating).toBe(false);
                    expect(result.current[0]).toBe('new-a');
                } finally {
                    unmount();
                    releases.forEach((release) => release(true));
                    await Promise.all(requests);
                    first.dispose();
                    second.dispose();
                }
            }
        );
    });

    it('keeps same-session overlapping requests counted until both complete', async () => {
        const releases: Array<(valid: boolean) => void> = [];
        const model = createModel({
            email: {
                type: 'string',
                default: '',
                validator: [{
                    type: 'controlled',
                    message: 'invalid',
                    validate: () => new Promise<boolean>((resolve) => releases.push(resolve)),
                }],
            },
        });
        const { result, unmount } = renderHook(() =>
            useModelFieldState(model, 'email')
        );
        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        act(() => {
            first = result.current[1]('first');
            second = result.current[1]('second');
        });
        try {
            await act(async () => {
                releases[1]!(true);
                await second;
            });
            expect(result.current[2].validating).toBe(true);
            expect(result.current[0]).toBe('second');
            await act(async () => {
                releases[0]!(false);
                await first;
            });
            expect(result.current[2].validating).toBe(false);
            expect(result.current[0]).toBe('second');
        } finally {
            unmount();
            releases.forEach((release) => release(true));
            await Promise.all([first, second]);
            model.dispose();
        }
    });

    it('preserves the active validation session when a field switch suspends', async () => {
        let release!: (valid: boolean) => void;
        const model = createModel({
            a: {
                type: 'string',
                default: '',
                validator: [{
                    type: 'controlled',
                    message: 'invalid',
                    validate: () => new Promise<boolean>((resolve) => {
                        release = resolve;
                    }),
                }],
            },
            b: { type: 'string', default: '' },
        });
        const suspended = new Promise<void>(() => {});
        const renderAttempt = jest.fn();
        let changeField!: (field: 'a' | 'b') => void;
        let edit!: (value: string) => Promise<boolean>;
        function CurrentField({ field }: { field: 'a' | 'b' }) {
            const [, setValue, meta] = useModelFieldState(model, field);
            React.useLayoutEffect(() => { edit = setValue; }, [setValue]);
            renderAttempt(field);
            if (field === 'b') throw suspended;
            return <span>{field}:{String(meta.validating)}</span>;
        }
        function Form() {
            const [field, setField] = useState<'a' | 'b'>('a');
            changeField = setField;
            return (
                <React.Suspense fallback={<span>loading</span>}>
                    <CurrentField field={field} />
                </React.Suspense>
            );
        }
        const { getByText, unmount } = render(<Form />);
        let pending!: Promise<boolean>;
        act(() => { pending = edit('pending'); });
        try {
            expect(getByText('a:true')).toBeTruthy();
            act(() => {
                React.startTransition(() => changeField('b'));
            });
            expect(renderAttempt).toHaveBeenCalledWith('b');
            expect(getByText('a:true')).toBeTruthy();
            await act(async () => {
                release(true);
                await pending;
            });
            expect(getByText('a:false')).toBeTruthy();
            act(() => changeField('a'));
            expect(getByText('a:false')).toBeTruthy();
        } finally {
            unmount();
            release(true);
            await pending;
            model.dispose();
        }
    });
});
