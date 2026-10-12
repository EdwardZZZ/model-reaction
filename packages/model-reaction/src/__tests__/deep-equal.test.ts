import { deepEqual } from '../utils/deep-equal';
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

    test('compares null-prototype objects by their own fields', () => {
        const a = Object.assign(Object.create(null), { value: { count: 1 } });
        const b = Object.assign(Object.create(null), { value: { count: 1 } });
        expect(deepEqual(a, b)).toBe(true);
        expect(deepEqual(a, { value: { count: 1 } })).toBe(true);
        expect(deepEqual(a, { value: { count: 2 } })).toBe(false);
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
