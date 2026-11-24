/** @jest-environment jsdom */
import React, { Activity, StrictMode, Suspense, startTransition, useState } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { createModel } from '../devtools';
import { createModel as createPlainModel } from '../index';
import { shallow, useModelComputed, useModelFields, useModelSelector } from '../react';
import type { SelectorObserver } from '../devtools-observer';

interface Observation {
    kind: string;
    debugName?: string;
    fields?: string[];
    value: unknown;
}

interface DebugInstance {
    getSnapshot(): { data: Record<string, unknown> };
    observeSelector?: SelectorObserver;
}

const hookKey = '__MODEL_REACTION_DEVTOOLS_HOOK__';
const schema = { count: { type: 'number' as const, default: 2 } };
const makeHook = () => {
    const models = new WeakMap<object, DebugInstance>();
    return {
        register: jest.fn((instance: DebugInstance, model?: object) => {
            if (model) models.set(model, instance);
        }),
        unregister: jest.fn((_id: number) => {}),
        getDerivedObserver: (model: object) => models.get(model)?.observeSelector,
        updateDerived: jest.fn((_model: object, _token: object, _selection: Observation | null) => {}),
    };
};
let hook: ReturnType<typeof makeHook>;

beforeEach(() => {
    hook = makeHook();
    (globalThis as Record<string, unknown>)[hookKey] = hook;
});

afterEach(() => {
    cleanup();
    delete (globalThis as Record<string, unknown>)[hookKey];
});

