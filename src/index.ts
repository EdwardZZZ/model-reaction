import { Model, ModelOptions, ModelReturn } from './types';
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
} from './types';
export { ErrorType, ModelEvents } from './types';
export { ValidationRules, Rule } from './rules';
export { ErrorHandler } from './error-handler';

// Factory function - create model instance
export function createModel<T extends Record<string, any> = Record<string, any>>(schema: Model<T>, options: ModelOptions = {}): ModelReturn<T> {
    const modelManager = new ModelManager<T>(schema, options);

    return {
        get data() { return { ...modelManager.data }; },
        get validationErrors() { return { ...modelManager.validationErrors }; },
        setField: (field, value) => modelManager.setField(field, value),
        getField: (field) => modelManager.getField(field),
        setFields: (fields) => modelManager.setFields(fields),
        validateAll: () => modelManager.validateAll(),
        getValidationSummary: () => modelManager.getValidationSummary(),
        on: (event, callback) => modelManager.on(event, callback),
        off: (event, callback) => modelManager.off(event, callback),
        getDirtyData: () => modelManager.getDirtyData(),
        clearDirtyData: () => modelManager.clearDirtyData(),
        settled: () => modelManager.settled(),
        dispose: () => modelManager.dispose(),
    };
}