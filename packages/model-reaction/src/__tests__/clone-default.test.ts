import { cloneDefault } from '../core/value/clone-default';
import { createModel } from '../index';

describe('cloneDefault', () => {
    test('allocates a clone map only for arrays and plain object graphs', () => {
        const NativeWeakMap = globalThis.WeakMap;
        const allocations = jest.spyOn(globalThis, 'WeakMap')
            .mockImplementation(() => new NativeWeakMap());

        cloneDefault('value');
        cloneDefault(null);
        cloneDefault(new Date(0));
        cloneDefault(/value/);
        cloneDefault(new Map());
        expect(allocations).not.toHaveBeenCalled();

        const original = { nested: [{ value: 1 }] };
        const copy = cloneDefault(original);
        expect(copy).toEqual(original);
        expect(copy.nested).not.toBe(original.nested);
        expect(allocations).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // Primitives — returned as-is
    // -------------------------------------------------------------------------

    describe('primitives', () => {
        test.each([
            ['string', 'hello'],
            ['number', 42],
            ['zero', 0],
            ['boolean', true],
            ['null', null],
            ['undefined', undefined],
        ])('returns %s unchanged', (_label, value) => {
            expect(cloneDefault(value)).toBe(value);
        });

        test('returns NaN unchanged', () => {
            expect(cloneDefault(NaN)).toBeNaN();
        });
    });

    // -------------------------------------------------------------------------
    // Arrays — deep cloned
    // -------------------------------------------------------------------------

    describe('arrays', () => {
        test('clones a flat array into a new reference with equal contents', () => {
            const original = [1, 2, 3];
            const clone = cloneDefault(original);

            expect(clone).toEqual(original);
            expect(clone).not.toBe(original);
        });

        test('mutating the clone does not affect the original', () => {
            const original = [1, 2, 3];
            const clone = cloneDefault(original);

            clone.push(4);
            expect(original).toEqual([1, 2, 3]);
        });

        test('clones nested arrays deeply', () => {
            const original = [[1], [2, [3]]];
            const clone = cloneDefault(original);

            expect(clone).toEqual(original);
            expect(clone[0]).not.toBe(original[0]);
            expect((clone[1] as unknown[])[1]).not.toBe(
                (original[1] as unknown[])[1]
            );
        });

        test('clones arrays of plain objects deeply', () => {
            const original = [{ a: 1 }, { b: 2 }];
            const clone = cloneDefault(original);

            (clone[0] as { a: number }).a = 99;
            expect(original[0]).toEqual({ a: 1 });
        });
    });

    // -------------------------------------------------------------------------
    // Plain objects — deep cloned
    // -------------------------------------------------------------------------

    describe('plain objects', () => {
        test('clones an own __proto__ key without changing the clone prototype', () => {
            const original = { ['__proto__']: { nested: [1] } };
            const copy = cloneDefault(original);
            expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
            expect(Object.prototype.hasOwnProperty.call(copy, '__proto__')).toBe(true);
            expect(copy).toEqual(original);
            copy.__proto__.nested.push(2);
            expect(original.__proto__.nested).toEqual([1]);
        });

        test('clones a flat object into a new reference with equal contents', () => {
            const original = { a: 1, b: 'x' };
            const clone = cloneDefault(original);

            expect(clone).toEqual(original);
            expect(clone).not.toBe(original);
        });

        test('mutating a nested property of the clone does not affect the original', () => {
            const original = { nested: { list: [1, 2] } };
            const clone = cloneDefault(original);

            clone.nested.list.push(3);
            expect(original.nested.list).toEqual([1, 2]);
            expect(clone.nested).not.toBe(original.nested);
        });

        test('deeply clones enumerable symbol values using the original symbol keys', () => {
            const token = Symbol('token');
            const original = { label: 'same', [token]: { list: [1, 2] } };
            const clone = cloneDefault(original);

            expect(clone[token]).toEqual({ list: [1, 2] });
            expect(clone[token]).not.toBe(original[token]);
            expect(Object.getOwnPropertySymbols(clone)).toEqual([token]);
            expect(Object.prototype.propertyIsEnumerable.call(clone, token)).toBe(true);
            clone[token].list.push(3);
            expect(original[token].list).toEqual([1, 2]);
        });

        test('does not read or copy non-enumerable string or symbol properties', () => {
            const hidden = Symbol('hidden');
            const readHidden = jest.fn(() => {
                throw new Error('non-enumerable properties must not be read');
            });
            const original = Object.defineProperties({ visible: 1 }, {
                hidden: { get: readHidden },
                [hidden]: { get: readHidden },
            });
            const clone = cloneDefault(original);

            expect(clone).toEqual({ visible: 1 });
            expect(Object.prototype.hasOwnProperty.call(clone, 'hidden')).toBe(false);
            expect(Object.getOwnPropertySymbols(clone)).toEqual([]);
            expect(readHidden).not.toHaveBeenCalled();
        });

        test('clones an object created with Object.create(null)', () => {
            const original = Object.create(null) as Record<string, unknown>;
            original.a = 1;
            const clone = cloneDefault(original);

            expect(Object.getPrototypeOf(clone)).toBeNull();
            expect(clone.a).toBe(1);
            expect(clone).not.toBe(original);
            expect(clone.constructor).toBeUndefined();
            expect(clone.toString).toBeUndefined();
            expect('constructor' in clone).toBe(false);
        });

        test('preserves nested null-prototype dictionaries and their own __proto__ values', () => {
            const dictionary = { ['__proto__']: { list: [1] } };
            Object.setPrototypeOf(dictionary, null);
            const clone = cloneDefault({ dictionary });

            expect(Object.getPrototypeOf(clone.dictionary)).toBeNull();
            expect(Object.prototype.hasOwnProperty.call(clone.dictionary, '__proto__')).toBe(true);
            expect(clone.dictionary.__proto__).not.toBe(dictionary.__proto__);
            clone.dictionary.__proto__.list.push(2);
            expect(dictionary.__proto__.list).toEqual([1]);
        });

        test('keeps null-prototype field defaults isolated without changing outer snapshots', () => {
            const dictionary = { entry: { count: 1 } };
            Object.setPrototypeOf(dictionary, null);
            const schema = { dictionary: { type: 'object' as const, default: dictionary } };
            const first = createModel(schema);
            const second = createModel(schema);
            try {
                const value = first.getField('dictionary');
                expect(Object.getPrototypeOf(value)).toBeNull();
                expect(Object.getPrototypeOf(second.data.dictionary)).toBeNull();
                expect(Object.getPrototypeOf(first.data)).toBe(Object.prototype);
                expect('constructor' in value).toBe(false);
                expect('toString' in value).toBe(false);
                expect(value.entry).not.toBe(dictionary.entry);
                expect(value.entry).not.toBe(second.data.dictionary.entry);
            } finally {
                first.dispose();
                second.dispose();
            }
        });
    });

    // -------------------------------------------------------------------------
    // Immutable leaves — returned by reference
    // -------------------------------------------------------------------------

    describe('immutable leaves (by reference)', () => {
        test('returns the same Date reference', () => {
            const date = new Date('2020-01-01T00:00:00Z');
            expect(cloneDefault(date)).toBe(date);
        });

        test('returns the same RegExp reference', () => {
            const re = /abc/gi;
            expect(cloneDefault(re)).toBe(re);
        });

        test('keeps Date/RegExp references intact when nested in an object', () => {
            const date = new Date();
            const re = /x/;
            const original = { date, re };
            const clone = cloneDefault(original);

            expect(clone).not.toBe(original);
            expect(clone.date).toBe(date);
            expect(clone.re).toBe(re);
        });
    });

    // -------------------------------------------------------------------------
    // Class instances — left untouched by reference (not plain objects)
    // -------------------------------------------------------------------------

    describe('class instances (by reference)', () => {
        class Point {
            constructor(public x: number, public y: number) {}
        }

        test('returns the same class-instance reference', () => {
            const point = new Point(1, 2);
            expect(cloneDefault(point)).toBe(point);
        });

        test('keeps a nested class instance by reference while cloning the wrapper', () => {
            const point = new Point(1, 2);
            const original = { point };
            const clone = cloneDefault(original);

            expect(clone).not.toBe(original);
            expect(clone.point).toBe(point);
        });

        test('returns Map/Set by reference (non-plain objects)', () => {
            const map = new Map([['k', 'v']]);
            const set = new Set([1, 2]);

            expect(cloneDefault(map)).toBe(map);
            expect(cloneDefault(set)).toBe(set);
        });
    });

    // -------------------------------------------------------------------------
    // Shared references (DAG) — cloned once, sharing preserved
    // -------------------------------------------------------------------------

    describe('shared references (DAG)', () => {
        test('a value shared by two keys is cloned once and stays shared', () => {
            const shared = { count: 1 };
            const original = { a: shared, b: shared };
            const clone = cloneDefault(original);

            expect(clone.a).toEqual({ count: 1 });
            expect(clone.a).not.toBe(shared);
            // Both branches must point to the SAME cloned object.
            expect(clone.a).toBe(clone.b);
        });

        test('a shared array element is cloned once', () => {
            const shared = [0];
            const original = [shared, shared];
            const clone = cloneDefault(original);

            expect(clone[0]).not.toBe(shared);
            expect(clone[0]).toBe(clone[1]);
        });

        test('preserves sharing between string and symbol properties', () => {
            const token = Symbol('token');
            const shared = { count: 1 };
            const clone = cloneDefault({ named: shared, [token]: shared });

            expect(clone[token]).toBe(clone.named);
            expect(clone[token]).not.toBe(shared);
        });
    });

    // -------------------------------------------------------------------------
    // Cyclic references — guarded, no infinite recursion
    // -------------------------------------------------------------------------

    describe('cyclic references', () => {
        test('clones a directly self-referential object without overflowing', () => {
            const original: Record<string, unknown> = { name: 'root' };
            original.self = original;

            const clone = cloneDefault(original) as Record<string, unknown>;

            expect(clone).not.toBe(original);
            expect(clone.name).toBe('root');
            // The cycle is preserved: the clone points back to itself.
            expect(clone.self).toBe(clone);
        });

        test('clones a mutually referential (cyclic) pair of objects', () => {
            const a: Record<string, unknown> = { id: 'a' };
            const b: Record<string, unknown> = { id: 'b' };
            a.other = b;
            b.other = a;

            const clone = cloneDefault(a) as Record<string, unknown>;
            const clonedB = clone.other as Record<string, unknown>;

            expect(clone.id).toBe('a');
            expect(clonedB.id).toBe('b');
            expect(clonedB).not.toBe(b);
            expect(clonedB.other).toBe(clone);
        });

        test('clones a cyclic array', () => {
            const arr: unknown[] = [1];
            arr.push(arr);

            const clone = cloneDefault(arr);

            expect(clone).not.toBe(arr);
            expect(clone[0]).toBe(1);
            expect(clone[1]).toBe(clone);
        });

        test('preserves a cycle reached through a symbol property', () => {
            const self = Symbol('self');
            const original: Record<PropertyKey, unknown> = { name: 'root' };
            original[self] = original;

            const clone = cloneDefault(original);

            expect(clone).not.toBe(original);
            expect(clone[self]).toBe(clone);
        });
    });

    // -------------------------------------------------------------------------
    // Cross-instance isolation — the reason cloneDefault exists
    // -------------------------------------------------------------------------

    describe('cross-instance isolation', () => {
        test('two clones of the same source do not share mutable state', () => {
            const token = Symbol('token');
            const source = { tags: ['x'], meta: { n: 1 }, [token]: { n: 1 } };

            const cloneA = cloneDefault(source);
            const cloneB = cloneDefault(source);

            cloneA.tags.push('y');
            cloneA.meta.n = 99;
            cloneA[token].n = 99;

            expect(cloneB.tags).toEqual(['x']);
            expect(cloneB.meta.n).toBe(1);
            expect(source.tags).toEqual(['x']);
            expect(source.meta.n).toBe(1);
            expect(cloneB[token].n).toBe(1);
            expect(source[token].n).toBe(1);
        });
    });
});