describe.each([
    { kind: 'useModelSelector', useSelection: useModelSelector },
    { kind: 'useModelComputed', useSelection: useModelComputed },
])('$kind DevTools observations', ({ kind, useSelection }) => {
    test.each([false, true])('refreshes conditional reads without rendering equal results (object: %s)', async (object) => {
        const model = createModel({
            right: { type: 'boolean', default: false },
            a: { type: 'number', default: 2 },
            b: { type: 'number', default: 2 },
        });
        const selector = (data: typeof model.data) => {
            const value = data.right ? data.b : data.a;
            return object ? { value } : value;
        };
        const renders = jest.fn();
        const { result, unmount } = renderHook(() => {
            renders();
            return useSelection(model, selector, shallow);
        });
        const token = hook.updateDerived.mock.calls[0]![1];
        const retained = result.current;
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, value: retained, debugName: 'selector', fields: ['a', 'right'],
        });
        const count = renders.mock.calls.length;
        hook.updateDerived.mockClear();
        await act(async () => { await model.setField('right', true); });
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, value: retained, debugName: 'selector', fields: ['b', 'right'],
        });
        expect(renders).toHaveBeenCalledTimes(count);
        expect(result.current).toBe(retained);
        await act(async () => { await model.setField('b', 3); });
        expect(result.current).toEqual(object ? { value: 3 } : 3);
        expect(hook.updateDerived.mock.calls.at(-1)![2]?.value).toBe(result.current);
        unmount();
        model.dispose();
    });

    test('prop-only dependency changes keep the observation identity and committed result', () => {
        const model = createModel({ a: { type: 'number', default: 2 }, b: { type: 'number', default: 2 } });
        const { result, rerender, unmount } = renderHook(
            ({ field }: { field: 'a' | 'b' }) => useSelection(model, (data) => ({ value: data[field] }), shallow),
            { initialProps: { field: 'a' as 'a' | 'b' } }
        );
        const token = hook.updateDerived.mock.calls[0]![1];
        const retained = result.current;
        hook.updateDerived.mockClear();
        rerender({ field: 'b' });
        expect(hook.updateDerived.mock.calls).toEqual([
            [model, token, { kind, value: retained, fields: ['b'], debugName: expect.stringContaining('data[field]') }],
        ]);
        expect(result.current).toBe(retained);
        unmount();
        model.dispose();
    });

    test('retains reads when the selector memoizes repeated evaluations of the same snapshot', async () => {
        const model = createModel(schema);
        const cache = new WeakMap<typeof model.data, number>();
        const selector = (data: typeof model.data) => {
            if (!cache.has(data)) cache.set(data, data.count * 2);
            return cache.get(data)!;
        };
        const { result, unmount } = renderHook(() => useSelection(model, selector));
        await act(async () => { await model.setField('count', 3); });
        expect(result.current).toBe(6);
        expect(hook.updateDerived.mock.calls.at(-1)![2]?.fields).toEqual(['count']);
        unmount();
        model.dispose();
    });

    test('catches an equal-result dependency change between render and subscription', async () => {
        const model = createModel({
            right: { type: 'boolean', default: false },
            a: { type: 'number', default: 2 },
            b: { type: 'number', default: 2 },
        });
        const before = model.data;
        await model.setField('right', true);
        const after = model.data;
        const read = jest.spyOn(model, 'data', 'get').mockReturnValue(before);
        const subscribe = model.subscribe;
        const on = model.on;
        if (kind === 'useModelSelector') {
            jest.spyOn(model, 'subscribe').mockImplementation((...args) => {
                read.mockReturnValue(after);
                return subscribe(...args);
            });
        } else {
            jest.spyOn(model, 'on').mockImplementation((...args) => {
                read.mockReturnValue(after);
                return on(...args);
            });
        }
        const selector = (data: typeof model.data) => data.right ? data.b : data.a;
        const { result, unmount } = renderHook(() => useSelection(model, selector));
        expect(result.current).toBe(2);
        expect(hook.updateDerived.mock.calls.at(-1)![2]?.fields).toEqual(['b', 'right']);
        unmount();
        model.dispose();
    });

    test('tracks own special/numeric keys, existence checks, descriptors and enumeration', () => {
        const model = createModel<{ 0: number; __proto__: number; constructor: number; 'a,b': number; 'a"b': number }>({
            0: { type: 'number', default: 1 },
            ['__proto__']: { type: 'number', default: 2 },
            constructor: { type: 'number', default: 3 },
            'a,b': { type: 'number', default: 4 },
            'a"b': { type: 'number', default: 5 },
        });
        const { rerender, unmount } = renderHook(
            ({ mode }) => useSelection(model, (data) => {
                if (mode === 'read') {
                    Object.getOwnPropertyDescriptor(data, 'a"b');
                    return data[0] + data.__proto__ + ('constructor' in data ? 1 : 0) +
                        (Object.prototype.hasOwnProperty.call(data, 'a,b') ? 1 : 0);
                }
                if (mode === 'keys') return Object.keys(data).length;
                if (mode === 'spread') return Object.values({ ...data }).length;
                return 'toString' in data ? 1 : 0;
            }),
            { initialProps: { mode: 'read' } }
        );
        const last = () => hook.updateDerived.mock.calls.at(-1)![2];
        const fields = ['0', '__proto__', 'a"b', 'a,b', 'constructor'];
        expect(last()?.fields).toEqual(fields);
        rerender({ mode: 'keys' });
        expect(last()?.fields).toEqual(fields);
        rerender({ mode: 'spread' });
        expect(last()?.fields).toEqual(fields);
        rerender({ mode: 'constant' });
        expect(last()?.fields).toEqual([]);
        unmount();
        model.dispose();
    });

    test('preserves snapshot, nested value, descriptor and WeakMap identities', async () => {
        const nested = { name: 'Ada' };
        const model = createModel({ person: { type: 'object', default: nested }, count: schema.count });
        const snapshots = new WeakMap<object, string>();
        snapshots.set(model.data, 'known');
        const seen: unknown[] = [];
        const stop = model.subscribe((data) => { seen.push(data); return data; }, () => {});
        const { result, rerender, unmount } = renderHook(
            ({ whole }) => useSelection(model, (data) => {
                expect(data).toBe(model.data);
                expect(data.person).toBe(model.getField('person'));
                expect(Object.isFrozen(data)).toBe(true);
                expect(Object.getOwnPropertyDescriptor(data, 'person')?.value).toBe(data.person);
                return whole ? data : { snapshot: data, person: data.person, cached: snapshots.get(data) };
            }, shallow),
            { initialProps: { whole: false } }
        );
        expect(result.current).toEqual({ snapshot: model.data, person: nested, cached: 'known' });
        expect(seen[0]).toBe(model.data);
        rerender({ whole: true });
        expect(result.current).toBe(model.data);
        expect(hook.updateDerived.mock.calls.at(-1)![2]?.fields).toEqual(['count', 'person']);
        const previous = model.data;
        await act(async () => { await model.setField('count', 3); });
        expect(model.data).not.toBe(previous);
        expect(result.current).toBe(model.data);
        expect(seen.at(-1)).toBe(model.data);
        stop();
        unmount();
        model.dispose();
    });

    test('reports committed model and prop changes without extra evaluations or subscriptions', async () => {
        const model = createModel(schema);
        const [instance, registeredModel] = hook.register.mock.calls[0]!;
        expect(registeredModel).toBe(model);
        expect(Object.getOwnPropertySymbols(model)).toEqual([]);
        const on = jest.spyOn(model, 'on');
        const subscribe = jest.spyOn(model, 'subscribe');
        const calls = jest.fn();
        function selectCount(data: { count: number }) { calls(); return data.count; }
        const { rerender, unmount } = renderHook(
            ({ offset }) => useSelection(model, offset === 0 ? selectCount : (data) => data.count + offset),
            { initialProps: { offset: 0 } }
        );
        const token = hook.updateDerived.mock.calls[0]![1];
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, debugName: 'selectCount', value: 2, fields: ['count'],
        });
        const evaluations = calls.mock.calls.length;
        instance.getSnapshot();
        instance.getSnapshot();
        const subscriptions = [on.mock.calls.length, subscribe.mock.calls.length];
        hook.updateDerived.mockClear();
        rerender({ offset: 0 });
        expect(hook.updateDerived).not.toHaveBeenCalled();
        expect([on.mock.calls.length, subscribe.mock.calls.length]).toEqual(subscriptions);
        expect(calls).toHaveBeenCalledTimes(evaluations);
        rerender({ offset: 3 });
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, value: 5, fields: ['count'], debugName: expect.stringContaining('data.count + offset'),
        });
        expect(instance.getSnapshot().data).toEqual({ count: 2 });
        await act(async () => { await model.setField('count', 4); });
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, value: 7, fields: ['count'], debugName: expect.stringContaining('data.count + offset'),
        });
        unmount();
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, null);
        model.dispose();
    });

    test('keeps equal retained selections and does not notify on unrelated renders', async () => {
        const model = createModel(schema);
        const { result, rerender, unmount } = renderHook(
            () => useSelection(model, (data) => ({ count: data.count }), shallow)
        );
        const token = hook.updateDerived.mock.calls[0]![1];
        expect(hook.updateDerived.mock.calls[0]![2]?.value).toBe(result.current);
        hook.updateDerived.mockClear();
        rerender();
        expect(hook.updateDerived).not.toHaveBeenCalled();
        await act(async () => { await model.setField('count', 3); });
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, value: result.current, fields: ['count'], debugName: expect.stringContaining('count: data.count'),
        });
        expect(hook.updateDerived.mock.calls.at(-1)![2]?.value).toBe(result.current);
        unmount();
        model.dispose();
    });

    test('separates instances sharing a selector and survives StrictMode cleanup', () => {
        const model = createModel(schema);
        const selector = (data: { count: number }) => data.count;
        function Reader() { useSelection(model, selector); return null; }
        const { rerender, unmount } = render(<StrictMode><Reader key="a" /><Reader key="b" /></StrictMode>);
        const tokens = [...new Set(hook.updateDerived.mock.calls.map((call) => call[1]))];
        expect(tokens).toHaveLength(2);
        for (const token of tokens) {
            expect(hook.updateDerived.mock.calls.filter((call) => call[1] === token).map((call) => call[2])).toEqual([
                { kind, debugName: 'selector', value: 2, fields: ['count'] }, null,
                { kind, debugName: 'selector', value: 2, fields: ['count'] },
            ]);
        }
        hook.updateDerived.mockClear();
        rerender(<StrictMode><Reader key="b" /></StrictMode>);
        expect(hook.updateDerived.mock.calls).toEqual([[model, tokens[0], null]]);
        unmount();
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, tokens[1], null);
        model.dispose();
    });

    test('reinstates dependencies when Activity reconnects effects', async () => {
        const model = createModel(schema);
        function Reader() { return <span>{useSelection(model, (data) => data.count)}</span>; }
        const { rerender, unmount } = render(<Activity mode="visible"><Reader /></Activity>);
        const token = hook.updateDerived.mock.calls[0]![1];
        rerender(<Activity mode="hidden"><Reader /></Activity>);
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, null);
        await act(async () => { await model.setField('count', 5); });
        rerender(<Activity mode="visible"><Reader /></Activity>);
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, value: 5, fields: ['count'], debugName: expect.stringContaining('=> data.count'),
        });
        unmount();
        model.dispose();
    });

    test('cleans up the previous model before reporting a new model with the same value', () => {
        const first = createModel(schema);
        const second = createModel(schema);
        const { rerender, unmount } = renderHook(
            ({ model }) => useSelection(model, (data) => data.count), { initialProps: { model: first } }
        );
        const token = hook.updateDerived.mock.calls[0]![1];
        hook.updateDerived.mockClear();
        rerender({ model: second });
        expect(hook.updateDerived.mock.calls).toEqual([
            [first, token, null], [second, token, {
                kind, value: 2, fields: ['count'], debugName: expect.stringContaining('=> data.count'),
            }],
        ]);
        unmount();
        expect(hook.updateDerived).toHaveBeenLastCalledWith(second, token, null);
        second.dispose();
        first.dispose();
    });

    test('does not publish suspended values or equal-value speculative dependencies', async () => {
        const model = createModel({ count: schema.count, other: schema.count });
        const suspended = new Promise<void>(() => {});
        const attempts = jest.fn();
        let changeField!: (field: 'count' | 'other') => void;
        function Reader({ field }: { field: 'count' | 'other' }) {
            const value = useSelection(model, (data) => data[field]);
            attempts(field);
            if (field === 'other') throw suspended;
            return <span>{value}</span>;
        }
        function App() {
            const [field, setField] = useState<'count' | 'other'>('count');
            changeField = setField;
            return <Suspense fallback="loading"><Reader field={field} /></Suspense>;
        }
        const initial = render(<Suspense fallback="loading"><Reader field="other" /></Suspense>);
        expect(attempts).toHaveBeenCalledWith('other');
        expect(hook.updateDerived).not.toHaveBeenCalled();
        initial.unmount();
        const { unmount } = render(<App />);
        const token = hook.updateDerived.mock.calls[0]![1];
        hook.updateDerived.mockClear();
        act(() => { startTransition(() => changeField('other')); });
        expect(hook.updateDerived).not.toHaveBeenCalled();
        await act(async () => { await model.setField('count', 4); });
        expect(hook.updateDerived).toHaveBeenLastCalledWith(model, token, {
            kind, value: 4, fields: ['count'], debugName: expect.stringContaining('=> data[field]'),
        });
        unmount();
        model.dispose();
    });

    test('server rendering creates no observations', () => {
        const model = createModel(schema);
        function Reader() { return <span>{useSelection(model, (data) => data.count)}</span>; }
        expect(renderToString(<Reader />)).toBe('<span>2</span>');
        expect(hook.updateDerived).not.toHaveBeenCalled();
        model.dispose();
    });

    test('adds no subscriptions or selector evaluations during mounting and updates', async () => {
        const plain = createPlainModel(schema);
        const instrumented = createModel(schema);
        const plainOn = jest.spyOn(plain, 'on');
        const instrumentedOn = jest.spyOn(instrumented, 'on');
        const firstSelector = jest.fn((data: { count: number }) => data.count);
        const secondSelector = jest.fn((data: { count: number }) => data.count);
        const first = renderHook(() => useSelection(plain, firstSelector));
        const second = renderHook(() => useSelection(instrumented, secondSelector));
        await act(async () => { await plain.setField('count', 3); await instrumented.setField('count', 3); });
        expect(secondSelector).toHaveBeenCalledTimes(firstSelector.mock.calls.length);
        expect(instrumentedOn.mock.calls).toHaveLength(plainOn.mock.calls.length);
        first.unmount();
        second.unmount();
        plain.dispose();
        instrumented.dispose();
    });
});

