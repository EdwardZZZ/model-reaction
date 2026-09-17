/**
 * Convert arbitrary model values into the transport-safe {@link SerializedValue}
 * tree defined by the protocol.
 *
 * Model `data` can hold anything a user puts in it — nested objects, arrays,
 * Dates, functions, cyclic references, huge blobs. This module flattens all of
 * that into a JSON-safe, self-describing shape the panel can render, while
 * guarding against the three ways a naive serializer blows up:
 *
 *   1. **Cycles** → tracked with a `WeakSet`, emitted as `{ t: 'circular' }`.
 *   2. **Unbounded depth** → capped by `maxDepth`.
 *   3. **Unbounded breadth** → object keys / array items capped by `maxItems`.
 *
 * Depth / breadth limits are conservative defaults; surfacing them as user
 * settings is deferred (TBD, see README).
 */
import type { SerializedValue } from './protocol';

export interface SerializeOptions {
    /** Maximum nesting depth before emitting a `truncated` marker. */
    maxDepth: number;
    /** Maximum entries per object / array before truncating. */
    maxItems: number;
    /** Maximum length of a serialized string before it is clipped. */
    maxStringLength: number;
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
    maxDepth: 6,
    maxItems: 100,
    maxStringLength: 10_000,
};

export function serializeValue(
    value: unknown,
    options: SerializeOptions = DEFAULT_SERIALIZE_OPTIONS
): SerializedValue {
    return serialize(value, options, 0, new WeakSet());
}

function serialize(
    value: unknown,
    options: SerializeOptions,
    depth: number,
    seen: WeakSet<object>
): SerializedValue {
    if (value === null) return { t: 'primitive', v: null };

    switch (typeof value) {
        case 'undefined':
            return { t: 'undefined' };
        case 'string':
            return {
                t: 'primitive',
                v:
                    value.length > options.maxStringLength
                        ? `${value.slice(0, options.maxStringLength)}… (${value.length} chars)`
                        : value,
            };
        case 'number':
        case 'boolean':
            return { t: 'primitive', v: value };
        case 'bigint':
            return { t: 'bigint', v: value.toString() };
        case 'symbol':
            return { t: 'symbol', v: value.toString() };
        case 'function':
            return { t: 'function', name: value.name || '(anonymous)' };
    }

    // From here on `value` is a non-null object.
    if (value instanceof Date) {
        return { t: 'date', v: value.toISOString() };
    }

    if (seen.has(value as object)) return { t: 'circular' };

    if (depth >= options.maxDepth) {
        return { t: 'truncated', note: `max depth ${options.maxDepth} reached` };
    }

    seen.add(value as object);
    try {
        if (Array.isArray(value)) {
            return serializeArray(value, options, depth, seen);
        }
        return serializeObject(value as Record<string, unknown>, options, depth, seen);
    } finally {
        // Allow the same object to appear in sibling branches (only true cycles
        // along the current path should be flagged).
        seen.delete(value as object);
    }
}

function serializeArray(
    value: unknown[],
    options: SerializeOptions,
    depth: number,
    seen: WeakSet<object>
): SerializedValue {
    const limit = Math.min(value.length, options.maxItems);
    const items: SerializedValue[] = [];
    for (let i = 0; i < limit; i++) {
        items.push(serialize(value[i], options, depth + 1, seen));
    }
    if (value.length > options.maxItems) {
        items.push({
            t: 'truncated',
            note: `${value.length - options.maxItems} more item(s)`,
        });
    }
    return { t: 'array', items };
}

function serializeObject(
    value: Record<string, unknown>,
    options: SerializeOptions,
    depth: number,
    seen: WeakSet<object>
): SerializedValue {
    const keys = Object.keys(value);
    const limit = Math.min(keys.length, options.maxItems);
    const entries: Array<[string, SerializedValue]> = [];
    for (let i = 0; i < limit; i++) {
        const key = keys[i] as string;
        entries.push([key, serialize(value[key], options, depth + 1, seen)]);
    }
    if (keys.length > options.maxItems) {
        entries.push([
            `… ${keys.length - options.maxItems} more`,
            { t: 'truncated', note: 'object keys truncated' },
        ]);
    }
    return { t: 'object', entries };
}

/** Serialize every value of a `Record` in one pass (used for snapshots). */
export function serializeRecord(
    record: Record<string, unknown>,
    options: SerializeOptions = DEFAULT_SERIALIZE_OPTIONS
): Record<string, SerializedValue> {
    const out: Record<string, SerializedValue> = {};
    for (const [key, value] of Object.entries(record)) {
        out[key] = serializeValue(value, options);
    }
    return out;
}
