/**
 * Page agent — runs in the page's MAIN world (same realm as the app and the
 * `model-reaction` library).
 *
 * Responsibilities:
 *   1. Install the global hook the library looks for
 *      (`window.__MODEL_REACTION_DEVTOOLS_HOOK__`). This must be in place
 *      *before* the app calls `createModel`, so the content script injects this
 *      file at `document_start`.
 *   2. Track every registered model instance, subscribe to its changes, and
 *      keep a bounded change timeline (ring buffer) per instance.
 *   3. Bridge to the content relay via `window.postMessage`, and answer panel
 *      requests (`get-init`, `get-snapshot`).
 *
 * It deliberately holds only what it needs (the live `DevtoolsModelInstance`
 * closures plus a capped timeline) so a long-lived page with a chatty model
 * cannot leak unboundedly.
 */
import {
    AGENT_SOURCE,
    DEFAULT_TIMELINE_LIMIT,
    isPanelMessage,
    type AgentMessage,
    type ChangeEntry,
    type InstanceState,
    type PanelMessage,
    type Snapshot,
} from './protocol';
import { serializeRecord, serializeValue } from './serialize';

/** Mirrors `ModelReactionDevtoolsHook` from the library (re-declared, not imported). */
interface HookModelInstance {
    readonly id: number;
    getFields(): Record<string, InstanceState['fields'][string]>;
    getDependencyGraph(): InstanceState['graph'];
    getSnapshot(): {
        data: Record<string, unknown>;
        dirtyData: Record<string, unknown>;
        errors: Record<string, Array<{ field: string; message: string; rule?: string }>>;
    };
    subscribe(listener: (change: { field: string; value: unknown; timestamp: number }) => void): () => void;
}

const HOOK_KEY = '__MODEL_REACTION_DEVTOOLS_HOOK__';

interface TrackedInstance {
    instance: HookModelInstance;
    timeline: ChangeEntry[];
    unsubscribe: () => void;
    seq: number;
}

/**
 * Install the agent. Returns a disposer that removes the global hook and the
 * message listener; callers that inject once per page can ignore it. Returns a
 * no-op disposer (without clobbering) if a hook is already present, e.g. the
 * script was injected twice.
 */
export function installAgent(
    win: Window & typeof globalThis,
    timelineLimit = DEFAULT_TIMELINE_LIMIT
): () => void {
    if ((win as unknown as Record<string, unknown>)[HOOK_KEY]) return () => {};

    const tracked = new Map<number, TrackedInstance>();

    const post = (message: AgentMessage): void => {
        win.postMessage(message, '*');
    };

    const takeSnapshot = (instance: HookModelInstance): Snapshot => {
        const raw = instance.getSnapshot();
        return {
            data: serializeRecord(raw.data),
            dirtyData: serializeRecord(raw.dirtyData),
            errors: raw.errors,
        };
    };

    const toState = (entry: TrackedInstance): InstanceState => ({
        id: entry.instance.id,
        fields: entry.instance.getFields(),
        graph: entry.instance.getDependencyGraph(),
        snapshot: takeSnapshot(entry.instance),
        timeline: entry.timeline.slice(),
    });

    const hook = {
        register(instance: HookModelInstance): void {
            const entry: TrackedInstance = {
                instance,
                timeline: [],
                unsubscribe: () => {},
                seq: 0,
            };
            entry.unsubscribe = instance.subscribe((change) => {
                const record: ChangeEntry = {
                    seq: entry.seq++,
                    field: change.field,
                    value: serializeValue(change.value),
                    timestamp: change.timestamp,
                };
                // Ring buffer: drop the oldest entry past the cap.
                entry.timeline.push(record);
                if (entry.timeline.length > timelineLimit) {
                    entry.timeline.shift();
                }
                post({ source: AGENT_SOURCE, kind: 'change', id: instance.id, change: record });
                // A committed change may also move other fields (reactions), so
                // refresh the snapshot for the whole instance.
                post({
                    source: AGENT_SOURCE,
                    kind: 'snapshot',
                    id: instance.id,
                    snapshot: takeSnapshot(instance),
                });
            });
            tracked.set(instance.id, entry);
            post({ source: AGENT_SOURCE, kind: 'instance-added', instance: toState(entry) });
        },
        unregister(id: number): void {
            const entry = tracked.get(id);
            if (!entry) return;
            entry.unsubscribe();
            tracked.delete(id);
            post({ source: AGENT_SOURCE, kind: 'instance-removed', id });
        },
    };

    Object.defineProperty(win, HOOK_KEY, {
        value: hook,
        // Non-enumerable: it is an internal dev channel, not part of the page's
        // own surface. Configurable so the disposer can remove it cleanly.
        enumerable: false,
        configurable: true,
        writable: false,
    });

    // Answer panel requests relayed back into the page. The `PANEL_SOURCE`
    // marker (checked by isPanelMessage) is the discriminator; the agent's own
    // outbound AgentMessages are ignored because they carry AGENT_SOURCE.
    const onMessage = (event: MessageEvent): void => {
        const msg: unknown = event.data;
        if (!isPanelMessage(msg)) return;
        handlePanelMessage(msg, tracked, toState, takeSnapshot, post);
    };
    win.addEventListener('message', onMessage);

    return () => {
        win.removeEventListener('message', onMessage);
        tracked.forEach((entry) => entry.unsubscribe());
        tracked.clear();
        delete (win as unknown as Record<string, unknown>)[HOOK_KEY];
    };
}

function handlePanelMessage(
    msg: PanelMessage,
    tracked: Map<number, TrackedInstance>,
    toState: (entry: TrackedInstance) => InstanceState,
    takeSnapshot: (instance: HookModelInstance) => Snapshot,
    post: (message: AgentMessage) => void
): void {
    if (msg.kind === 'get-init') {
        post({
            source: AGENT_SOURCE,
            kind: 'init',
            instances: [...tracked.values()].map(toState),
        });
        return;
    }
    // get-snapshot
    const entry = tracked.get(msg.id);
    if (entry) {
        post({
            source: AGENT_SOURCE,
            kind: 'snapshot',
            id: msg.id,
            snapshot: takeSnapshot(entry.instance),
        });
    }
}
