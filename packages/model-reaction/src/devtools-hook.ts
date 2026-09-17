/**
 * DevTools integration boundary.
 *
 * This module defines the contract between a `model-reaction` model and an
 * (optional) DevTools front-end — e.g. a browser extension. It mirrors the
 * pattern used by React / Redux / Vue DevTools: the extension installs a
 * global hook *before* the app boots, and the library registers each model
 * against that hook if — and only if — it exists.
 *
 * Design constraints:
 *   - **Zero overhead when absent.** If no hook is installed (the normal
 *     production case), {@link getDevtoolsHook} returns `undefined` after a
 *     single property read and the library allocates nothing further.
 *   - **Not a public introspection API.** Nothing here is re-exported from the
 *     package entry point (`index.ts`). The hook is a private, dev-time channel
 *     for tooling, not a method surface on `ModelReturn`. This keeps the
 *     library's public contract (and AGENTS.md §5) intact.
 *   - **Live functions, not serialized data.** The hook receives closures that
 *     read the model on demand. Serialization for cross-realm transport is the
 *     DevTools agent's concern, not the library's.
 */
import type { FieldSchema, Model, ValidationError } from './types';
import { eachReactionEdge } from './reaction-graph';

/** The `globalThis` key the DevTools front-end installs its hook under. */
export const DEVTOOLS_HOOK_KEY = '__MODEL_REACTION_DEVTOOLS_HOOK__';

/** Read-only, serialization-friendly summary of one field's schema. */
export interface DevtoolsFieldInfo {
    /** Declared field type (`'string' | 'number' | ...`). */
    type: FieldSchema['type'];
    /** Whether the field declares a `default` (bypasses initial validation). */
    hasDefault: boolean;
    /** Number of validators attached to the field. */
    validatorCount: number;
    /** Fields this field's reaction(s) read as dependencies (deduped). */
    reactionDeps: string[];
}

/**
 * A directed dependency edge. Direction is **data-flow**: when `from` changes,
 * the reaction that computes `to` re-runs. Read it as "`from` feeds `to`".
 */
export interface DevtoolsDependencyEdge {
    from: string;
    to: string;
}

/** The reaction dependency graph, ready for a DevTools graph view. */
export interface DevtoolsDependencyGraph {
    /** Every field name in the schema (isolated nodes included). */
    nodes: string[];
    /** Deduped data-flow edges derived from every `reaction.fields`. */
    edges: DevtoolsDependencyEdge[];
}

/** Point-in-time view of a model's three-layer state. */
export interface DevtoolsSnapshot {
    /** Validated source of truth. */
    data: Record<string, unknown>;
    /** Last user input that failed validation, indexed by field. */
    dirtyData: Record<string, unknown>;
    /** Current validation errors, indexed by field. */
    errors: Record<string, ValidationError[]>;
}

/** A single committed field change, forwarded to attached DevTools. */
export interface DevtoolsChange {
    field: string;
    value: unknown;
    /** `Date.now()` at emission — used to build the change timeline. */
    timestamp: number;
}

/**
 * The instance surface a model exposes to attached DevTools. All reads are
 * pull-based (safe to call at any time); `subscribe` is push-based for the
 * change timeline.
 */
export interface DevtoolsModelInstance {
    /** Unique per-page id, assigned by {@link attachToDevtools}. */
    readonly id: number;
    /** Per-field schema summary. */
    getFields(): Record<string, DevtoolsFieldInfo>;
    /** Reaction dependency graph. */
    getDependencyGraph(): DevtoolsDependencyGraph;
    /** Current three-layer state snapshot. */
    getSnapshot(): DevtoolsSnapshot;
    /** Subscribe to committed field changes; returns an unsubscribe fn. */
    subscribe(listener: (change: DevtoolsChange) => void): () => void;
}

/**
 * The global hook contract, implemented by the DevTools front-end (page agent)
 * and consumed here. Kept intentionally tiny so a future protocol revision does
 * not force a library change.
 */
export interface ModelReactionDevtoolsHook {
    register(instance: DevtoolsModelInstance): void;
    unregister(id: number): void;
}

/**
 * Return the installed DevTools hook, or `undefined` if none is present or the
 * object under {@link DEVTOOLS_HOOK_KEY} does not satisfy the contract. This is
 * the single hot-path guard: in production (no extension) it returns after one
 * property read.
 */
export function getDevtoolsHook(): ModelReactionDevtoolsHook | undefined {
    const candidate = (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY];
    if (
        candidate &&
        typeof (candidate as ModelReactionDevtoolsHook).register === 'function' &&
        typeof (candidate as ModelReactionDevtoolsHook).unregister === 'function'
    ) {
        return candidate as ModelReactionDevtoolsHook;
    }
    return undefined;
}

let nextInstanceId = 0;

/**
 * Register a model instance against an already-resolved hook and return a
 * cleanup function that unregisters it. Callers should resolve the hook via
 * {@link getDevtoolsHook} first and skip building the instance object entirely
 * when it is absent, to preserve the zero-allocation guarantee.
 *
 * Both `register` and `unregister` are wrapped defensively: a broken DevTools
 * front-end must never take the host application down with it.
 */
export function attachToDevtools(
    hook: ModelReactionDevtoolsHook,
    instance: Omit<DevtoolsModelInstance, 'id'>
): () => void {
    const id = nextInstanceId++;
    const full: DevtoolsModelInstance = { id, ...instance };
    try {
        hook.register(full);
    } catch {
        // A failed registration leaves the app fully functional; there is
        // nothing to clean up, so hand back a no-op.
        return () => {};
    }
    return () => {
        try {
            hook.unregister(id);
        } catch {
            // Ignore: unregister failures are DevTools-side and non-fatal.
        }
    };
}

/**
 * Derive a per-field {@link DevtoolsFieldInfo} map from a schema literal. Pure
 * and side-effect free — the schema is a plain object, so this just reads it
 * (see AGENTS.md §4.5). Reaction dependencies are read through the shared
 * {@link eachReactionEdge} primitive so this and the runtime reaction index
 * interpret `reaction.fields` identically.
 */
export function buildFieldInfo(schema: Model): Record<string, DevtoolsFieldInfo> {
    const out: Record<string, DevtoolsFieldInfo> = {};
    // Deduped dependency sets per computed field, filled by the shared walk.
    const deps = new Map<string, Set<string>>();
    eachReactionEdge(schema, (computedField, dependencyField) => {
        if (!deps.has(computedField)) deps.set(computedField, new Set());
        deps.get(computedField)!.add(dependencyField);
    });

    for (const [name, field] of Object.entries(schema)) {
        out[name] = {
            type: field.type,
            hasDefault: field.default !== undefined,
            validatorCount: field.validator?.length ?? 0,
            reactionDeps: [...(deps.get(name) ?? [])],
        };
    }
    return out;
}

/**
 * Project the dependency graph from {@link buildFieldInfo}'s output. Each
 * computed field's deduped `reactionDeps` become incoming edges
 * `dependency → field`, so the graph is a plain rewrite of the field info —
 * no second schema walk, and it shares the exact dependency reading used
 * everywhere else.
 */
export function buildDependencyGraph(schema: Model): DevtoolsDependencyGraph {
    const fields = buildFieldInfo(schema);
    const nodes = Object.keys(fields);
    const edges: DevtoolsDependencyEdge[] = [];
    for (const [to, info] of Object.entries(fields)) {
        // reactionDeps is already deduped, so edges are unique by construction.
        for (const from of info.reactionDeps) {
            edges.push({ from, to });
        }
    }
    return { nodes, edges };
}
