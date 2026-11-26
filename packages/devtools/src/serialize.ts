// Serialization limits and snapshot semantics: model-reaction/docs/DEVTOOLS.md.
import type { DerivedValue, SerializedValue, Snapshot } from './protocol';

export interface SerializeOptions {
    maxDepth: number;
    maxItems: number;
    maxStringLength: number;
    maxNodes: number;
    /** Conservative upper bound on the UTF-8 JSON payload. */
    maxBytes: number;
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
    maxDepth: 6,
    maxItems: 100,
    maxStringLength: 10_000,
    maxNodes: 2_000,
    maxBytes: 256 * 1024,
};

const NODE_BYTES = 96;
const budgetMarker: SerializedValue = { t: 'truncated', note: 'serialization budget exhausted' };

class Budget {
    nodes: number;
    bytes: number;
    truncated = false;

    constructor(readonly options: SerializeOptions) {
        if (options.maxNodes < 1 || options.maxBytes < 256) {
            throw new RangeError('Serialization requires maxNodes >= 1 and maxBytes >= 256');
        }
        this.nodes = options.maxNodes;
        this.bytes = options.maxBytes - 128;
    }

    canTake(extraBytes = 0): boolean {
        return this.nodes >= 1 && this.bytes >= NODE_BYTES + extraBytes;
    }

    take(): boolean {
        if (!this.canTake()) {
            this.truncated = true;
            return false;
        }
        this.nodes--;
        this.bytes -= NODE_BYTES;
        return true;
    }

    text(value: string, reserveBytes = 0): string {
        // Six bytes per UTF-16 unit covers JSON escapes and UTF-8, without
        // constructing a second large string just to measure its wire size.
        const available = Math.max(0, Math.floor((this.bytes - reserveBytes - 2) / 6));
        const limit = Math.min(this.options.maxStringLength, available);
        let result = value;
        if (value.length > limit) {
            this.truncated = true;
            const suffix = `… (${value.length} chars)`;
            result = available >= suffix.length
                ? value.slice(0, Math.min(limit, available - suffix.length)) + suffix
                : suffix.slice(0, available);
        }
        this.bytes -= result.length * 6 + 2;
        return result;
    }

    key(value: string): boolean {
        const bytes = value.length * 6 + 8;
        if (value.length > this.options.maxStringLength || !this.canTake(bytes)) {
            this.truncated = true;
            return false;
        }
        this.bytes -= bytes;
        return true;
    }

    marker(note: string): SerializedValue {
        this.truncated = true;
        return { t: 'truncated', note };
    }
}

export function serializeValue(
    value: unknown,
    options: SerializeOptions = DEFAULT_SERIALIZE_OPTIONS
): SerializedValue {
    return serialize(() => value, new Budget(options), 0, new WeakSet());
}

function serialize(
    read: () => unknown,
    budget: Budget,
    depth: number,
    seen: WeakSet<object>
): SerializedValue {
    if (!budget.take()) return budgetMarker;
    try {
        return serializeReadable(read(), budget, depth, seen);
    } catch {
        return budget.marker('value could not be inspected');
    }
}

function serializeReadable(
    value: unknown,
    budget: Budget,
    depth: number,
    seen: WeakSet<object>
): SerializedValue {
    if (value === null) return { t: 'primitive', v: null };
    switch (typeof value) {
        case 'undefined': return { t: 'undefined' };
        case 'string': return { t: 'primitive', v: budget.text(value) };
        case 'number': {
            if (Number.isNaN(value)) return { t: 'number', v: 'NaN' };
            if (value === Infinity) return { t: 'number', v: 'Infinity' };
            if (value === -Infinity) return { t: 'number', v: '-Infinity' };
            if (Object.is(value, -0)) return { t: 'number', v: '-0' };
            return { t: 'primitive', v: value };
        }
        case 'boolean': return { t: 'primitive', v: value };
        case 'bigint': return { t: 'bigint', v: budget.text(value.toString()) };
        case 'symbol': return { t: 'symbol', v: budget.text(value.toString()) };
        case 'function': return { t: 'function', name: budget.text(value.name || '(anonymous)') };
    }
    if (value instanceof Date) {
        return { t: 'date', v: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString() };
    }
    if (value instanceof RegExp) {
        const flags = budget.text(value.flags);
        return { t: 'regexp', source: budget.text(value.source), flags };
    }
    if (seen.has(value as object)) return { t: 'circular' };
    if (depth >= budget.options.maxDepth) {
        return budget.marker(`max depth ${budget.options.maxDepth} reached`);
    }
    // Reserve one end marker before descending, so exhaustion never creates
    // one marker per skipped child or exceeds the node/byte budget.
    if (!budget.take()) return budgetMarker;
    seen.add(value as object);
    try {
        if (value instanceof Map) {
            const entries: Array<[SerializedValue, SerializedValue]> = [];
            const truncated = (note: string): SerializedValue => {
                budget.truncated = true;
                return { t: 'map', entries, note };
            };
            for (const [key, child] of Map.prototype.entries.call(value)) {
                if (entries.length >= budget.options.maxItems) {
                    return truncated(`${value.size - entries.length} more item(s)`);
                }
                if (!budget.canTake()) return truncated('serialization budget exhausted');
                const serializedKey = serialize(() => key, budget, depth + 1, seen);
                // A complex key may exhaust the budget; never emit half a pair.
                if (!budget.canTake()) return truncated('serialization budget exhausted');
                entries.push([serializedKey, serialize(() => child, budget, depth + 1, seen)]);
            }
            return { t: 'map', entries };
        }
        if (value instanceof Set) {
            const items: SerializedValue[] = [];
            for (const child of Set.prototype.values.call(value)) {
                if (items.length >= budget.options.maxItems) {
                    items.push(budget.marker(`${value.size - items.length} more item(s)`));
                    break;
                }
                if (!budget.canTake()) {
                    items.push(budget.marker('serialization budget exhausted'));
                    break;
                }
                items.push(serialize(() => child, budget, depth + 1, seen));
            }
            return { t: 'set', items };
        }
        if (Array.isArray(value)) {
            const items: SerializedValue[] = [];
            const limit = Math.min(value.length, budget.options.maxItems);
            for (let i = 0; i < limit; i++) {
                if (!budget.canTake()) {
                    items.push(budget.marker('serialization budget exhausted'));
                    return { t: 'array', items };
                }
                items.push(serialize(() => value[i], budget, depth + 1, seen));
            }
            if (value.length > limit) {
                items.push(budget.marker(`${value.length - limit} more item(s)`));
            }
            return { t: 'array', items };
        }
        const entries: Array<[string, SerializedValue]> = [];
        const record = value as Record<string | symbol, unknown>;
        for (const key of ownValueKeys(record)) {
            if (entries.length >= budget.options.maxItems) {
                entries.push(['…', budget.marker('object keys truncated')]);
                break;
            }
            if (!budget.canTake(10)) {
                entries.push(['…', budget.marker('serialization budget exhausted')]);
                break;
            }
            budget.bytes -= 8;
            const label = budget.text(typeof key === 'symbol' ? key.toString() : key, NODE_BYTES);
            entries.push([label, serialize(() => record[key], budget, depth + 1, seen)]);
        }
        return { t: 'object', entries };
    } finally {
        seen.delete(value as object);
    }
}

