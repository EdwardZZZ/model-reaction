import { deepEqual } from '../deep-equal';

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

        // Nested objects
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
});
