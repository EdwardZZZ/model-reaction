/** Paint computation and action relationships; see model-reaction/docs/DEVTOOLS.md. */
import { useMemo, useState, type ReactElement } from 'react';
import type { InstanceState } from '../protocol';
import { DEFAULT_LAYOUT_OPTIONS, type LaidOutNode } from '../graph-layout';
import { ACTION_STEP, layoutActionGraph, type ActionNode } from '../action-graph-layout';
import { layoutDerivedGraph } from '../derived-graph-layout';
import { derivedLabel, DerivedValuesView } from './DerivedValuesView';

interface DependencyGraphViewProps {
    instance: InstanceState;
}

const PAD = 16;
const HEADER_HEIGHT = DEFAULT_LAYOUT_OPTIONS.nodeHeight;

function actionTitle(action: ActionNode): string {
    return `${action.label}\n${action.declarations.map(
        ({ field, reactionIndex, actionIndex }) => `${field} · r${reactionIndex} · action[${actionIndex}]`
    ).join('\n')}`;
}

export function DependencyGraphView({ instance }: DependencyGraphViewProps): ReactElement {
    const hasActions = Object.values(instance.fields).some((info) => info.actions?.length);
    const layout = useMemo(
        () => layoutActionGraph(instance.graph, instance.fields),
        [instance.graph, instance.fields]
    );
    const derived = useMemo(
        () => layoutDerivedGraph(layout, instance.snapshot.derivedValues),
        [layout, instance.snapshot.derivedValues]
    );
    const { nodeWidth } = layout;
    const [active, setActive] = useState<
        { kind: 'field' | 'action'; id: string } | { kind: 'derived'; id: number } | null
    >(null);

    if (instance.graph.edges.length === 0 && !hasActions && derived.nodes.length === 0) {
        return (
            <>
                <div className="mrd-empty mrd-graph-empty">
                    No reactions or derived values — every field is independent.
                </div>
                <DerivedValuesView values={instance.snapshot.derivedValues} truncated={instance.snapshot.truncated ?? false} />
            </>
        );
    }

    const pos = new Map<string, LaidOutNode>();
    layout.fields.nodes.forEach((n) => pos.set(n.id, n));

    const svgWidth = derived.width + PAD * 2;
    const svgHeight = derived.height + PAD * 2;

    return (
        <div className="mrd-graph">
            <svg width={svgWidth} height={svgHeight} role="img" aria-label="dependency graph">
                <defs>
                    <marker
                        id="mrd-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                    >
                        <path d="M 0 0 L 10 5 L 0 10 z" className="mrd-arrow-head" />
                    </marker>
                </defs>

                {layout.fields.edges.map((e, i) => {
                    const from = pos.get(e.from);
                    const to = pos.get(e.to);
                    if (!from || !to) return null;
                    const x1 = from.x + nodeWidth + PAD;
                    const y1 = from.y + HEADER_HEIGHT / 2 + PAD;
                    const x2 = to.x + PAD;
                    const y2 = to.y + HEADER_HEIGHT / 2 + PAD;
                    const bendX = x2 - DEFAULT_LAYOUT_OPTIONS.hGap / 2;
                    const highlighted =
                        active?.kind === 'field' && (e.from === active.id || e.to === active.id);
                    return (
                        <path
                            key={i}
                            d={`M ${x1} ${y1} H ${bendX} V ${y2} H ${x2}`}
                            className={`mrd-edge${highlighted ? ' mrd-edge-active' : ''}`}
                            markerEnd="url(#mrd-arrow)"
                        />
                    );
                })}

                {layout.sharedActions.flatMap((action) => action.fields.map((field) => {
                    const from = pos.get(field);
                    if (!from) return null;
                    const x1 = from.x + nodeWidth + PAD;
                    const y1 = from.y + HEADER_HEIGHT / 2 + PAD;
                    const x2 = action.x + PAD;
                    const y2 = action.y + action.height / 2 + PAD;
                    const bendX = x2 - DEFAULT_LAYOUT_OPTIONS.hGap / 2;
                    const highlighted = active?.kind === 'action'
                        ? active.id === action.id
                        : active?.kind === 'field' && active.id === field;
                    return (
                        <path
                            key={`${action.id}:${field}`}
                            d={`M ${x1} ${y1} H ${bendX} V ${y2} H ${x2}`}
                            className={`mrd-edge mrd-action-edge${highlighted ? ' mrd-edge-active' : ''}`}
                            data-from-field={field}
                            data-to-action={action.id}
                            markerEnd="url(#mrd-arrow)"
                        />
                    );
                }))}

                {derived.nodes.flatMap((node) => node.fields.map((field) => {
                    const from = pos.get(field)!;
                    const x1 = from.x + nodeWidth + PAD;
                    const y1 = from.y + HEADER_HEIGHT / 2 + PAD;
                    const x2 = node.x + PAD;
                    const y2 = node.y + node.height / 2 + PAD;
                    const bendX = x2 - DEFAULT_LAYOUT_OPTIONS.hGap / 2;
                    const highlighted = active?.kind === 'derived'
                        ? active.id === node.entry.id
                        : active?.kind === 'field' && active.id === field;
                    return (
                        <path
                            key={JSON.stringify([node.entry.id, field])}
                            d={`M ${x1} ${y1} H ${bendX} V ${y2} H ${x2}`}
                            className={`mrd-edge mrd-derived-edge${highlighted ? ' mrd-edge-active' : ''}`}
                            data-from-field={field}
                            data-to-derived={node.entry.id}
                            markerEnd="url(#mrd-arrow)"
                        />
                    );
                }))}

                {layout.fields.nodes.map((n) => {
                    const info = instance.fields[n.id];
                    const actions = layout.fieldActions.get(n.id) ?? [];
                    const isActive = active?.kind === 'field' && active.id === n.id
                        || active?.kind === 'action' && layout.sharedActions.some(
                            (action) => action.id === active.id && action.fields.includes(n.id)
                        )
                        || active?.kind === 'derived' && derived.nodes.some(
                            (node) => node.entry.id === active.id && node.fields.includes(n.id)
                        );
                    return (
                        <g
                            key={n.id}
                            data-field-id={n.id}
                            transform={`translate(${n.x + PAD}, ${n.y + PAD})`}
                            className={`mrd-node${isActive ? ' mrd-node-active' : ''}`}
                            onMouseEnter={() => setActive({ kind: 'field', id: n.id })}
                            onMouseLeave={() => setActive(null)}
                        >
                            {actions.length > 0 && (
                                <rect
                                    width={nodeWidth}
                                    height={n.height}
                                    rx={6}
                                    className="mrd-field-module"
                                />
                            )}
                            <rect width={nodeWidth} height={HEADER_HEIGHT} rx={6} />
                            <text x={nodeWidth / 2} y={HEADER_HEIGHT / 2} className="mrd-node-label">
                                {n.id}
                            </text>
                            {info && info.reactionDeps.length > 0 && (
                                <title>{`${n.id} ← ${info.reactionDeps.join(', ')}`}</title>
                            )}
                            {actions.map((action, index) => {
                                const y = HEADER_HEIGHT + index * ACTION_STEP + 10;
                                return (
                                    <g
                                        key={action.id}
                                        className="mrd-action"
                                        data-action-id={action.id}
                                    >
                                        <path
                                            d={`M 12 ${HEADER_HEIGHT} V ${y + 12} H 30`}
                                            className="mrd-edge mrd-action-edge"
                                            data-from-field={n.id}
                                            data-to-action={action.id}
                                            markerEnd="url(#mrd-arrow)"
                                        />
                                        <rect x={32} y={y} width={nodeWidth - 42} height={26} rx={4} />
                                        <text x={nodeWidth / 2 + 11} y={y + 13} className="mrd-node-label">
                                            {action.label}
                                        </text>
                                        <title>{actionTitle(action)}</title>
                                    </g>
                                );
                            })}
                        </g>
                    );
                })}
                {layout.sharedActions.map((action) => {
                    const isActive = active?.kind === 'action'
                        ? active.id === action.id
                        : active?.kind === 'field' && action.fields.includes(active.id);
                    return (
                        <g
                            key={action.id}
                            transform={`translate(${action.x + PAD}, ${action.y + PAD})`}
                            className={`mrd-node mrd-action mrd-shared-action${isActive ? ' mrd-node-active' : ''}`}
                            data-action-id={action.id}
                            onMouseEnter={() => setActive({ kind: 'action', id: action.id })}
                            onMouseLeave={() => setActive(null)}
                        >
                            <rect width={action.width} height={action.height} rx={6} />
                            <text x={action.width / 2} y={15} className="mrd-node-label">
                                {action.label}
                            </text>
                            <text x={action.width / 2} y={32} className="mrd-node-label mrd-action-kind">
                                shared · {action.fields.length} fields
                            </text>
                            <title>{actionTitle(action)}</title>
                        </g>
                    );
                })}
                {derived.nodes.map((node) => {
                    const { entry } = node;
                    const label = entry.debugName || `${entry.kind} #${entry.id}`;
                    const isActive = active?.kind === 'derived'
                        ? active.id === entry.id
                        : active?.kind === 'field' && node.fields.includes(active.id);
                    const inputs = entry.fields === undefined ? 'dependencies unavailable'
                        : entry.fields.length ? `← ${entry.fields.join(', ')}` : 'no model dependencies';
                    return (
                        <g
                            key={entry.id}
                            transform={`translate(${node.x + PAD}, ${node.y + PAD})`}
                            className={`mrd-node mrd-derived-node${isActive ? ' mrd-node-active' : ''}`}
                            data-derived-id={entry.id}
                            onMouseEnter={() => setActive({ kind: 'derived', id: entry.id })}
                            onMouseLeave={() => setActive(null)}
                        >
                            <rect width={node.width} height={node.height} rx={12} />
                            <text x={node.width / 2} y={16} className="mrd-node-label">
                                {derivedLabel(entry, 28)}
                            </text>
                            <text x={node.width / 2} y={34} className="mrd-node-label mrd-derived-kind">
                                {entry.fields === undefined ? 'derived · inputs unknown' : `derived · ${entry.kind}`}
                            </text>
                            <title>{`${label}\n${entry.kind} · #${entry.id}\n${inputs}`}</title>
                        </g>
                    );
                })}
            </svg>
            <p className="mrd-graph-hint">
                Solid arrows show computation dependencies; dashed arrows connect fields to actions.
                A shared node represents the same function reference. Actions run after computation settles.
                {' '}Rounded derived nodes show React Hook results; their input arrows follow observed field reads.
            </p>
            <DerivedValuesView values={instance.snapshot.derivedValues} truncated={instance.snapshot.truncated ?? false} />
        </div>
    );
}
