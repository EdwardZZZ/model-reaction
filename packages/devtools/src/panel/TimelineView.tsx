/**
 * Change-timeline view: a reverse-chronological list of committed field
 * changes. Selecting an entry shows the field's value at that point next to its
 * previous value (the prior change to the same field), so you can see what each
 * commit did.
 *
 * This is deliberately **read-only**: replaying a value back into the model
 * (true time-travel) is out of scope for now because it would re-trigger
 * reactions and could poison `dirtyData` — see the README "Limitations (TBD)".
 */
import { useState, type ReactElement } from 'react';
import type { ChangeEntry, InstanceState } from '../protocol';
import { ValueTree } from './ValueTree';

interface TimelineViewProps {
    instance: InstanceState;
}

export function TimelineView({ instance }: TimelineViewProps): ReactElement {
    const { timeline } = instance;
    const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

    if (timeline.length === 0) {
        return <div className="mrd-empty">No changes recorded yet — edit a field to see it here.</div>;
    }

    // Newest first for display.
    const ordered = [...timeline].sort((a, b) => b.seq - a.seq);
    const selected =
        selectedSeq === null ? null : timeline.find((c) => c.seq === selectedSeq) ?? null;
    const previous = selected ? findPrevious(timeline, selected) : null;

    return (
        <div className="mrd-timeline">
            <ol className="mrd-timeline-list">
                {ordered.map((change) => (
                    <li
                        key={change.seq}
                        className={`mrd-timeline-item${
                            change.seq === selectedSeq ? ' mrd-timeline-item-active' : ''
                        }`}
                        onClick={() => setSelectedSeq(change.seq)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') setSelectedSeq(change.seq);
                        }}
                    >
                        <span className="mrd-timeline-seq">#{change.seq}</span>
                        <span className="mrd-timeline-field">{change.field}</span>
                        <span className="mrd-timeline-time">{formatTime(change.timestamp)}</span>
                    </li>
                ))}
            </ol>

            <div className="mrd-timeline-detail">
                {selected ? (
                    <>
                        <h4>
                            {selected.field} <span className="mrd-badge">#{selected.seq}</span>
                        </h4>
                        <div className="mrd-diff">
                            <div className="mrd-diff-col">
                                <div className="mrd-diff-label">previous</div>
                                {previous ? (
                                    <ValueTree value={previous.value} />
                                ) : (
                                    <div className="mrd-empty">no earlier value</div>
                                )}
                            </div>
                            <div className="mrd-diff-col">
                                <div className="mrd-diff-label">this change</div>
                                <ValueTree value={selected.value} />
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="mrd-empty">Select a change to inspect it.</div>
                )}
            </div>
        </div>
    );
}

/** Find the most recent earlier change to the same field. */
function findPrevious(timeline: ChangeEntry[], change: ChangeEntry): ChangeEntry | null {
    let prev: ChangeEntry | null = null;
    for (const c of timeline) {
        if (c.field === change.field && c.seq < change.seq) {
            if (!prev || c.seq > prev.seq) prev = c;
        }
    }
    return prev;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false }) + `.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
