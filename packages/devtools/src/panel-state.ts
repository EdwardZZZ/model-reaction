/**
 * Panel-side state model, independent of React and of the chrome messaging
 * transport, so it can be unit-tested in isolation.
 *
 * {@link panelReducer} folds the stream of {@link AgentMessage}s coming from the
 * page agent into a {@link PanelState}: a map of live model instances plus the
 * currently selected instance id. The React panel wraps this reducer; the
 * transport ({@link createPanelPort}) feeds messages into it.
 */
import { DEFAULT_TIMELINE_LIMIT, type AgentMessage, type InstanceState } from './protocol';

export interface PanelState {
    /** Live instances by id, in insertion order (Map preserves it). */
    instances: Map<number, InstanceState>;
    /** Currently selected instance id, or null when none exist. */
    selectedId: number | null;
}

/** Local selection never enters the agent transport protocol. */
export type PanelAction = AgentMessage | { kind: 'select'; id: number };

export function initialPanelState(): PanelState {
    return { instances: new Map(), selectedId: null };
}

export function panelReducer(
    state: PanelState,
    message: PanelAction,
    timelineLimit = DEFAULT_TIMELINE_LIMIT
): PanelState {
    switch (message.kind) {
        case 'select':
            return state.instances.has(message.id)
                ? { ...state, selectedId: message.id }
                : state;
        case 'init': {
            const instances = new Map<number, InstanceState>();
            message.instances.forEach((inst) => instances.set(inst.id, inst));
            const selectedId = pickSelection(instances, state.selectedId);
            return { instances, selectedId };
        }
        case 'instance-added': {
            const instances = new Map(state.instances);
            instances.set(message.instance.id, message.instance);
            return {
                instances,
                selectedId: state.selectedId ?? message.instance.id,
            };
        }
        case 'instance-removed': {
            const instances = new Map(state.instances);
            instances.delete(message.id);
            const selectedId =
                state.selectedId === message.id
                    ? pickSelection(instances, null)
                    : state.selectedId;
            return { instances, selectedId };
        }
        case 'snapshot':
        case 'timeline-cleared':
        case 'change': {
            const existing = state.instances.get(message.id);
            if (!existing) return state;
            const next = { ...existing };
            if (message.kind === 'snapshot') {
                next.snapshot = message.snapshot;
            } else if (message.kind === 'timeline-cleared') {
                next.timeline = [];
            } else {
                next.timeline = [...existing.timeline, message.change];
                if (next.timeline.length > timelineLimit) next.timeline.shift();
            }
            const instances = new Map(state.instances);
            instances.set(message.id, next);
            return { ...state, instances };
        }
        default: {
            // Exhaustiveness guard: a new AgentMessage kind must be handled here.
            return assertNever(message);
        }
    }
}

/** Choose a sensible selection: keep the current one if still present. */
function pickSelection(
    instances: Map<number, InstanceState>,
    current: number | null
): number | null {
    if (current !== null && instances.has(current)) return current;
    const first = instances.keys().next();
    return first.done ? null : first.value;
}

function assertNever(x: never): never {
    throw new Error(`Unhandled AgentMessage: ${JSON.stringify(x)}`);
}
