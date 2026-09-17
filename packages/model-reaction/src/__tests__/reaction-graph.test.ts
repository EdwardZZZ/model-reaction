import { eachReactionEdge } from '../reaction-graph';
import { ReactionSystem } from '../reaction-system';
import { PendingTasks } from '../pending-tasks';
import { buildDependencyGraph } from '../devtools-hook';
import type { Model } from '../types';

/**
 * Canonical set of directed edges `from -> to` as a sorted, deduped string
 * array, so three independently-derived edge sets can be compared for equality.
 */
function edgeKeys(edges: Array<{ from: string; to: string }>): string[] {
    return [...new Set(edges.map((e) => `${e.from}->${e.to}`))].sort();
}

/** Edges via the shared primitive (the single source of truth). */
function edgesFromPrimitive(schema: Model): string[] {
    const edges: Array<{ from: string; to: string }> = [];
    eachReactionEdge(schema, (to, from) => edges.push({ from, to }));
    return edgeKeys(edges);
}

/**
 * Edges as the *runtime* actually indexes them: read `ReactionSystem`'s private
 * `reactionDeps` map (depField -> [{ field }]) and flatten it. This is the map
 * that drives real reaction scheduling, so matching it proves the DevTools
 * graph reflects runtime behaviour.
 */
function edgesFromRuntime(schema: Model): string[] {
    const system = new ReactionSystem(
        schema,
        { debounceReactions: 0 },
        {
            getValue: () => undefined,
            setValue: async () => true,
            setError: () => {},
            reportError: () => {},
        },
        new PendingTasks()
    );
    const reactionDeps: Map<string, Array<{ field: string }>> = (
        system as unknown as { reactionDeps: Map<string, Array<{ field: string }>> }
    ).reactionDeps;

    const edges: Array<{ from: string; to: string }> = [];
    reactionDeps.forEach((dependents, from) => {
        dependents.forEach(({ field: to }) => edges.push({ from, to }));
    });
    system.dispose();
    return edgeKeys(edges);
}

/** Edges as the DevTools graph projection produces them. */
function edgesFromGraph(schema: Model): string[] {
    return edgeKeys(buildDependencyGraph(schema).edges);
}

describe('eachReactionEdge', () => {
    test('visits one edge per (reaction, dependency) pair, undeduped', () => {
        const schema: Model = {
            a: { type: 'number', default: 0 },
            b: { type: 'number', default: 0 },
            sum: {
                type: 'number',
                reaction: [
                    { fields: ['a', 'b'], computed: (v) => v.a + v.b },
                    { fields: ['a'], computed: (v) => v.a },
                ],
            },
        };
        const visited: Array<[string, string]> = [];
        eachReactionEdge(schema, (computed, dep) => visited.push([computed, dep]));
        // a appears twice (once per reaction), b once — raw, not deduped.
        expect(visited).toEqual([
            ['sum', 'a'],
            ['sum', 'b'],
            ['sum', 'a'],
        ]);
    });

    test('passes the owning reaction object to the visitor', () => {
        const reaction = { fields: ['a'], computed: (v: Record<string, any>) => v.a };
        const schema: Model = {
            a: { type: 'number', default: 0 },
            b: { type: 'number', default: 0, reaction },
        };
        eachReactionEdge(schema, (_computed, _dep, r) => {
            expect(r).toBe(reaction);
        });
    });

    test('does nothing for a schema with no reactions', () => {
        const visit = jest.fn();
        eachReactionEdge({ a: { type: 'string', default: '' } }, visit);
        expect(visit).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------------
// Lock-in: the primitive, the runtime index, and the DevTools graph must agree.
//
// This is the guarantee that lets the DevTools graph live outside ModelManager:
// all three read `reaction.fields` through the same primitive, so they cannot
// disagree on what the dependency edges are. If any consumer ever forks that
// reading, one of these cases fails.
// -----------------------------------------------------------------------------

describe('dependency edges: primitive == runtime == graph', () => {
    const cases: Array<{ name: string; schema: Model }> = [
        {
            name: 'no reactions',
            schema: {
                a: { type: 'string', default: '' },
                b: { type: 'number', default: 0 },
            },
        },
        {
            name: 'single cross-field reaction',
            schema: {
                firstName: { type: 'string', default: '' },
                lastName: { type: 'string', default: '' },
                fullName: {
                    type: 'string',
                    reaction: {
                        fields: ['firstName', 'lastName'],
                        computed: (v) => `${v.firstName} ${v.lastName}`,
                    },
                },
            },
        },
        {
            name: 'multiple reactions on one field with a repeated dep',
            schema: {
                a: { type: 'number', default: 0 },
                b: { type: 'number', default: 0 },
                sum: {
                    type: 'number',
                    reaction: [
                        { fields: ['a', 'b'], computed: (v) => v.a + v.b },
                        { fields: ['a'], computed: (v) => v.a },
                    ],
                },
            },
        },
        {
            name: 'chained reactions (a -> b -> c)',
            schema: {
                a: { type: 'number', default: 0 },
                b: {
                    type: 'number',
                    reaction: { fields: ['a'], computed: (v) => v.a + 1 },
                },
                c: {
                    type: 'number',
                    reaction: { fields: ['b'], computed: (v) => v.b + 1 },
                },
            },
        },
        {
            name: 'one dependency feeding several computed fields',
            schema: {
                base: { type: 'number', default: 0 },
                double: {
                    type: 'number',
                    reaction: { fields: ['base'], computed: (v) => v.base * 2 },
                },
                triple: {
                    type: 'number',
                    reaction: { fields: ['base'], computed: (v) => v.base * 3 },
                },
            },
        },
    ];

    test.each(cases)('$name', ({ schema }) => {
        const primitive = edgesFromPrimitive(schema);
        const runtime = edgesFromRuntime(schema);
        const graph = edgesFromGraph(schema);

        // All three edge sets are identical (deduped + sorted).
        expect(graph).toEqual(primitive);
        expect(runtime).toEqual(primitive);
    });
});