test('observer restores nested tracking and propagates selector errors without retrying', () => {
    const model = createModel({ count: schema.count, other: schema.count });
    const observe = hook.getDerivedObserver(model)!;
    const error = new Error('selector failed');
    const fails = jest.fn((data: typeof model.data) => { void data.count; throw error; });
    expect(() => observe(model.data, fails)).toThrow(error);
    expect(fails).toHaveBeenCalledTimes(1);
    const outer = observe(model.data, (data) => {
        const inner = observe(data, (value) => value.other);
        expect(inner.fields).toEqual(['other']);
        return data.count + inner.value;
    });
    expect(outer.fields).toEqual(['count', 'other']);
    expect(observe(model.data, () => 1).fields).toEqual([]);
    const lazy = observe(model.data, (data) => () => data.count);
    expect(lazy.value()).toBe(2);
    expect(lazy.fields).toEqual([]);
    model.dispose();
});

test('fixed-field helpers do not add selector observations', () => {
    const model = createModel(schema);
    const { unmount } = renderHook(() => useModelFields(model, ['count']));
    expect(hook.updateDerived).not.toHaveBeenCalled();
    unmount();
    model.dispose();
});

test('without the global hook the DevTools entry remains a plain model', () => {
    delete (globalThis as Record<string, unknown>)[hookKey];
    const model = createModel(schema);
    const { result, unmount } = renderHook(() => useModelComputed(model, (data) => data.count));
    expect(result.current).toBe(2);
    expect(hook.register).not.toHaveBeenCalled();
    expect(hook.updateDerived).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(model, 'data')).toBeUndefined();
    unmount();
    model.dispose();
});

test('older global hooks keep their original snapshots and reporting capability', () => {
    (globalThis as Record<string, unknown>)[hookKey] = {
        register: hook.register, unregister: hook.unregister, updateDerived: hook.updateDerived,
    };
    const model = createModel(schema);
    const { result, unmount } = renderHook(() => useModelComputed(model, (data) => data.count));
    expect(result.current).toBe(2);
    expect(Object.getOwnPropertyDescriptor(model, 'data')).toBeUndefined();
    expect(hook.updateDerived.mock.calls[0]![2]).toEqual({
        kind: 'useModelComputed', value: 2, debugName: expect.stringContaining('=> data.count'),
    });
    unmount();
    model.dispose();
});

test('debugger lookup and reporting errors cannot interrupt rendering or cleanup', () => {
    hook.getDerivedObserver = () => { throw new Error('lookup failed'); };
    hook.updateDerived.mockImplementation(() => { throw new Error('broken debugger'); });
    const model = createModel(schema);
    const { result, unmount } = renderHook(() => useModelComputed(model, (data) => data.count));
    expect(result.current).toBe(2);
    expect(() => unmount()).not.toThrow();
    model.dispose();
});
