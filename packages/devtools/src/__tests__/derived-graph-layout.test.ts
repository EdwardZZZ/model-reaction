import { layoutActionGraph } from '../action-graph-layout';
import { layoutDerivedGraph } from '../derived-graph-layout';
import type { DerivedValue, FieldInfo } from '../protocol';

test('terminal observations fit beside shared actions without changing the field graph', () => {
    const actions = [{ reactionIndex: 0, actionIndex: 0, name: 'save', functionId: 1 }];
    const fields = Object.fromEntries(['__proto__', 'constructor', '0'].map((field) => [field, {
        type: 'number', hasDefault: true, validatorCount: 0, reactionDeps: [], actions,
    }])) as Record<string, FieldInfo>;
    const graph = { nodes: Object.keys(fields), edges: [] };
    const layout = layoutActionGraph(graph, fields);
    const before = JSON.stringify(layout);
    const values: DerivedValue[] = Array.from({ length: 20 }, (_, id) => ({
        id, kind: 'useModelComputed', fields: ['__proto__', 'constructor', '0', '__proto__', 'missing'],
        value: { t: 'primitive', v: id },
    }));
    const derived = layoutDerivedGraph(layout, values);
    expect(JSON.stringify(layout)).toBe(before);
    expect(derived.nodes).toHaveLength(20);
    derived.nodes.forEach((node, index) => {
        expect(node.fields).toEqual(['__proto__', 'constructor', '0']);
        expect(node.x).toBeGreaterThan(layout.fields.width);
        expect(node.x + node.width).toBeLessThanOrEqual(derived.width);
        expect(node.y + node.height).toBeLessThanOrEqual(derived.height);
        if (index > 0) {
            const previous = derived.nodes[index - 1]!;
            expect(node.y).toBeGreaterThan(previous.y + previous.height);
        }
        for (const action of layout.sharedActions) {
            expect(node.y > action.y + action.height || node.y + node.height < action.y).toBe(true);
        }
    });
});

test('undeclared observations remain distinct terminal nodes even without schema reactions', () => {
    const layout = layoutActionGraph({ nodes: ['1'], edges: [] }, {});
    const derived = layoutDerivedGraph(layout, [
        { id: 1, kind: 'useModelSelector', value: { t: 'undefined' } },
        { id: 2, kind: 'useModelSelector', fields: [], value: { t: 'undefined' } },
    ]);
    expect(derived.nodes.map((node) => node.fields)).toEqual([[], []]);
    expect(derived.nodes.map((node) => node.entry.id)).toEqual([1, 2]);
    expect(layout.fields.nodes.map((node) => node.id)).toEqual(['1']);
    expect(layoutDerivedGraph(layout).width).toBe(layout.width);
    expect(layoutDerivedGraph(layout).height).toBe(layout.height);
});
