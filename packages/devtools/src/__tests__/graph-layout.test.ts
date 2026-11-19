import { DEFAULT_LAYOUT_OPTIONS, layoutGraph } from '../graph-layout';
import type { DependencyGraph } from '../protocol';

describe('layoutGraph', () => {
    test('empty graph yields empty layout', () => {
        const layout = layoutGraph({ nodes: [], edges: [] });
        expect(layout.nodes).toEqual([]);
        expect(layout.edges).toEqual([]);
        expect(layout.width).toBe(0);
        expect(layout.height).toBe(0);
    });

    test('isolated nodes all sit on layer 0', () => {
        const graph: DependencyGraph = { nodes: ['a', 'b', 'c'], edges: [] };
        const layout = layoutGraph(graph);
        expect(layout.nodes.every((n) => n.layer === 0)).toBe(true);
        expect(new Set(layout.nodes.map((n) => n.x)).size).toBe(1);
        expect(new Set(layout.nodes.map((n) => n.y)).size).toBe(3);
        expect(layout.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
        expect(layout.width).toBe(layoutGraph({ nodes: ['a'], edges: [] }).width);
    });

    test('a -> b keeps b below a and moves it one column to the right', () => {
        const graph: DependencyGraph = {
            nodes: ['a', 'b'],
            edges: [{ from: 'a', to: 'b' }],
        };
        const layout = layoutGraph(graph);
        const a = layout.nodes.find((n) => n.id === 'a')!;
        const b = layout.nodes.find((n) => n.id === 'b')!;
        expect(a.layer).toBe(0);
        expect(b.layer).toBe(1);
        expect(b.x).toBe(a.x + DEFAULT_LAYOUT_OPTIONS.nodeWidth + DEFAULT_LAYOUT_OPTIONS.hGap);
        expect(b.y).toBeGreaterThan(a.y);
    });

    test('fits fields with different heights in one column without overlap or trailing space', () => {
        const layout = layoutGraph({ nodes: ['a', 'b', 'c'], edges: [] }, {
            ...DEFAULT_LAYOUT_OPTIONS,
            nodeHeights: new Map([['b', 100]]),
        });
        const [a, b, c] = layout.nodes;
        expect(a!.height).toBe(DEFAULT_LAYOUT_OPTIONS.nodeHeight);
        expect(b!.height).toBe(100);
        expect(b!.y).toBe(a!.y + a!.height + DEFAULT_LAYOUT_OPTIONS.vGap);
        expect(c!.y).toBe(b!.y + b!.height + DEFAULT_LAYOUT_OPTIONS.vGap);
        expect(layout.height).toBe(c!.y + c!.height);
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
        const c = layout.nodes.find((n) => n.id === 'c')!;
        expect(c.layer).toBe(2);
        expect(c.x).toBe(2 * (DEFAULT_LAYOUT_OPTIONS.nodeWidth + DEFAULT_LAYOUT_OPTIONS.hGap));
        expect(layout.width).toBe(c.x + DEFAULT_LAYOUT_OPTIONS.nodeWidth);
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
        expect(layout.nodes.find((n) => n.id === 'first')!.x)
            .toBe(layout.nodes.find((n) => n.id === 'last')!.x);
        expect(layout.nodes.find((n) => n.id === 'full')!.x)
            .toBe(DEFAULT_LAYOUT_OPTIONS.nodeWidth + DEFAULT_LAYOUT_OPTIONS.hGap);
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