function* ownKeys(record: Record<string, unknown>): Generator<string> {
    for (const key in record) {
        if (Object.prototype.hasOwnProperty.call(record, key)) yield key;
    }
}

function* ownValueKeys(record: Record<string | symbol, unknown>): Generator<string | symbol> {
    yield* ownKeys(record);
    for (const key of Object.getOwnPropertySymbols(record)) {
        if (Object.prototype.propertyIsEnumerable.call(record, key)) yield key;
    }
}

function recordValues(record: Record<string, unknown>, budget: Budget): Record<string, SerializedValue> {
    const out: Record<string, SerializedValue> = {};
    let count = 0;
    for (const key of ownKeys(record)) {
        if (count++ >= budget.options.maxItems || !budget.key(key)) {
            budget.truncated = true;
            break;
        }
        Object.defineProperty(out, key, {
            value: serialize(() => record[key], budget, 0, new WeakSet()),
            enumerable: true,
        });
    }
    return out;
}

export function serializeRecord(
    record: Record<string, unknown>,
    options: SerializeOptions = DEFAULT_SERIALIZE_OPTIONS
): Record<string, SerializedValue> {
    return recordValues(record, new Budget(options));
}

export function serializeSnapshot(
    raw: {
        data: Record<string, unknown>;
        dirtyData: Record<string, unknown>;
        errors: Snapshot['errors'];
        derivedValues?: Array<Omit<DerivedValue, 'value'> & { value: unknown }>;
    },
    options: SerializeOptions = DEFAULT_SERIALIZE_OPTIONS
): Snapshot {
    const budget = new Budget(options);
    const data = recordValues(raw.data, budget);
    const dirtyData = recordValues(raw.dirtyData, budget);
    const errors: Snapshot['errors'] = {};
    let count = 0;
    for (const key of ownKeys(raw.errors)) {
        if (count++ >= options.maxItems || !budget.key(key) || !budget.take()) {
            budget.truncated = true;
            break;
        }
        const list: Snapshot['errors'][string] = [];
        for (const error of raw.errors[key]!) {
            if (list.length >= options.maxItems || !budget.take()) {
                budget.truncated = true;
                break;
            }
            list.push({
                field: budget.text(error.field),
                message: budget.text(error.message),
                ...(error.rule === undefined ? {} : { rule: budget.text(error.rule) }),
            });
        }
        Object.defineProperty(errors, key, { value: list, enumerable: true });
    }
    const derivedValues: DerivedValue[] = [];
    for (const entry of raw.derivedValues ?? []) {
        if (derivedValues.length >= options.maxItems || !budget.take() || !budget.take()) {
            budget.truncated = true;
            break;
        }
        const debugName = entry.debugName === undefined
            ? undefined : budget.text(entry.debugName, NODE_BYTES);
        const fields: string[] = [];
        for (const field of entry.fields ?? []) {
            if (fields.length >= options.maxItems || !budget.key(field) || !budget.take()) {
                budget.truncated = true;
                break;
            }
            fields.push(field);
        }
        const value = serialize(() => entry.value, budget, 0, new WeakSet());
        derivedValues.push({
            id: entry.id, kind: entry.kind, value,
            ...(debugName === undefined ? {} : { debugName }),
            ...(entry.fields === undefined ? {} : { fields }),
        });
    }
    return {
        data, dirtyData, errors,
        ...(raw.derivedValues === undefined ? {} : { derivedValues }),
        ...(budget.truncated ? { truncated: true } : {}),
    };
}
