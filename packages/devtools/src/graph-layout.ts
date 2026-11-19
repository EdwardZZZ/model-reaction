/**
 * Stack fields vertically, ordered by dependency layer and then schema order.
 * Indent dependent fields to the right. See model-reaction/docs/DEVTOOLS.md.
 */
import type { DependencyGraph } from './protocol';

export interface LaidOutNode {
    id: string;
    x: number;
    y: number;
    height: number;
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
    nodeHeights?: ReadonlyMap<string, number>;
    hGap: number;
    vGap: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
    nodeWidth: 120,
    nodeHeight: 36,
    hGap: 32,
    vGap: 20,
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

    const { nodeWidth, nodeHeight, nodeHeights, hGap, vGap } = options;
    const nodes: LaidOutNode[] = [];
    const layers = [...byLayer.keys()].sort((a, b) => a - b);
    let nextY = 0;
    let width = 0;

    layers.forEach((l) => {
        const ids = byLayer.get(l)!;
        ids.forEach((id) => {
            const height = nodeHeights?.get(id) ?? nodeHeight;
            const x = l * (nodeWidth + hGap);
            nodes.push({
                id,
                x,
                y: nextY,
                height,
                layer: l,
            });
            nextY += height + vGap;
            width = Math.max(width, x + nodeWidth);
        });
    });

    const height = nodes.length > 0 ? nextY - vGap : 0;

    return {
        nodes,
        edges: graph.edges.map((e) => ({ from: e.from, to: e.to })),
        width,
        height,
    };
}

/** Longest-path layer assignment with a defensive cap against cycles. */
function assignLayers(graph: DependencyGraph): Map<string, number> {
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
