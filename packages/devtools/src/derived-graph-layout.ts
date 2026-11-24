/** Add React observations as terminal nodes; see model-reaction/docs/DEVTOOLS.md. */
import type { ActionGraphLayout } from './action-graph-layout';
import { DEFAULT_LAYOUT_OPTIONS } from './graph-layout';
import type { DerivedValue } from './protocol';

export interface DerivedNode {
    entry: DerivedValue;
    fields: string[];
    x: number;
    y: number;
    width: number;
    height: number;
}

export function layoutDerivedGraph(layout: ActionGraphLayout, values: readonly DerivedValue[] = []) {
    const { hGap, vGap, nodeHeight } = DEFAULT_LAYOUT_OPTIONS;
    const positions = new Map(layout.fields.nodes.map((node) => [node.id, node]));
    const nodes: DerivedNode[] = values.map((entry) => {
        const fields = [...new Set(entry.fields)].filter((field) => positions.has(field));
        const centerY = fields.length
            ? fields.reduce((sum, field) => sum + positions.get(field)!.y + nodeHeight / 2, 0) / fields.length
            : 0;
        return {
            entry, fields,
            x: layout.fields.width + hGap,
            y: Math.max(0, centerY - 24),
            width: 220,
            height: 48,
        };
    }).sort((a, b) => a.y - b.y);
    // Share the terminal column with actions without moving existing graph nodes.
    let nextY = 0;
    for (const node of nodes) {
        node.y = Math.max(node.y, nextY);
        for (const action of layout.sharedActions) {
            if (node.y + node.height + vGap <= action.y) break;
            if (node.y < action.y + action.height + vGap) {
                node.y = action.y + action.height + vGap;
            }
        }
        nextY = node.y + node.height + vGap;
    }
    return {
        nodes,
        width: Math.max(layout.width, nodes.length ? nodes[0]!.x + nodes[0]!.width : 0),
        height: Math.max(layout.height, nodes.length ? nextY - vGap : 0),
    };
}
