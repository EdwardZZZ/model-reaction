import { layoutGraph } from '../graph-layout';
import type { DependencyGraph } from '../protocol';

describe('layoutGraph', () => {
    test('empty graph yields empty layout', () => {
        const layout = layoutGraph({ nodes: [], edges: [] });
        expect(layout.nodes).toEqual([]);
        expect(layout.edges).toEqual([]);
        expect(layout.height).toBe(0);
    });

    test('isolated nodes all sit on layer 0', () => {
        const graph: DependencyGraph = { nodes: ['a', 'b', 'c'], edges: [] };
        const layout = layoutGraph(graph);
        expect(layout.nodes.every((n) => n.layer === 0)).toBe(true);
        // Same row → same y.
        const ys = new Set(layout.nodes.map((n) => n.y));
        expect(ys.size).toBe(1);
    });

    test('a -> b puts b one layer below a', () => {
        const graph: DependencyGraph = {
            nodes: ['a', 'b'],
            edges: [{ from: 'a', to: 'b' }],
        };
        const layout = layoutGraph(graph);
        const a = layout.nodes.find((n) => n.id === 'a')!;
        const b = layout.nodes.find((n) => n.id === 'b')!;
        expect(a.layer).toBe(0);
        expect(b.layer).toBe(1);
        expect(b.y).toBeGreaterThan(a.y);
    });

    test('longest-path layering: a->b, b->c, a->c places c on layer 2', () => {
        const graph: DependencyGraph = {
            nodes: ['a', 'b', 'c'],
            edges: [
                { from: 'a', to: 'b' },
                { from: 'b', to: 'c' },
                { from: 'a', to: 'c' },
            ],
        };
        const layout = layoutGraph(graph);
        expect(layout.nodes.find((n) => n.id === 'c')!.layer).toBe(2);
    });

    test('diamond: two deps feed one computed field', () => {
        const graph: DependencyGraph = {
            nodes: ['first', 'last', 'full'],
            edges: [
                { from: 'first', to: 'full' },
                { from: 'last', to: 'full' },
            ],
        };
        const layout = layoutGraph(graph);
        expect(layout.nodes.find((n) => n.id === 'first')!.layer).toBe(0);
        expect(layout.nodes.find((n) => n.id === 'last')!.layer).toBe(0);
        expect(layout.nodes.find((n) => n.id === 'full')!.layer).toBe(1);
        expect(layout.edges).toHaveLength(2);
    });

    test('terminates and assigns layers even if a cycle sneaks in', () => {
        // The library forbids cyclic reactions, but the layout must be robust.
        const graph: DependencyGraph = {
            nodes: ['a', 'b'],
            edges: [
                { from: 'a', to: 'b' },
                { from: 'b', to: 'a' },
            ],
        };
        // Must not hang; must return a finite layout.
        const layout = layoutGraph(graph);
        expect(layout.nodes).toHaveLength(2);
        expect(Number.isFinite(layout.height)).toBe(true);
    });
});
