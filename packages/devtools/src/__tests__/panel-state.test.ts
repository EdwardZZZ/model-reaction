import {
    initialPanelState,
    panelReducer,
    type PanelState,
} from '../panel-state';
import {
    AGENT_SOURCE,
    type AgentMessage,
    type InstanceState,
} from '../protocol';

function makeInstance(id: number, timelineLen = 0): InstanceState {
    return {
        id,
        fields: {
            a: { type: 'string', hasDefault: true, validatorCount: 0, reactionDeps: [] },
        },
        graph: { nodes: ['a'], edges: [] },
        snapshot: {
            data: { a: { t: 'primitive', v: '' } },
            dirtyData: {},
            errors: {},
        },
        timeline: Array.from({ length: timelineLen }, (_, i) => ({
            seq: i,
            field: 'a',
            value: { t: 'primitive' as const, v: `v${i}` },
            timestamp: i,
        })),
    };
}

const init = (instances: InstanceState[]): AgentMessage => ({
    source: AGENT_SOURCE,
    kind: 'init',
    instances,
});

describe('panelReducer', () => {
    test('init populates instances and selects the first', () => {
        const state = panelReducer(initialPanelState(), init([makeInstance(1), makeInstance(2)]));
        expect([...state.instances.keys()]).toEqual([1, 2]);
        expect(state.selectedId).toBe(1);
    });

    test('init keeps the current selection if still present', () => {
        let state: PanelState = panelReducer(initialPanelState(), init([makeInstance(1), makeInstance(2)]));
        state = { ...state, selectedId: 2 };
        state = panelReducer(state, init([makeInstance(1), makeInstance(2)]));
        expect(state.selectedId).toBe(2);
    });

    test('init with empty list clears selection', () => {
        const state = panelReducer(initialPanelState(), init([]));
        expect(state.selectedId).toBeNull();
        expect(state.instances.size).toBe(0);
    });

    test('instance-added selects it when nothing was selected', () => {
        const state = panelReducer(initialPanelState(), {
            source: AGENT_SOURCE,
            kind: 'instance-added',
            instance: makeInstance(5),
        });
        expect(state.selectedId).toBe(5);
        expect(state.instances.has(5)).toBe(true);
    });

    test('instance-added keeps existing selection', () => {
        let state = panelReducer(initialPanelState(), init([makeInstance(1)]));
        state = panelReducer(state, {
            source: AGENT_SOURCE,
            kind: 'instance-added',
            instance: makeInstance(2),
        });
        expect(state.selectedId).toBe(1);
        expect([...state.instances.keys()]).toEqual([1, 2]);
    });

    test('instance-removed reselects when the selected one goes away', () => {
        let state = panelReducer(initialPanelState(), init([makeInstance(1), makeInstance(2)]));
        state = panelReducer(state, {
            source: AGENT_SOURCE,
            kind: 'instance-removed',
            id: 1,
        });
        expect(state.instances.has(1)).toBe(false);
        expect(state.selectedId).toBe(2);
    });

    test('instance-removed keeps selection when a different one goes away', () => {
        let state = panelReducer(initialPanelState(), init([makeInstance(1), makeInstance(2)]));
        state = panelReducer(state, {
            source: AGENT_SOURCE,
            kind: 'instance-removed',
            id: 2,
        });
        expect(state.selectedId).toBe(1);
    });

    test('snapshot replaces an instance snapshot', () => {
        let state = panelReducer(initialPanelState(), init([makeInstance(1)]));
        state = panelReducer(state, {
            source: AGENT_SOURCE,
            kind: 'snapshot',
            id: 1,
            snapshot: {
                data: { a: { t: 'primitive', v: 'updated' } },
                dirtyData: {},
                errors: {},
            },
        });
        expect(state.instances.get(1)!.snapshot.data.a).toEqual({
            t: 'primitive',
            v: 'updated',
        });
    });

    test('snapshot for an unknown instance is a no-op', () => {
        const before = panelReducer(initialPanelState(), init([makeInstance(1)]));
        const after = panelReducer(before, {
            source: AGENT_SOURCE,
            kind: 'snapshot',
            id: 999,
            snapshot: { data: {}, dirtyData: {}, errors: {} },
        });
        expect(after).toBe(before);
    });

    test('change appends to the timeline', () => {
        let state = panelReducer(initialPanelState(), init([makeInstance(1)]));
        state = panelReducer(state, {
            source: AGENT_SOURCE,
            kind: 'change',
            id: 1,
            change: {
                seq: 0,
                field: 'a',
                value: { t: 'primitive', v: 'x' },
                timestamp: 1,
            },
        });
        expect(state.instances.get(1)!.timeline).toHaveLength(1);
    });

    test('change respects the timeline limit (ring buffer)', () => {
        let state = panelReducer(initialPanelState(), init([makeInstance(1, 3)]));
        state = panelReducer(
            state,
            {
                source: AGENT_SOURCE,
                kind: 'change',
                id: 1,
                change: {
                    seq: 3,
                    field: 'a',
                    value: { t: 'primitive', v: 'newest' },
                    timestamp: 10,
                },
            },
            3
        );
        const timeline = state.instances.get(1)!.timeline;
        expect(timeline).toHaveLength(3);
        expect(timeline[timeline.length - 1]!.seq).toBe(3);
        // Oldest (seq 0) dropped.
        expect(timeline[0]!.seq).toBe(1);
    });

    test('change for an unknown instance is a no-op', () => {
        const before = panelReducer(initialPanelState(), init([makeInstance(1)]));
        const after = panelReducer(before, {
            source: AGENT_SOURCE,
            kind: 'change',
            id: 999,
            change: {
                seq: 0,
                field: 'a',
                value: { t: 'primitive', v: 'x' },
                timestamp: 1,
            },
        });
        expect(after).toBe(before);
    });
});
