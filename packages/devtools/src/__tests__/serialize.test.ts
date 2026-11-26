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

    test.each([
        [NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity'], [-0, '-0'],
    ])('preserves %p across JSON transport', (value, label) => {
        expect(JSON.parse(JSON.stringify(serializeValue(value)))).toEqual({ t: 'number', v: label });
        expect(JSON.parse(JSON.stringify(serializeValue(0)))).toEqual({ t: 'primitive', v: 0 });
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

    test('preserves Map keys, Set members, and RegExp source and flags after JSON transport', () => {
        const value = new Map<unknown, unknown>([
            [{ id: 1 }, new Set(['paid', 42])],
            ['pattern', /invoice/gi],
        ]);
        expect(JSON.parse(JSON.stringify(serializeValue(value)))).toEqual({
            t: 'map',
            entries: [
                [
                    { t: 'object', entries: [['id', { t: 'primitive', v: 1 }]] },
                    { t: 'set', items: [{ t: 'primitive', v: 'paid' }, { t: 'primitive', v: 42 }] },
                ],
                [{ t: 'primitive', v: 'pattern' }, { t: 'regexp', source: 'invoice', flags: 'gi' }],
            ],
        });
        expect(serializeValue(new Map())).toEqual({ t: 'map', entries: [] });
        expect(serializeValue(new Set())).toEqual({ t: 'set', items: [] });
    });

    test('detects Map and Set cycles without treating shared members as circular', () => {
        const shared = { count: 1 };
        const map = new Map<unknown, unknown>([[shared, shared]]);
        const set = new Set<unknown>([map]);
        map.set(map, set);
        const json = JSON.stringify(serializeValue(map));
        expect(json.match(/"t":"object"/g)).toHaveLength(2);
        expect(json.match(/"t":"circular"/g)).toHaveLength(2);
        expect(json).toContain('"t":"set"');
    });

    test.each(['map', 'set'] as const)('bounds %s depth and breadth', (kind) => {
        const values = [1, 2, 3, 4];
        const value = kind === 'map'
            ? new Map(values.map((n) => [n, n]))
            : new Set(values);
        const result = serializeValue(value, { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 2 });
        expect(JSON.stringify(result)).toContain('2 more item(s)');
        expect(JSON.stringify(result).match(/"t":"primitive"/g)).toHaveLength(kind === 'map' ? 4 : 2);
        expect(JSON.stringify(serializeValue(value, { ...DEFAULT_SERIALIZE_OPTIONS, maxDepth: 0 })))
            .toContain('max depth 0 reached');
    });

    test('replaces unreadable leaves while retaining their readable siblings', () => {
        const unreadable = { get value() { throw new Error('not loaded'); }, healthy: 7 };
        expect(serializeValue(unreadable)).toEqual({
            t: 'object',
            entries: [
                ['value', { t: 'truncated', note: 'value could not be inspected' }],
                ['healthy', { t: 'primitive', v: 7 }],
            ],
        });
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        expect(serializeValue(revoked.proxy)).toEqual({
            t: 'truncated', note: 'value could not be inspected',
        });
        const array = [0, 7];
        Object.defineProperty(array, 0, { get() { throw new Error('not loaded'); } });
        expect(serializeValue(array)).toEqual({
            t: 'array',
            items: [
                { t: 'truncated', note: 'value could not be inspected' },
                { t: 'primitive', v: 7 },
            ],
        });
    });

    test('contains unreadable collection keys and members without losing later entries', () => {
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        const marker = { t: 'truncated', note: 'value could not be inspected' };
        expect(serializeValue(new Map<unknown, unknown>([
            [revoked.proxy, 7], ['healthy', 42],
        ]))).toEqual({
            t: 'map',
            entries: [
                [marker, { t: 'primitive', v: 7 }],
                [{ t: 'primitive', v: 'healthy' }, { t: 'primitive', v: 42 }],
            ],
        });
        expect(serializeValue(new Set([revoked.proxy, 7]))).toEqual({
            t: 'set', items: [marker, { t: 'primitive', v: 7 }],
        });
    });

    test('does not inspect a Map value when its key exhausts the node budget', () => {
        const read = jest.fn(() => 'unneeded');
        const value = Object.defineProperty({}, 'payload', { enumerable: true, get: read });
        expect(serializeValue(new Map([[{ id: 1 }, value]]), {
            ...DEFAULT_SERIALIZE_OPTIONS, maxNodes: 5,
        })).toEqual({ t: 'map', entries: [], note: 'serialization budget exhausted' });
        expect(read).not.toHaveBeenCalled();
    });

    test('shares node and byte budgets across collection keys, values, and unreadable leaves', () => {
        const text = '\0'.repeat(20_000);
        const unreadable = { get value() { throw new Error('not loaded'); } };
        const shared = new Set([unreadable, text]);
        const values = [
            new Map(Array.from({ length: 100 }, (_, i) => [i, shared])),
            new Set(Array.from({ length: 100 }, (_, i) => new Map([[i, text]]))),
            new RegExp('a'.repeat(20_000), 'gi'),
        ];
        for (const maxBytes of [256, 512, 2048, 262144]) {
            for (const maxNodes of [1, 2, 3, 5, 10, 2000]) {
                const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxBytes, maxNodes };
                for (const value of values) {
                    const json = JSON.stringify(serializeValue(value, options));
                    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(maxBytes);
                    expect(json.match(/"t":/g)!.length).toBeLessThanOrEqual(maxNodes);
                    const snapshot = serializeSnapshot({
                        data: { value }, dirtyData: { value }, errors: {},
                        derivedValues: [{ id: 1, kind: 'useModelSelector', value }],
                    }, options);
                    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(maxBytes);
                    expect(snapshot.truncated).toBe(true);
                }
            }
        }
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

    test('includes only own enumerable symbol keys in nested objects within the item budget', () => {
        const own = Symbol('own');
        const hidden = Symbol('hidden');
        const inherited = Symbol('inherited');
        const readExcluded = jest.fn(() => { throw new Error('must not inspect'); });
        const prototype = Object.defineProperty({}, inherited, { enumerable: true, get: readExcluded });
        const value = Object.assign(Object.create(prototype), { visible: 1, [own]: 2 });
        Object.defineProperty(value, hidden, { get: readExcluded });
        expect(serializeValue(value)).toEqual({
            t: 'object',
            entries: [
                ['visible', { t: 'primitive', v: 1 }],
                ['Symbol(own)', { t: 'primitive', v: 2 }],
            ],
        });
        expect(readExcluded).not.toHaveBeenCalled();
        expect(serializeValue(value, { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 1 })).toEqual({
            t: 'object',
            entries: [
                ['visible', { t: 'primitive', v: 1 }],
                ['…', { t: 'truncated', note: 'object keys truncated' }],
            ],
        });
        expect(serializeRecord(value)).toEqual({ visible: { t: 'primitive', v: 1 } });
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
    test('contains a throwing field getter without dropping healthy fields', () => {
        expect(serializeRecord({
            get unreadable() { throw new Error('not loaded'); },
            healthy: 7,
        })).toEqual({
            unreadable: { t: 'truncated', note: 'value could not be inspected' },
            healthy: { t: 'primitive', v: 7 },
        });
    });

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
    test('preserves exact dependency names and budgets their count and bytes', () => {
        const fields = ['__proto__', 'constructor', 'a"b', 'a,b', '0'];
        const raw = {
            data: {}, dirtyData: {}, errors: {},
            derivedValues: [
                { id: 1, kind: 'useModelComputed' as const, value: 2, fields },
                { id: 2, kind: 'useModelComputed' as const, value: 2, fields: [] },
                { id: 3, kind: 'useModelComputed' as const, value: 2 },
            ],
        };
        const snapshot = JSON.parse(JSON.stringify(serializeSnapshot(raw)));
        expect(snapshot.derivedValues[0].fields).toEqual(fields);
        expect(snapshot.derivedValues[1].fields).toEqual([]);
        expect(snapshot.derivedValues[2]).not.toHaveProperty('fields');
        const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 2, maxBytes: 2048 };
        const capped = serializeSnapshot(raw, options);
        expect(capped.derivedValues![0]!.fields).toEqual(fields.slice(0, 2));
        expect(capped.truncated).toBe(true);
        const long = serializeSnapshot({
            ...raw, derivedValues: [{
                ...raw.derivedValues[0]!, fields: ['\0'.repeat(5000)],
            }],
        }, options);
        expect(long.derivedValues![0]!.fields).toEqual([]);
        expect(long.truncated).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(long))).toBeLessThanOrEqual(options.maxBytes);
    });

    test('serializes derived values and names within the shared snapshot budget', () => {
        const options = { ...DEFAULT_SERIALIZE_OPTIONS, maxBytes: 2048, maxItems: 2 };
        const derivedValues = Array.from({ length: 20 }, (_, id) => ({
            id, kind: 'useModelComputed' as const,
            debugName: '派生\0'.repeat(1000), value: '值'.repeat(1000),
        }));
        const snapshot = serializeSnapshot({ data: { count: 1 }, dirtyData: {}, errors: {}, derivedValues }, options);
        expect(snapshot.data.count).toEqual({ t: 'primitive', v: 1 });
        expect(snapshot.derivedValues!.length).toBeGreaterThan(0);
        expect(snapshot.derivedValues!.length).toBeLessThanOrEqual(2);
        expect(snapshot.truncated).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(options.maxBytes);
    });

    test('preserves exceptional derived values and contains failed inspection', () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        const unreadable = { get value() { throw new Error('cannot inspect'); } };
        const snapshot = JSON.parse(JSON.stringify(serializeSnapshot({
            data: {}, dirtyData: {}, errors: {},
            derivedValues: [NaN, undefined, cycle, unreadable].map((value, id) => ({
                id, kind: 'useModelSelector', value,
            })),
        })));
        expect(snapshot.derivedValues[0].value).toEqual({ t: 'number', v: 'NaN' });
        expect(snapshot.derivedValues[1].value).toEqual({ t: 'undefined' });
        expect(snapshot.derivedValues[2].value.entries[0][1]).toEqual({ t: 'circular' });
        expect(snapshot.derivedValues[3].value).toEqual({
            t: 'object',
            entries: [['value', { t: 'truncated', note: 'value could not be inspected' }]],
        });
        expect(snapshot.truncated).toBe(true);
    });

    test('isolates unreadable committed and dirty values with the same fallback as observations', () => {
        const value = { get unloaded() { throw new Error('not loaded'); }, readable: 1 };
        const snapshot = serializeSnapshot({
            data: { value, healthy: 7 }, dirtyData: { value }, errors: {},
            derivedValues: [{ id: 1, kind: 'useModelSelector', value }],
        });
        const expected = {
            t: 'object',
            entries: [
                ['unloaded', { t: 'truncated', note: 'value could not be inspected' }],
                ['readable', { t: 'primitive', v: 1 }],
            ],
        };
        expect(snapshot.data.value).toEqual(expected);
        expect(snapshot.dirtyData.value).toEqual(expected);
        expect(snapshot.derivedValues![0]!.value).toEqual(expected);
        expect(snapshot.data.healthy).toEqual({ t: 'primitive', v: 7 });
        expect(snapshot.truncated).toBe(true);
    });

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
