import { deepEqual } from '../core/value/deep-equal';
import { createModel } from '../index';

describe('deepEqual', () => {
    test('should handle primitive types correctly', () => {
        expect(deepEqual(1, 1)).toBe(true);
        expect(deepEqual(1, 2)).toBe(false);
        expect(deepEqual('a', 'a')).toBe(true);
        expect(deepEqual('a', 'b')).toBe(false);
        expect(deepEqual(true, true)).toBe(true);
        expect(deepEqual(true, false)).toBe(false);
        expect(deepEqual(null, null)).toBe(true);
        expect(deepEqual(undefined, undefined)).toBe(true);
        expect(deepEqual(null, undefined)).toBe(false);
    });

    test('allocates a cycle guard only when comparing distinct object structures', () => {
        const NativeWeakSet = globalThis.WeakSet;
        const allocations = jest.spyOn(globalThis, 'WeakSet')
            .mockImplementation(() => new NativeWeakSet());
        const same = { value: 1 };

        deepEqual(1, 2);
        deepEqual(same, same);
        deepEqual(new Date(0), new Date(0));
        deepEqual(/value/, /value/);
        expect(allocations).not.toHaveBeenCalled();

        expect(deepEqual({ nested: { value: 1 } }, { nested: { value: 1 } })).toBe(true);
        expect(allocations).toHaveBeenCalledTimes(1);
        expect(allocations.mock.results[0]!.value).toBeInstanceOf(NativeWeakSet);
    });

    test('should handle arrays correctly', () => {
        expect(deepEqual([], [])).toBe(true);
        expect(deepEqual([1, 2], [1, 2])).toBe(true);
        expect(deepEqual([1, 2], [1, 3])).toBe(false);
        expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
        expect(deepEqual([1, { a: 1 }], [1, { a: 1 }])).toBe(true);
    });

    test('should handle objects correctly', () => {
        expect(deepEqual({}, {})).toBe(true);
        expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
        expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
        expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
        expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);

        expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    });

    test('compares enumerable symbol values recursively', () => {
        const token = Symbol('token');
        const original = { label: 'same', [token]: { list: [1, 2] } };

        expect(deepEqual(original, { label: 'same', [token]: { list: [1, 2] } })).toBe(true);
        expect(deepEqual(original, { label: 'same', [token]: { list: [1, 3] } })).toBe(false);
    });

    test('detects symbol additions, removals, and distinct symbols with the same description', () => {
        const token = Symbol('token');
        const other = Symbol('token');

        expect(deepEqual({}, { [token]: undefined })).toBe(false);
        expect(deepEqual({ [token]: undefined }, {})).toBe(false);
        expect(deepEqual({ [token]: 1 }, { [other]: 1 })).toBe(false);
        expect(deepEqual({ [token]: 1 }, { token: 1 })).toBe(false);
    });

    test('ignores symbol insertion order', () => {
        const first = Symbol('first');
        const second = Symbol('second');

        expect(deepEqual(
            { [first]: { count: 1 }, [second]: 2 },
            { [second]: 2, [first]: { count: 1 } }
        )).toBe(true);
    });

    test('does not read non-enumerable string or symbol properties', () => {
        const hidden = Symbol('hidden');
        const readHidden = jest.fn(() => {
            throw new Error('non-enumerable properties must not be read');
        });
        const original = Object.defineProperties({ visible: 1 }, {
            hidden: { get: readHidden },
            [hidden]: { get: readHidden },
        });

        expect(deepEqual(original, { visible: 1 })).toBe(true);
        expect(deepEqual({ visible: 1 }, original)).toBe(true);
        expect(readHidden).not.toHaveBeenCalled();
    });

    test('does not match an enumerable symbol against a non-enumerable own symbol', () => {
        const first = Symbol('first');
        const second = Symbol('second');
        const a = Object.defineProperty({ [first]: 1 }, second, { value: 1 });
        const b = Object.defineProperty({ [second]: 1 }, first, { value: 1 });

        expect(deepEqual(a, b)).toBe(false);
        expect(deepEqual(b, a)).toBe(false);
    });

    test('compares own __proto__ values as data', () => {
        const original = { ['__proto__']: { count: 1 } };

        expect(deepEqual(original, { ['__proto__']: { count: 1 } })).toBe(true);
        expect(deepEqual(original, { ['__proto__']: { count: 2 } })).toBe(false);
        expect(deepEqual(original, { constructor: { count: 1 } })).toBe(false);
    });

    test('should handle mixed types and edge cases', () => {
        expect(deepEqual([], {})).toBe(false);
        expect(deepEqual({}, null)).toBe(false);
        expect(deepEqual(null, {})).toBe(false);
        expect(deepEqual(1, '1')).toBe(false);

        const obj = { a: 1 };
        expect(deepEqual(obj, obj)).toBe(true); // Same reference
    });

    test('should handle Date instances structurally', () => {
        expect(deepEqual(new Date(2020, 0, 1), new Date(2020, 0, 1))).toBe(true);
        expect(deepEqual(new Date(2020, 0, 1), new Date(2021, 0, 1))).toBe(false);
        expect(deepEqual(new Date(2020, 0, 1), { getTime: () => 0 })).toBe(false);
    });

    test('should handle RegExp instances by source and flags', () => {
        expect(deepEqual(/abc/g, /abc/g)).toBe(true);
        expect(deepEqual(/abc/, /abc/g)).toBe(false);
        expect(deepEqual(/abc/, /xyz/)).toBe(false);
        expect(deepEqual(/abc/, { source: 'abc', flags: '' })).toBe(false);
    });

    test('should handle cyclic references without throwing', () => {
        const a: any = { name: 'cycle' };
        const b: any = { name: 'cycle' };
        a.self = a;
        b.self = b;
        // Should not stack overflow; the cycle-guard short-circuits the
        // self-reference so distinct cyclic objects compare as not equal.
        expect(() => deepEqual(a, b)).not.toThrow();
        expect(deepEqual(a, b)).toBe(false);

        // Same reference should still be equal.
        expect(deepEqual(a, a)).toBe(true);
    });

    test('should distinguish array from object even when shape similar', () => {
        const arr: any = [];
        arr.foo = 'bar';
        expect(deepEqual(arr, { foo: 'bar' })).toBe(false);
    });

    test('should compare DAGs (same reference in sibling branches) structurally', () => {
        // Regression: the cycle-guard must not treat a value shared by sibling
        // branches as a cycle. `{ x: shared, y: shared }` is a DAG, not a cycle,
        // and should compare equal to an equivalent structure with distinct
        // objects.
        const shared = { v: 1 };
        const a = { x: shared, y: shared };
        const b = { x: { v: 1 }, y: { v: 1 } };
        expect(deepEqual(a, b)).toBe(true);

        const sharedArr = [1, 2];
        const c = { list: [sharedArr, sharedArr] };
        const d = { list: [[1, 2], [1, 2]] };
        expect(deepEqual(c, d)).toBe(true);

        // A shared reference used twice must still detect a real difference.
        const e = { x: shared, y: shared };
        const f = { x: { v: 1 }, y: { v: 2 } };
        expect(deepEqual(e, f)).toBe(false);
    });

    test('should not report inequality for repeated equal deep values', () => {
        const inner = { a: { b: { c: 1 } } };
        const g = { first: inner, second: inner };
        const h = {
            first: { a: { b: { c: 1 } } },
            second: { a: { b: { c: 1 } } },
        };
        expect(deepEqual(g, h)).toBe(true);
    });

    test('compares shared symbol values structurally without mistaking them for cycles', () => {
        const token = Symbol('token');
        const shared = { count: 1 };
        const original = { named: shared, [token]: shared };

        expect(deepEqual(original, { named: { count: 1 }, [token]: { count: 1 } })).toBe(true);
        expect(deepEqual(original, { named: { count: 1 }, [token]: { count: 2 } })).toBe(false);
    });

    test('guards cycles through symbol keys using the existing reference-identity policy', () => {
        const self = Symbol('self');
        const a: Record<PropertyKey, unknown> = {};
        const b: Record<PropertyKey, unknown> = {};
        a[self] = a;
        b[self] = b;

        expect(deepEqual(a, a)).toBe(true);
        expect(deepEqual(a, b)).toBe(false);
    });

    test('compares null-prototype objects by their own fields', () => {
        const a = Object.assign(Object.create(null), { value: { count: 1 } });
        const b = Object.assign(Object.create(null), { value: { count: 1 } });
        expect(deepEqual(a, b)).toBe(true);
        expect(deepEqual(a, { value: { count: 1 } })).toBe(true);
        expect(deepEqual(a, { value: { count: 2 } })).toBe(false);
    });

    test('compares symbols on null-prototype dictionaries without making prototypes significant', () => {
        const token = Symbol('token');
        const dictionary = { [token]: { count: 1 } };
        Object.setPrototypeOf(dictionary, null);

        expect(deepEqual(dictionary, { [token]: { count: 1 } })).toBe(true);
        expect(deepEqual({ [token]: { count: 1 } }, dictionary)).toBe(true);
        expect(deepEqual(dictionary, { [token]: { count: 2 } })).toBe(false);
    });

    test('commits symbol-only changes and notifies events, selectors, and downstream reactions', async () => {
        const token = Symbol('token');
        type Value = { label: string; [token]?: { count: number } };
        const computed = jest.fn(({ value }: Record<string, Value>) => value?.[token]?.count ?? 0);
        const action = jest.fn();
        const model = createModel<{ value: Value; count: number | undefined }>({
            value: { type: 'object', default: { label: 'same' } },
            count: {
                type: 'number',
                reaction: { fields: ['value'], computed, action: [action] },
            },
        });
        try {
            await model.settled();
            expect(model.data.count).toBe(0);
            computed.mockClear();
            action.mockClear();
            const onChange = jest.fn();
            const onSelection = jest.fn();
            model.on('field:change', onChange);
            model.subscribe((data) => data.value[token]?.count ?? 0, onSelection);

            for (const count of [1, 2, 0]) {
                const previous = model.data;
                const previousCount = previous.count;
                const next: Value = count
                    ? { label: 'same', [token]: { count } }
                    : { label: 'same' };

                expect(await model.setField('value', next)).toBe(true);
                await model.settled();

                expect(model.getField('value')).toBe(next);
                expect(model.data).not.toBe(previous);
                expect(model.data.count).toBe(count);
                expect(previous.count).toBe(previousCount);
                expect(onChange).toHaveBeenCalledTimes(2);
                expect(onChange).toHaveBeenCalledWith({ field: 'value', value: next });
                expect(onChange).toHaveBeenCalledWith({ field: 'count', value: count });
                expect(onSelection).toHaveBeenCalledTimes(1);
                expect(onSelection).toHaveBeenCalledWith(count, previousCount);
                expect(computed).toHaveBeenCalledTimes(1);
                expect(action).toHaveBeenCalledTimes(1);
                expect(action).toHaveBeenCalledWith({ field: 'count', value: count });

                onChange.mockClear();
                onSelection.mockClear();
                computed.mockClear();
                action.mockClear();
                const committed = model.data;
                const equal: Value = count
                    ? { [token]: { count }, label: 'same' }
                    : { label: 'same' };

                expect(await model.setField('value', equal)).toBe(true);
                await model.settled();

                expect(model.data).toBe(committed);
                expect(model.getField('value')).toBe(next);
                expect(onChange).not.toHaveBeenCalled();
                expect(onSelection).not.toHaveBeenCalled();
                expect(computed).not.toHaveBeenCalled();
                expect(action).not.toHaveBeenCalled();
            }
        } finally {
            model.dispose();
        }
    });

    class OpaqueValue {
        constructor(readonly count: number) {}
    }

    test.each([
        { name: 'Map', previous: new Map([['count', 1]]), next: new Map([['count', 2]]) },
        { name: 'Set', previous: new Set([1]), next: new Set([2]) },
        { name: 'class instance', previous: new OpaqueValue(1), next: new OpaqueValue(1) },
    ])('compares $name by reference and commits replacements', async ({ previous, next }) => {
        expect(deepEqual(previous, previous)).toBe(true);
        expect(deepEqual(previous, next)).toBe(false);
        expect(deepEqual(previous, {})).toBe(false);
        expect(deepEqual({}, previous)).toBe(false);
        expect(deepEqual({ nested: previous }, { nested: next })).toBe(false);

        const model = createModel<{ value: object; mirror: object | undefined }>({
            value: { type: 'object', default: previous },
            mirror: {
                type: 'object',
                reaction: { fields: ['value'], computed: ({ value }) => value },
            },
        });
        try {
            await model.settled();
            const onSelection = jest.fn();
            model.subscribe((data) => data.value, onSelection);

            expect(await model.setField('value', next)).toBe(true);
            await model.settled();
            expect(model.getField('value')).toBe(next);
            expect(model.getField('mirror')).toBe(next);
            expect(onSelection).toHaveBeenCalledTimes(1);
            expect(onSelection).toHaveBeenCalledWith(next, previous);

            await model.setField('value', next);
            await model.settled();
            expect(onSelection).toHaveBeenCalledTimes(1);
        } finally {
            model.dispose();
        }
    });
});
