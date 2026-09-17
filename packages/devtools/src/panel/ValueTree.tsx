/**
 * Recursive renderer for a {@link SerializedValue} tree. Objects and arrays are
 * collapsible; leaves are rendered with a type-appropriate CSS class so the
 * panel stylesheet can color them.
 *
 * Pure and self-contained: it takes a already-serialized value (never a live
 * model value), so it can be unit-tested with plain data.
 */
import { useState, type ReactElement } from 'react';
import type { SerializedValue } from '../protocol';

interface ValueTreeProps {
    value: SerializedValue;
    /** Property/index label shown before the value, if any. */
    label?: string | undefined;
    /** Nesting depth; controls the initial collapsed state of deep nodes. */
    depth?: number | undefined;
}

export function ValueTree({ value, label, depth = 0 }: ValueTreeProps): ReactElement {
    if (value.t === 'object' || value.t === 'array') {
        return <BranchNode value={value} label={label} depth={depth} />;
    }
    return (
        <div className="mrd-tree-row" style={{ paddingLeft: depth * 12 }}>
            {label !== undefined && <span className="mrd-tree-key">{label}: </span>}
            <LeafValue value={value} />
        </div>
    );
}

function BranchNode({
    value,
    label,
    depth = 0,
}: {
    value: Extract<SerializedValue, { t: 'object' | 'array' }>;
    label?: string | undefined;
    depth?: number | undefined;
}): ReactElement {
    // Collapse deep nodes by default to keep large trees readable.
    const [open, setOpen] = useState(depth < 1);
    const isArray = value.t === 'array';
    const children = isArray ? value.items : value.entries;
    const count = children.length;
    const summary = isArray ? `Array(${count})` : `Object{${count}}`;

    return (
        <div className="mrd-tree-branch" style={{ paddingLeft: depth * 12 }}>
            <div
                className="mrd-tree-row mrd-tree-toggle"
                onClick={() => setOpen((o) => !o)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o);
                }}
            >
                <span className="mrd-tree-caret">{open ? '▾' : '▸'}</span>
                {label !== undefined && <span className="mrd-tree-key">{label}: </span>}
                <span className="mrd-tree-summary">{summary}</span>
            </div>
            {open &&
                (isArray
                    ? value.items.map((item, i) => (
                          <ValueTree key={i} value={item} label={String(i)} depth={depth + 1} />
                      ))
                    : value.entries.map(([key, child]) => (
                          <ValueTree key={key} value={child} label={key} depth={depth + 1} />
                      )))}
        </div>
    );
}

function LeafValue({ value }: { value: SerializedValue }): ReactElement {
    switch (value.t) {
        case 'primitive':
            if (value.v === null) return <span className="mrd-val-null">null</span>;
            if (typeof value.v === 'string')
                return <span className="mrd-val-string">&quot;{value.v}&quot;</span>;
            if (typeof value.v === 'boolean')
                return <span className="mrd-val-boolean">{String(value.v)}</span>;
            return <span className="mrd-val-number">{String(value.v)}</span>;
        case 'undefined':
            return <span className="mrd-val-undefined">undefined</span>;
        case 'bigint':
            return <span className="mrd-val-number">{value.v}n</span>;
        case 'date':
            return <span className="mrd-val-date">{value.v}</span>;
        case 'function':
            return <span className="mrd-val-function">ƒ {value.name}()</span>;
        case 'symbol':
            return <span className="mrd-val-symbol">{value.v}</span>;
        case 'circular':
            return <span className="mrd-val-special">[Circular]</span>;
        case 'truncated':
            return <span className="mrd-val-special">… {value.note}</span>;
        // Object/array are handled by BranchNode; keep the switch exhaustive.
        case 'object':
        case 'array':
            return <span className="mrd-val-special">{value.t}</span>;
    }
}
