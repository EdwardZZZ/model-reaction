import {
    FieldSchema,
    InferModelData,
    Model,
    ModelOptions,
    ModelReturn,
} from './types';
import { ModelManager } from './model-manager';

// Export common types and validation rules
export type {
    Model,
    ModelOptions,
    ModelReturn,
    Validator,
    Reaction,
    FieldSchema,
    ValidationError,
    ModelError,
    ModelErrorCode,
    ModelEventMap,
    InferFieldType,
    InferModelData,
} from './types';
export { ModelEvents } from './types';
export { ValidationRules, Rule } from './rules';
export {
    formatValidationErrors,
    type ValidationErrorFormatter,
} from './format-validation-errors';

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
export function createModel<T extends Record<string, any>>(
    schema: Model<T>,
    options?: ModelOptions
): ModelReturn<T>;
export function createModel<S extends Record<string, FieldSchema>>(
    schema: S,
    options?: ModelOptions
): ModelReturn<InferModelData<S>>;
export function createModel(
    schema: Record<string, FieldSchema>,
    options: ModelOptions = {}
): ModelReturn<any> {
    const manager = new ModelManager<Record<string, any>>(
        schema as Model<Record<string, any>>,
        options
    );
    return manager as unknown as ModelReturn<any>;
}
