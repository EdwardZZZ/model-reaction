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
 *      requests (`get-init`, `get-snapshot`, `clear-timeline`).
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
    type DerivedValue,
} from './protocol';
import { serializeSnapshot, serializeValue } from './serialize';

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
    subscribeSnapshot?(listener: () => void): () => void;
    observeSelector?<T extends Record<string, any>, R>(
        data: Readonly<T>, selector: (data: Readonly<T>) => R
    ): { value: R; fields?: string[] };
}

const HOOK_KEY = '__MODEL_REACTION_DEVTOOLS_HOOK__';

type RawDerivedValue = Omit<DerivedValue, 'value'> & { value: unknown };

interface TrackedInstance {
    instance: HookModelInstance;
    model: object | undefined;
    timeline: ChangeEntry[];
    values: Map<string, unknown>;
    derivedValues: Map<object, RawDerivedValue> | undefined;
    nextDerivedId: number;
    unsubscribe: () => void;
    seq: number;
    snapshotQueued: boolean;
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
    const modelIds = new WeakMap<object, number>();

    const post = (message: AgentMessage): void => {
        win.postMessage(message, '*');
    };

    const takeSnapshot = (entry: TrackedInstance): Snapshot =>
        serializeSnapshot({
            ...entry.instance.getSnapshot(),
            ...(entry.derivedValues ? { derivedValues: [...entry.derivedValues.values()] } : {}),
        });

    const toState = (entry: TrackedInstance): InstanceState => ({
        id: entry.instance.id,
        fields: entry.instance.getFields(),
        graph: entry.instance.getDependencyGraph(),
        snapshot: takeSnapshot(entry),
        timeline: entry.timeline.slice(),
    });

    const scheduleSnapshot = (entry: TrackedInstance): void => {
        if (tracked.get(entry.instance.id) !== entry || entry.snapshotQueued) return;
        entry.snapshotQueued = true;
        queueMicrotask(() => {
            entry.snapshotQueued = false;
            if (tracked.get(entry.instance.id) !== entry) return;
            post({
                source: AGENT_SOURCE,
                kind: 'snapshot',
                id: entry.instance.id,
                snapshot: takeSnapshot(entry),
            });
        });
    };

    const release = (entry: TrackedInstance): void => {
        if (tracked.get(entry.instance.id) === entry) tracked.delete(entry.instance.id);
        if (entry.model !== undefined && modelIds.get(entry.model) === entry.instance.id) {
            modelIds.delete(entry.model);
        }
        entry.values.clear();
        entry.derivedValues?.clear();
        entry.timeline.length = 0;
        entry.unsubscribe();
    };

    const hook = {
        register(instance: HookModelInstance, model?: object): void {
            if (tracked.has(instance.id)) throw new Error(`DevTools instance ${instance.id} is already registered`);
            const unsubscribers: Array<() => void> = [];
            const entry: TrackedInstance = {
                instance,
                model,
                timeline: [],
                values: new Map(Object.entries(instance.getSnapshot().data)),
                derivedValues: model === undefined ? undefined : new Map(),
                nextDerivedId: 1,
                unsubscribe: () => {
                    for (const unsubscribe of unsubscribers.splice(0)) {
                        try {
                            unsubscribe();
                        } catch {
                            // Attempt every cleanup without masking a registration failure.
                        }
                    }
                },
                seq: 0,
                snapshotQueued: false,
            };
            try {
                unsubscribers.push(instance.subscribe((change) => {
                    if (tracked.get(instance.id) !== entry) return;
                    const record: ChangeEntry = {
                        seq: entry.seq++,
                        field: change.field,
                        value: serializeValue(change.value),
                        previous: serializeValue(entry.values.get(change.field)),
                        timestamp: change.timestamp,
                    };
                    entry.values.set(change.field, change.value);
                    // Ring buffer: drop the oldest entry past the cap.
                    entry.timeline.push(record);
                    if (entry.timeline.length > timelineLimit) {
                        entry.timeline.shift();
                    }
                    post({ source: AGENT_SOURCE, kind: 'change', id: instance.id, change: record });
                    // A committed change may also move other fields (reactions), so
                    // refresh the whole instance once at the end of this microtask.
                    scheduleSnapshot(entry);
                }));
                const unsubscribeSnapshot = instance.subscribeSnapshot?.(() => scheduleSnapshot(entry));
                if (unsubscribeSnapshot) unsubscribers.push(unsubscribeSnapshot);
                const state = toState(entry);
                tracked.set(instance.id, entry);
                if (model !== undefined) modelIds.set(model, instance.id);
                post({ source: AGENT_SOURCE, kind: 'instance-added', instance: state });
            } catch (error) {
                release(entry);
                throw error;
            }
        },
        unregister(id: number): void {
            const entry = tracked.get(id);
            if (!entry) return;
            release(entry);
            post({ source: AGENT_SOURCE, kind: 'instance-removed', id });
        },
        getDerivedObserver(model: object): HookModelInstance['observeSelector'] {
            const id = modelIds.get(model);
            return id === undefined ? undefined : tracked.get(id)?.instance.observeSelector;
        },
        updateDerived(model: object, token: object, selection: Omit<RawDerivedValue, 'id'> | null): void {
            const id = modelIds.get(model);
            const entry = id === undefined ? undefined : tracked.get(id);
            const values = entry?.derivedValues;
            if (!entry || !values) return;
            if (selection === null) {
                if (values.delete(token)) scheduleSnapshot(entry);
                return;
            }
            const previous = values.get(token);
            if (previous && Object.is(previous.value, selection.value) &&
                previous.kind === selection.kind && previous.debugName === selection.debugName &&
                JSON.stringify(previous.fields) === JSON.stringify(selection.fields)) return;
            values.set(token, { ...selection, id: previous?.id ?? entry.nextDerivedId++ });
            scheduleSnapshot(entry);
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
        tracked.forEach(release);
        delete (win as unknown as Record<string, unknown>)[HOOK_KEY];
    };
}

function handlePanelMessage(
    msg: PanelMessage,
    tracked: Map<number, TrackedInstance>,
    toState: (entry: TrackedInstance) => InstanceState,
    takeSnapshot: (entry: TrackedInstance) => Snapshot,
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
    const entry = tracked.get(msg.id);
    if (!entry) return;
    if (msg.kind === 'clear-timeline') {
        entry.timeline = [];
        post({ source: AGENT_SOURCE, kind: 'timeline-cleared', id: msg.id });
    } else if (msg.kind === 'get-snapshot') {
        post({
            source: AGENT_SOURCE,
            kind: 'snapshot',
            id: msg.id,
            snapshot: takeSnapshot(entry),
        });
    }
}
