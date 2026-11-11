import {
    serializeValue,
    serializeRecord,
    serializeSnapshot,
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

    test('invalid date serializes to an explicit marker', () => {
        expect(serializeValue(new Date(Number.NaN))).toEqual({
            t: 'date',
            v: 'Invalid Date',
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

    test('bounds repeated expansion of a shared DAG', () => {
        let shared: unknown = 'leaf';
        for (let i = 0; i < 6; i++) shared = Array(6).fill(shared);
        const json = JSON.stringify(serializeValue(shared));
        expect(Buffer.byteLength(json)).toBeLessThanOrEqual(256 * 1024);
        expect(json).toContain('truncated');
        expect(json).not.toContain('circular');
        expect(json.match(/"t":/g)?.length).toBeLessThanOrEqual(DEFAULT_SERIALIZE_OPTIONS.maxNodes);
    });

    test('stops reading children once the node budget is exhausted', () => {
        const read = jest.fn(() => 'value');
        const object = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i, null]));
        for (const key of Object.keys(object)) Object.defineProperty(object, key, { get: read });
        const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxNodes: 5 };
        const json = JSON.stringify(serializeValue(object, options));
        expect(read).toHaveBeenCalledTimes(3);
        expect(json.match(/"t":/g)).toHaveLength(5);
        expect(json).toContain('serialization budget exhausted');
    });

    test('bounds escaped and multibyte keys and strings', () => {
        const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxBytes: 2048 };
        const text = '汉字\\\"\u0000'.repeat(1000);
        const json = JSON.stringify(serializeValue({ [text]: text }, options));
        expect(Buffer.byteLength(json)).toBeLessThanOrEqual(options.maxBytes);
        expect(json).toContain('chars');
    });
});

describe('serializeRecord', () => {
    test('serializes each value of a record', () => {
        expect(serializeRecord({ a: 1, b: 'two' })).toEqual({
            a: { t: 'primitive', v: 1 },
            b: { t: 'primitive', v: 'two' },
        });
    });

    test('preserves an own __proto__ field as transport data', () => {
        const result = serializeRecord(JSON.parse('{"__proto__": 42}'));
        expect(Object.keys(result)).toEqual(['__proto__']);
        expect(result.__proto__).toEqual({ t: 'primitive', v: 42 });
    });
});

describe('serializeSnapshot', () => {
    test('shares one budget across committed, dirty, and error values', () => {
        const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxBytes: 2048 };
        const snapshot = serializeSnapshot({
            data: { a: '汉字'.repeat(1000), b: 'text'.repeat(1000) },
            dirtyData: { a: 'invalid'.repeat(1000) },
            errors: { a: [{ field: 'a', message: 'error'.repeat(1000) }] },
        }, options);
        expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(options.maxBytes);
        expect(snapshot.truncated).toBe(true);
    });

    test('caps error lists and their text within the same wire budget', () => {
        const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 2, maxStringLength: 5, maxBytes: 2048 };
        const error = { field: 'field'.repeat(50), message: '错误\0'.repeat(50), rule: 'rule'.repeat(50) };
        const snapshot = serializeSnapshot({ data: {}, dirtyData: {}, errors: { a: [error, error, error] } }, options);
        expect(snapshot.errors.a).toHaveLength(2);
        expect(snapshot.errors.a?.[0]?.message).toContain('chars');
        expect(snapshot.truncated).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(options.maxBytes);
    });

    test('signals omitted top-level fields without inventing a field name', () => {
        const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 1 };
        const snapshot = serializeSnapshot({
            data: { a: 1, b: 2 }, dirtyData: {}, errors: {},
        }, options);
        expect(snapshot.data).toEqual({ a: { t: 'primitive', v: 1 } });
        expect(snapshot.truncated).toBe(true);
    });
});
