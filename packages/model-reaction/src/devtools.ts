/**
 * DevTools-enabled entry point: `model-reaction/devtools`.
 *
 * Drop-in replacement for `createModel` from the package root. Swap the import
 * while debugging:
 *
 * ```ts
 * // import { createModel } from 'model-reaction';
 * import { createModel } from 'model-reaction/devtools';
 * ```
 *
 * When a DevTools front-end has installed the global hook, each model created
 * here registers itself against it; otherwise this is a transparent pass-through
 * to the core `createModel`. Because the core entry (`index.ts`) never imports
 * any of this, apps that import only from the package root ship **zero** DevTools
 * code — it lives solely in this separately-bundled entry.
 *
 * The wrapper reads the model exclusively through its public API
 * (`data` / `getDirtyData()` / `validationErrors` / `on`) plus the schema it was
 * handed, so it needs no privileged access to `ModelManager` internals.
 */
import { createModel as baseCreateModel } from './index';
import type {
    FieldSchema,
    InferModelData,
    Model,
    ModelOptions,
    ModelReturn,
} from './types';
import { ModelEvents } from './types';
import {
    attachToDevtools,
    buildDependencyGraph,
    buildFieldInfo,
    getDevtoolsHook,
} from './devtools/devtools-hook';

export function createModel<S extends Record<string, FieldSchema>>(
    schema: S,
    options?: ModelOptions
): ModelReturn<InferModelData<S>>;
export function createModel<T extends Record<string, any>>(
    schema: Model<T>,
    options?: ModelOptions
): ModelReturn<T>;
export function createModel(
    schema: Record<string, FieldSchema>,
    options: ModelOptions = {}
): ModelReturn<any> {
    const model = baseCreateModel(schema as Model<Record<string, any>>, options);

    const hook = getDevtoolsHook();
    // Avoid building integration state when no front-end is listening.
    if (!hook) return model;

    const modelSchema = schema as Model;
    const detach = attachToDevtools(hook, {
        getFields: () => buildFieldInfo(modelSchema),
        getDependencyGraph: () => buildDependencyGraph(modelSchema),
        getSnapshot: () => ({
            // The data getters return stable shallow snapshots; serialization
            // in the DevTools agent handles transport formatting and size limits.
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
    });

    // Chain the disposer so unregistering happens on the model's own lifecycle.
    // `dispose` is a writable arrow-function property on the instance.
    const originalDispose = model.dispose;
    model.dispose = () => {
        detach();
        originalDispose();
    };

    return model;
}
