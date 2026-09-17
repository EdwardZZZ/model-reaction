import {
    serializeValue,
    serializeRecord,
    DEFAULT_SERIALIZE_OPTIONS,
    type SerializeOptions,
} from '../serialize';

describe('serializeValue', () => {
    test('primitives', () => {
        expect(serializeValue('hi')).toEqual({ t: 'primitive', v: 'hi' });
        expect(serializeValue(42)).toEqual({ t: 'primitive', v: 42 });
        expect(serializeValue(true)).toEqual({ t: 'primitive', v: true });
        expect(serializeValue(null)).toEqual({ t: 'primitive', v: null });
    });

    test('undefined, bigint, symbol, function', () => {
        expect(serializeValue(undefined)).toEqual({ t: 'undefined' });
        expect(serializeValue(10n)).toEqual({ t: 'bigint', v: '10' });
        expect(serializeValue(Symbol('s'))).toEqual({
            t: 'symbol',
            v: 'Symbol(s)',
        });
        expect(serializeValue(function foo() {})).toEqual({
            t: 'function',
            name: 'foo',
        });
        expect(serializeValue(() => {})).toEqual({
            t: 'function',
            name: '(anonymous)',
        });
    });

    test('date serializes to ISO string', () => {
        const d = new Date('2020-01-02T03:04:05.000Z');
        expect(serializeValue(d)).toEqual({
            t: 'date',
            v: '2020-01-02T03:04:05.000Z',
        });
    });

    test('nested object and array', () => {
        const result = serializeValue({ a: [1, 'x'], b: { c: true } });
        expect(result).toEqual({
            t: 'object',
            entries: [
                [
                    'a',
                    {
                        t: 'array',
                        items: [
                            { t: 'primitive', v: 1 },
                            { t: 'primitive', v: 'x' },
                        ],
                    },
                ],
                [
                    'b',
                    {
                        t: 'object',
                        entries: [['c', { t: 'primitive', v: true }]],
                    },
                ],
            ],
        });
    });

    test('detects direct cycles', () => {
        const obj: Record<string, unknown> = { name: 'root' };
        obj.self = obj;
        const result = serializeValue(obj) as {
            t: 'object';
            entries: Array<[string, { t: string }]>;
        };
        const selfEntry = result.entries.find(([k]) => k === 'self');
        expect(selfEntry?.[1]).toEqual({ t: 'circular' });
    });

    test('same object in sibling branches is not a false cycle', () => {
        const shared = { x: 1 };
        const result = serializeValue({ a: shared, b: shared }) as {
            t: 'object';
            entries: Array<[string, { t: string }]>;
        };
        // Neither branch should be flagged circular — they are siblings, not a
        // cycle along one path.
        expect(result.entries.every(([, v]) => v.t === 'object')).toBe(true);
    });

    test('caps depth', () => {
        const opts: SerializeOptions = { ...DEFAULT_SERIALIZE_OPTIONS, maxDepth: 2 };
        const deep = { l1: { l2: { l3: { l4: 'too deep' } } } };
        const result = JSON.stringify(serializeValue(deep, opts));
        expect(result).toContain('max depth 2 reached');
    });

    test('caps object breadth', () => {
        const opts: SerializeOptions = { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 2 };
        const wide = { a: 1, b: 2, c: 3, d: 4 };
        const result = serializeValue(wide, opts) as {
            t: 'object';
            entries: Array<[string, { t: string }]>;
        };
        // 2 real entries + 1 truncation marker.
        expect(result.entries).toHaveLength(3);
        expect(result.entries[2]![1].t).toBe('truncated');
    });

    test('caps array breadth', () => {
        const opts: SerializeOptions = { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 2 };
        const result = serializeValue([1, 2, 3, 4, 5], opts) as {
            t: 'array';
            items: Array<{ t: string; note?: string }>;
        };
        expect(result.items).toHaveLength(3);
        expect(result.items[2]!.t).toBe('truncated');
        expect(result.items[2]!.note).toContain('3 more');
    });

    test('clips long strings', () => {
        const opts: SerializeOptions = { ...DEFAULT_SERIALIZE_OPTIONS, maxStringLength: 5 };
        const result = serializeValue('abcdefghij', opts) as {
            t: 'primitive';
            v: string;
        };
        expect(result.v).toContain('abcde');
        expect(result.v).toContain('10 chars');
    });
});

describe('serializeRecord', () => {
    test('serializes each value of a record', () => {
        expect(serializeRecord({ a: 1, b: 'two' })).toEqual({
            a: { t: 'primitive', v: 1 },
            b: { t: 'primitive', v: 'two' },
        });
    });
});
