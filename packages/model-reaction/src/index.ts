import {
    FieldSchema,
    InferModelData,
    Model,
    ModelReturn,
} from './types';
import { ModelManager } from './core/model-manager';

export type {
    Model,
    ModelReturn,
    Reaction,
    ReactionAction,
    FieldSchema,
    ModelError,
    ModelErrorCode,
    ModelEventMap,
    InferFieldType,
    InferModelData,
} from './types';
export { ModelEvents, SKIP_REACTION } from './types';

/**
 * Create a model instance.
 *
 * Two call styles:
 *   1. With explicit data type:
 *        createModel<User>(schema)
 *   2. With inferred data type (from schema literal):
 *        const m = createModel({ name: { type: 'string' }, age: { type: 'number' } });
 *        // m.data is { name: string; age: number }
 */
export function createModel<S extends Record<string, FieldSchema>>(
    schema: S
): ModelReturn<InferModelData<S>>;
export function createModel<T extends Record<string, any>>(
    schema: Model<T>
): ModelReturn<T>;
export function createModel(
    schema: Record<string, FieldSchema>
): ModelReturn<any> {
    const manager = new ModelManager<Record<string, any>>(
        schema as Model<Record<string, any>>
    );
    return manager as unknown as ModelReturn<any>;
}
