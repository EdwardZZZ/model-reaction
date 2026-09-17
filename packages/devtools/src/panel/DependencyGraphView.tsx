/**
 * Dependency-graph view: renders the reaction dependency DAG as an SVG. Each
 * node is a field; each arrow points from a dependency to the field its
 * reaction computes ("`from` feeds `to`"). Selecting a node highlights its
 * incident edges so the relationships are easy to trace.
 *
 * Layout is delegated to the pure {@link layoutGraph}; this component only
 * paints it, so all the tricky positioning logic stays unit-testable.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { InstanceState } from '../protocol';
import {
    DEFAULT_LAYOUT_OPTIONS,
    layoutGraph,
    type LaidOutNode,
} from '../graph-layout';

interface DependencyGraphViewProps {
    instance: InstanceState;
}

const PAD = 16;
const { nodeWidth, nodeHeight } = DEFAULT_LAYOUT_OPTIONS;

export function DependencyGraphView({ instance }: DependencyGraphViewProps): ReactElement {
    const layout = useMemo(() => layoutGraph(instance.graph), [instance.graph]);
    const [active, setActive] = useState<string | null>(null);

    if (instance.graph.edges.length === 0) {
        return (
            <div className="mrd-empty mrd-graph-empty">
                No reactions declared — every field is independent.
            </div>
        );
    }

    const pos = new Map<string, LaidOutNode>();
    layout.nodes.forEach((n) => pos.set(n.id, n));

    const svgWidth = layout.width + PAD * 2;
    const svgHeight = layout.height + PAD * 2;

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

                {layout.edges.map((e, i) => {
                    const from = pos.get(e.from);
                    const to = pos.get(e.to);
                    if (!from || !to) return null;
                    const x1 = from.x + nodeWidth / 2 + PAD;
                    const y1 = from.y + nodeHeight + PAD;
                    const x2 = to.x + nodeWidth / 2 + PAD;
                    const y2 = to.y + PAD;
                    const highlighted =
                        active !== null && (e.from === active || e.to === active);
                    return (
                        <line
                            key={i}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            className={`mrd-edge${highlighted ? ' mrd-edge-active' : ''}`}
                            markerEnd="url(#mrd-arrow)"
                        />
                    );
                })}

                {layout.nodes.map((n) => {
                    const info = instance.fields[n.id];
                    const isActive = active === n.id;
                    return (
                        <g
                            key={n.id}
                            transform={`translate(${n.x + PAD}, ${n.y + PAD})`}
                            className={`mrd-node${isActive ? ' mrd-node-active' : ''}`}
                            onMouseEnter={() => setActive(n.id)}
                            onMouseLeave={() => setActive(null)}
                        >
                            <rect width={nodeWidth} height={nodeHeight} rx={6} />
                            <text x={nodeWidth / 2} y={nodeHeight / 2} className="mrd-node-label">
                                {n.id}
                            </text>
                            {info && info.reactionDeps.length > 0 && (
                                <title>{`${n.id} ← ${info.reactionDeps.join(', ')}`}</title>
                            )}
                        </g>
                    );
                })}
            </svg>
            <p className="mrd-graph-hint">Arrows point from a dependency to the field it feeds.</p>
        </div>
    );
}
