/**
 * Panel-side state model, independent of React and of the chrome messaging
 * transport, so it can be unit-tested in isolation.
 *
 * {@link panelReducer} folds the stream of {@link AgentMessage}s coming from the
 * page agent into a {@link PanelState}: a map of live model instances plus the
 * currently selected instance id. The React panel wraps this reducer; the
 * transport ({@link createPanelPort}) feeds messages into it.
 */
import type {
    AgentMessage,
    ChangeEntry,
    InstanceState,
} from './protocol';

export interface PanelState {
    /** Live instances by id, in insertion order (Map preserves it). */
    instances: Map<number, InstanceState>;
    /** Currently selected instance id, or null when none exist. */
    selectedId: number | null;
}

export function initialPanelState(): PanelState {
    return { instances: new Map(), selectedId: null };
}

/** Append a change to an instance's timeline, honoring the ring-buffer cap. */
function pushChange(
    instance: InstanceState,
    change: ChangeEntry,
    timelineLimit: number
): InstanceState {
    const timeline = [...instance.timeline, change];
    if (timeline.length > timelineLimit) timeline.shift();
    return { ...instance, timeline };
}

export function panelReducer(
    state: PanelState,
    message: AgentMessage,
    timelineLimit = 100
): PanelState {
    switch (message.kind) {
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
        case 'snapshot': {
            const existing = state.instances.get(message.id);
            if (!existing) return state;
            const instances = new Map(state.instances);
            instances.set(message.id, {
                ...existing,
                snapshot: message.snapshot,
            });
            return { ...state, instances };
        }
        case 'change': {
            const existing = state.instances.get(message.id);
            if (!existing) return state;
            const instances = new Map(state.instances);
            instances.set(
                message.id,
                pushChange(existing, message.change, timelineLimit)
            );
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
