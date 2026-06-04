import { ModelManager } from './model-manager';
import {
    FieldSchema,
    InferModelData,
    Model,
    ModelOptions,
    ModelReturn,
} from './types';

export type {
    FieldSchema,
    InferFieldType,
    InferModelData,
    Model,
    ModelError,
    ModelOptions,
    ModelReturn,
    Reaction,
    ValidationError,
    Validator,
    ErrorKind,
} from './types';
export { FIELD_CHANGE, ERROR } from './types';
export { Rule, ValidationRules } from './rules';

/**
 * Create a synchronous model instance.
 *
 * Same call shape as the full `model-reaction` package, but every mutation
 * returns `boolean` synchronously and there is no `settled()`.
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
    const m = new ModelManager<Record<string, any>>(schema as Model, options);

    return {
        get data() {
            return { ...m.data };
        },
        get validationErrors() {
            return { ...m.validationErrors };
        },
        setField: (field, value) => m.setField(field as string, value),
        getField: (field) => m.getField(field as string),
        setFields: (fields) => m.setFields(fields),
        validateAll: () => m.validateAll(),
        on: (event, cb) => m.on(event, cb),
        off: (event, cb) => m.off(event, cb),
        dispose: () => m.dispose(),
        subscribe: (selector, cb) => m.subscribe(selector, cb),
    };
}
