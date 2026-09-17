/**
 * Data-tree view: renders a model instance's three layers — validated `data`,
 * failed `dirtyData`, and `errors` — each as a collapsible section. This maps
 * directly to the library's mental model (see AGENTS.md §1).
 */
import type { ReactElement } from 'react';
import type { InstanceState, SerializedValue } from '../protocol';
import { ValueTree } from './ValueTree';

interface DataTreeViewProps {
    instance: InstanceState;
}

export function DataTreeView({ instance }: DataTreeViewProps): ReactElement {
    const { data, dirtyData, errors } = instance.snapshot;
    const dirtyKeys = Object.keys(dirtyData);
    const errorKeys = Object.keys(errors).filter((k) => (errors[k]?.length ?? 0) > 0);

    return (
        <div className="mrd-datatree">
            <Section title="data" subtitle="validated source of truth" count={Object.keys(data).length}>
                <RecordTree record={data} />
            </Section>

            <Section
                title="dirtyData"
                subtitle="last input that failed validation"
                count={dirtyKeys.length}
                tone="warn"
            >
                {dirtyKeys.length === 0 ? (
                    <Empty>no dirty fields</Empty>
                ) : (
                    <RecordTree record={dirtyData} />
                )}
            </Section>

            <Section
                title="errors"
                subtitle="current validation errors"
                count={errorKeys.length}
                tone="error"
            >
                {errorKeys.length === 0 ? (
                    <Empty>no errors</Empty>
                ) : (
                    <ul className="mrd-error-list">
                        {errorKeys.map((field) => (
                            <li key={field}>
                                <span className="mrd-tree-key">{field}</span>
                                <ul>
                                    {errors[field]!.map((e, i) => (
                                        <li key={i} className="mrd-error-msg">
                                            {e.message}
                                            {e.rule ? (
                                                <span className="mrd-error-rule"> ({e.rule})</span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}

function RecordTree({ record }: { record: Record<string, SerializedValue> }): ReactElement {
    const keys = Object.keys(record);
    if (keys.length === 0) return <Empty>empty</Empty>;
    return (
        <div>
            {keys.map((key) => (
                <ValueTree key={key} value={record[key]!} label={key} />
            ))}
        </div>
    );
}

function Section({
    title,
    subtitle,
    count,
    tone,
    children,
}: {
    title: string;
    subtitle: string;
    count: number;
    tone?: 'warn' | 'error';
    children: React.ReactNode;
}): ReactElement {
    return (
        <section className={`mrd-section${tone ? ` mrd-section-${tone}` : ''}`}>
            <h3 className="mrd-section-title">
                {title}
                <span className="mrd-badge">{count}</span>
                <span className="mrd-section-subtitle">{subtitle}</span>
            </h3>
            <div className="mrd-section-body">{children}</div>
        </section>
    );
}

function Empty({ children }: { children: React.ReactNode }): ReactElement {
    return <div className="mrd-empty">{children}</div>;
}
