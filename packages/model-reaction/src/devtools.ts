/** Optional DevTools integration; see docs/DEVTOOLS.md. */
import { createModel as baseCreateModel } from './index';
import type {
    FieldSchema,
    Model,
    ModelOptions,
    ModelReturn,
    ReactionAction,
    ValidationError,
} from './types';
import { ModelEvents } from './types';
import { eachReactionEdge } from './reaction/reaction-graph';
import { observeModelSelectors, type SelectorObserver } from './devtools-observer';

const DEVTOOLS_HOOK_KEY = '__MODEL_REACTION_DEVTOOLS_HOOK__';

interface DevtoolsFieldInfo {
    type: FieldSchema['type'];
    hasDefault: boolean;
    validatorCount: number;
    reactionDeps: string[];
    actions?: Array<{ reactionIndex: number; actionIndex: number; name: string; functionId: number }>;
}

interface DevtoolsDependencyEdge {
    from: string;
    to: string;
}

interface DevtoolsDependencyGraph {
    nodes: string[];
    edges: DevtoolsDependencyEdge[];
}

interface DevtoolsSnapshot {
    data: Record<string, unknown>;
    dirtyData: Record<string, unknown>;
    errors: Record<string, ValidationError[]>;
}

interface DevtoolsChange {
    field: string;
    value: unknown;
    timestamp: number;
}

interface DevtoolsModelInstance {
    readonly id: number;
    getFields(): Record<string, DevtoolsFieldInfo>;
    getDependencyGraph(): DevtoolsDependencyGraph;
    getSnapshot(): DevtoolsSnapshot;
    subscribe(listener: (change: DevtoolsChange) => void): () => void;
    subscribeSnapshot?(listener: () => void): () => void;
    observeSelector?: SelectorObserver;
}

interface ModelReactionDevtoolsHook {
    register(instance: DevtoolsModelInstance, model?: object): void;
    unregister(id: number): void;
    getDerivedObserver?(model: object): SelectorObserver | undefined;
}

/** Return the global hook if both register and unregister are callable. */
function getDevtoolsHook(): ModelReactionDevtoolsHook | undefined {
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

/** Register the model instance and return cleanup, swallowing registration and cleanup failures. */
function attachToDevtools(
    hook: ModelReactionDevtoolsHook,
    instance: Omit<DevtoolsModelInstance, 'id'>,
    model: object
): () => void {
    const id = nextInstanceId++;
    const full: DevtoolsModelInstance = { id, ...instance };
    try {
        hook.register(full, model);
    } catch {
        return () => {};
    }
    return () => {
        try {
            hook.unregister(id);
        } catch {
            // DevTools failures must not interrupt model disposal.
        }
    };
}

/** Build field metadata with deduplicated dependencies and shared action IDs by function reference. */
function buildFieldInfo(schema: Model): Record<string, DevtoolsFieldInfo> {
    const out: Record<string, DevtoolsFieldInfo> = Object.create(null);
    const functionIds = new Map<ReactionAction, number>();
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
        if (field.reaction?.action?.length) {
            out[name]!.actions = field.reaction.action.map((action, actionIndex) => {
                if (!functionIds.has(action)) functionIds.set(action, functionIds.size);
                return {
                    reactionIndex: 0,
                    actionIndex,
                    name: action.name,
                    functionId: functionIds.get(action)!,
                };
            });
        }
    }
    return { ...out };
}

/** Derive nodes and dependency-to-field edges from the field metadata. */
function buildDependencyGraph(
    fields: Record<string, DevtoolsFieldInfo>
): DevtoolsDependencyGraph {
    const nodes = Object.keys(fields);
    const edges: DevtoolsDependencyEdge[] = [];
    for (const [to, info] of Object.entries(fields)) {
        for (const from of info.reactionDeps) {
            edges.push({ from, to });
        }
    }
    return { nodes, edges };
}

/** Create a model with DevTools inspection and disposal cleanup when a valid global hook exists. */
export const createModel: typeof baseCreateModel = (
    schema: Record<string, FieldSchema>,
    options: ModelOptions = {}
): ModelReturn<any> => {
    const model = baseCreateModel(schema as Model<Record<string, any>>, options);

    const hook = getDevtoolsHook();
    if (!hook) return model;

    const fields = buildFieldInfo(schema as Model);
    const graph = buildDependencyGraph(fields);
    const detach = attachToDevtools(hook, {
        ...(typeof hook.getDerivedObserver === 'function'
            ? { observeSelector: observeModelSelectors(model) } : {}),
        getFields: () => fields,
        getDependencyGraph: () => graph,
        getSnapshot: () => ({
            data: model.data,
            dirtyData: model.getDirtyData(),
            errors: Object.fromEntries(
                Object.entries(model.validationErrors).map(([field, errors]) => [
                    field,
                    [...errors],
                ])
            ),
        }),
        subscribe: (listener) =>
            model.on(ModelEvents.FIELD_CHANGE, ({ field, value }) =>
                listener({
                    field: field as string,
                    value,
                    timestamp: Date.now(),
                })
            ),
        subscribeSnapshot: (listener) => {
            const unsubscribers = [
                model.on(ModelEvents.FIELD_VALIDATION_COMPLETE, listener),
                model.on(ModelEvents.DIRTY_DATA_CLEARED, listener),
                model.on(ModelEvents.REACTION_ERROR, listener),
            ];
            return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
        },
    }, model);

    const originalDispose = model.dispose;
    model.dispose = () => {
        detach();
        originalDispose();
    };

    return model;
};
