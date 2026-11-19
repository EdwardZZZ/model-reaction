import { layoutActionGraph } from '../action-graph-layout';
import { DEFAULT_LAYOUT_OPTIONS } from '../graph-layout';
import type { FieldInfo } from '../protocol';

test('shared actions with colliding anchors fit without overlap or empty field action space', () => {
    const actions = Array.from({ length: 20 }, (_, actionIndex) => ({
        reactionIndex: 0, actionIndex, name: `shared${actionIndex}`, functionId: actionIndex,
    }));
    const fields: Record<string, FieldInfo> = {
        first: { type: 'number', hasDefault: true, validatorCount: 0, reactionDeps: [], actions },
        second: { type: 'number', hasDefault: true, validatorCount: 0, reactionDeps: ['first'], actions },
    };
    const graph = { nodes: ['first', 'second'], edges: [{ from: 'first', to: 'second' }] };
    const layout = layoutActionGraph(graph, fields);
    expect(layout.sharedActions).toHaveLength(20);
    expect(layout.fieldActions.size).toBe(0);
    expect(layout.fields.nodes.every((node) => node.height === DEFAULT_LAYOUT_OPTIONS.nodeHeight)).toBe(true);
    expect(layout.fields.edges).toEqual(graph.edges);
    layout.sharedActions.forEach((node, index) => {
        expect(node.x).toBeGreaterThan(layout.fields.width);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
        expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
        if (index > 0) {
            const previous = layout.sharedActions[index - 1]!;
            expect(node.y).toBeGreaterThanOrEqual(previous.y + previous.height + DEFAULT_LAYOUT_OPTIONS.vGap);
        }
    });
});
