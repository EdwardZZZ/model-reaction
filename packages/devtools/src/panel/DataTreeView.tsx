import type { ReactElement } from 'react';
import type { InstanceState } from '../protocol';
import { ValueTree } from './ValueTree';

/** Render committed data from the current instance snapshot. */
export function DataTreeView({ instance }: { instance: InstanceState }): ReactElement {
    const { data, truncated } = instance.snapshot;
    const keys = Object.keys(data);
    return (
        <div className="mrd-datatree">
            {truncated && (
                <div className="mrd-empty" role="status">
                    Snapshot truncated to fit size limits. Values or fields may be omitted.
                </div>
            )}
            <section className="mrd-section">
                <h3 className="mrd-section-title">
                    data
                    <span className="mrd-badge">{keys.length}</span>
                    <span className="mrd-section-subtitle">committed source of truth</span>
                </h3>
                <div className="mrd-section-body">
                    {keys.length === 0 ? <div className="mrd-empty">empty</div> :
                        keys.map((key) => <ValueTree key={key} value={data[key]!} label={key} />)}
                </div>
            </section>
        </div>
    );
}
