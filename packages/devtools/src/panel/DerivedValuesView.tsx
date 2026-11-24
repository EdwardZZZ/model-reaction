import type { ReactElement } from 'react';
import type { DerivedValue } from '../protocol';
import { ValueTree } from './ValueTree';

export function derivedLabel(entry: DerivedValue, limit = 64): string {
    const label = entry.debugName?.replace(/\s+/g, ' ').trim() || `${entry.kind} #${entry.id}`;
    return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

export function DerivedValuesView({
    values,
    truncated = false,
}: {
    values: DerivedValue[] | undefined;
    truncated?: boolean;
}): ReactElement {
    return (
        <section className="mrd-section mrd-derived" aria-label="React derived values">
            <h3 className="mrd-section-title">
                <span>React derived values</span>
                <span className="mrd-badge">{values?.length ?? '—'}</span>
                <span className="mrd-section-subtitle">last committed renders</span>
            </h3>
            <div className="mrd-section-body">
                {truncated && (
                    <div className="mrd-empty" role="status">
                        Snapshot truncated to fit size limits. Derived values may be omitted or clipped.
                    </div>
                )}
                {values === undefined ? (
                    <div className="mrd-empty" role="status">
                        Derived values are unavailable for this model. Reload the extension and inspected
                        page with the latest model-reaction build.
                    </div>
                ) : values.length === 0 ? (
                    <div className="mrd-empty">no mounted selector hooks</div>
                ) : values.map((entry) => (
                    <div key={entry.id} className="mrd-derived-entry" title={entry.debugName || `${entry.kind} #${entry.id}`}>
                        <div className="mrd-derived-meta">{entry.kind} · #{entry.id}</div>
                        <ValueTree
                            value={entry.value}
                            label={derivedLabel(entry)}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}
