/**
 * Wire protocol shared across every layer of the DevTools extension:
 * page agent (MAIN world) → content relay (ISOLATED world) → background
 * service worker → DevTools panel.
 *
 * Everything here must survive `structuredClone` (window.postMessage) *and*
 * JSON round-tripping (chrome.runtime messaging), so payloads are restricted
 * to plain, already-serialized data. The page agent is responsible for turning
 * arbitrary model values into the `SerializedValue` tree below before they
 * enter this protocol.
 *
 * The `Devtools*` shapes intentionally mirror `src/devtools-hook.ts` in the
 * library. They are re-declared (not imported) so the extension builds as a
 * standalone package with no dependency on the library's internal source.
 */

/** Marker so both directions can filter foreign `window.postMessage` traffic. */
export const AGENT_SOURCE = 'model-reaction-devtools-agent';
export const PANEL_SOURCE = 'model-reaction-devtools-panel';

/** Default cap on the per-instance change timeline (see README — tunable, TBD). */
export const DEFAULT_TIMELINE_LIMIT = 100;

// -----------------------------------------------------------------------------
// Serialized value tree (display-friendly, transport-safe)
// -----------------------------------------------------------------------------

/**
 * A JSON-safe, self-describing representation of any model value. The panel
 * renders this directly into the data tree without needing the original types.
 */
export type SerializedValue =
    | { t: 'primitive'; v: string | number | boolean | null }
    | { t: 'undefined' }
    | { t: 'bigint'; v: string }
    | { t: 'date'; v: string }
    | { t: 'function'; name: string }
    | { t: 'symbol'; v: string }
    | { t: 'circular' }
    | { t: 'truncated'; note: string }
    | { t: 'array'; items: SerializedValue[] }
    | { t: 'object'; entries: Array<[string, SerializedValue]> };

// -----------------------------------------------------------------------------
// Domain payloads (mirror src/devtools-hook.ts)
// -----------------------------------------------------------------------------

export interface FieldInfo {
    type: string;
    hasDefault: boolean;
    validatorCount: number;
    reactionDeps: string[];
}

export interface DependencyEdge {
    from: string;
    to: string;
}

export interface DependencyGraph {
    nodes: string[];
    edges: DependencyEdge[];
}

/** The three-layer snapshot, with every value pre-serialized. */
export interface Snapshot {
    data: Record<string, SerializedValue>;
    dirtyData: Record<string, SerializedValue>;
    errors: Record<string, Array<{ field: string; message: string; rule?: string }>>;
}

export interface ChangeEntry {
    seq: number;
    field: string;
    value: SerializedValue;
    timestamp: number;
}

/** Everything the panel needs to render one model instance. */
export interface InstanceState {
    id: number;
    fields: Record<string, FieldInfo>;
    graph: DependencyGraph;
    snapshot: Snapshot;
    timeline: ChangeEntry[];
}

// -----------------------------------------------------------------------------
// Agent → Panel messages
// -----------------------------------------------------------------------------

export type AgentMessage =
    /** Full current state — sent on connect and on explicit `get-init`. */
    | { source: typeof AGENT_SOURCE; kind: 'init'; instances: InstanceState[] }
    | { source: typeof AGENT_SOURCE; kind: 'instance-added'; instance: InstanceState }
    | { source: typeof AGENT_SOURCE; kind: 'instance-removed'; id: number }
    | { source: typeof AGENT_SOURCE; kind: 'snapshot'; id: number; snapshot: Snapshot }
    | { source: typeof AGENT_SOURCE; kind: 'change'; id: number; change: ChangeEntry };

// -----------------------------------------------------------------------------
// Panel → Agent messages
// -----------------------------------------------------------------------------

export type PanelMessage =
    /** Ask the agent to (re)send the full `init` state. */
    | { source: typeof PANEL_SOURCE; kind: 'get-init' }
    /** Force a fresh snapshot for one instance. */
    | { source: typeof PANEL_SOURCE; kind: 'get-snapshot'; id: number };

/** Narrowing guards used by the relay and panel. */
export function isAgentMessage(msg: unknown): msg is AgentMessage {
    return (
        typeof msg === 'object' &&
        msg !== null &&
        (msg as { source?: unknown }).source === AGENT_SOURCE
    );
}

export function isPanelMessage(msg: unknown): msg is PanelMessage {
    return (
        typeof msg === 'object' &&
        msg !== null &&
        (msg as { source?: unknown }).source === PANEL_SOURCE
    );
}
