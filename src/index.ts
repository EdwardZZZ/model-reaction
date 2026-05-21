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
    AppError,
    ValidateFieldOptions,
    InferFieldType,
    InferModelData,
} from './types';
export { ErrorType, ModelEvents } from './types';
export { ValidationRules, Rule } from './rules';
export { ErrorHandler } from './error-handler';

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
    const modelManager = new ModelManager<Record<string, any>>(
        schema as Model,
        options
    );

    return {
        get data() { return { ...modelManager.data }; },
        get validationErrors() { return { ...modelManager.validationErrors }; },
        setField: (field, value) =>
            modelManager.setField(field as string, value),
        getField: (field) => modelManager.getField(field as string),
        setFields: (fields) => modelManager.setFields(fields),
        validateAll: () => modelManager.validateAll(),
        getValidationSummary: () => modelManager.getValidationSummary(),
        on: (event, callback) => modelManager.on(event, callback),
        off: (event, callback) => modelManager.off(event, callback),
        getDirtyData: () => modelManager.getDirtyData(),
        clearDirtyData: () => modelManager.clearDirtyData(),
        settled: () => modelManager.settled(),
        dispose: () => modelManager.dispose(),
        subscribeField: (field, cb) =>
            modelManager.subscribeField(field as string, cb),
        subscribe: (selector, cb, isEqual) =>
            modelManager.subscribe(selector, cb, isEqual),
    };
}
