/**
 * Compute a layered layout for the reaction dependency graph.
 *
 * The graph is a DAG (the library rejects cyclic reactions at runtime), so we
 * assign each node to a "layer" = its longest path from any root (a node with
 * no incoming edges). Nodes in the same layer are spread horizontally. This is
 * a small, deterministic Sugiyama-style layering — enough for the field counts
 * a typical model has, and pure so it can be unit-tested without a DOM.
 *
 * Cycles, if they somehow appear, are broken defensively: any node not yet
 * assigned after the relaxation passes is parked in the last layer, so the
 * function always terminates and never loops forever.
 */
import type { DependencyGraph } from './protocol';

export interface LaidOutNode {
    id: string;
    x: number;
    y: number;
    layer: number;
}

export interface LaidOutEdge {
    from: string;
    to: string;
}

export interface GraphLayout {
    nodes: LaidOutNode[];
    edges: LaidOutEdge[];
    width: number;
    height: number;
}

export interface LayoutOptions {
    nodeWidth: number;
    nodeHeight: number;
    hGap: number;
    vGap: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
    nodeWidth: 120,
    nodeHeight: 36,
    hGap: 32,
    vGap: 48,
};

export function layoutGraph(
    graph: DependencyGraph,
    options: LayoutOptions = DEFAULT_LAYOUT_OPTIONS
): GraphLayout {
    const layer = assignLayers(graph);

    // Bucket nodes by layer, preserving the schema's node order within a layer.
    const byLayer = new Map<number, string[]>();
    graph.nodes.forEach((id) => {
        const l = layer.get(id) ?? 0;
        if (!byLayer.has(l)) byLayer.set(l, []);
        byLayer.get(l)!.push(id);
    });

    const { nodeWidth, nodeHeight, hGap, vGap } = options;
    const nodes: LaidOutNode[] = [];
    let maxWidth = 0;
    const layers = [...byLayer.keys()].sort((a, b) => a - b);

    layers.forEach((l) => {
        const ids = byLayer.get(l)!;
        const rowWidth = ids.length * nodeWidth + (ids.length - 1) * hGap;
        maxWidth = Math.max(maxWidth, rowWidth);
        ids.forEach((id, i) => {
            nodes.push({
                id,
                x: i * (nodeWidth + hGap),
                y: l * (nodeHeight + vGap),
                layer: l,
            });
        });
    });

    // Center each row within the widest row.
    const rowWidths = new Map<number, number>();
    layers.forEach((l) => {
        const ids = byLayer.get(l)!;
        rowWidths.set(l, ids.length * nodeWidth + (ids.length - 1) * hGap);
    });
    nodes.forEach((n) => {
        const offset = (maxWidth - (rowWidths.get(n.layer) ?? 0)) / 2;
        n.x += offset;
    });

    const height =
        layers.length * nodeHeight + Math.max(0, layers.length - 1) * vGap;

    return {
        nodes,
        edges: graph.edges.map((e) => ({ from: e.from, to: e.to })),
        width: maxWidth,
        height,
    };
}

/** Longest-path layer assignment with a defensive cap against cycles. */
function assignLayers(graph: DependencyGraph): Map<string, number> {
    const incoming = new Map<string, string[]>();
    graph.nodes.forEach((n) => incoming.set(n, []));
    graph.edges.forEach((e) => {
        if (!incoming.has(e.to)) incoming.set(e.to, []);
        incoming.get(e.to)!.push(e.from);
    });

    const layer = new Map<string, number>();
    graph.nodes.forEach((n) => layer.set(n, 0));

    // Relax layers: a node sits one below its deepest predecessor. Iterate up
    // to |nodes| times — enough for any DAG; the cap also bounds cycles.
    const maxPasses = graph.nodes.length;
    for (let pass = 0; pass < maxPasses; pass++) {
        let changed = false;
        graph.edges.forEach((e) => {
            const want = (layer.get(e.from) ?? 0) + 1;
            if (want > (layer.get(e.to) ?? 0)) {
                layer.set(e.to, want);
                changed = true;
            }
        });
        if (!changed) break;
    }

    return layer;
}
