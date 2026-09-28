export const ModelEvents = {
    VALIDATION_ERROR: 'validation:error',
    REACTION_ERROR: 'reaction:error',
    DEPENDENCY_ERROR: 'dependency:error',
    FIELD_NOT_FOUND: 'field:not-found',
    FIELD_CHANGE: 'field:change',
    VALIDATION_COMPLETE: 'validation:complete',
    FIELD_VALIDATION_COMPLETE: 'field:validation-complete',
    DIRTY_DATA_CLEARED: 'dirty-data:cleared',
} as const;

export type ModelErrorEvent =
    | typeof ModelEvents.REACTION_ERROR
    | typeof ModelEvents.DEPENDENCY_ERROR
    | typeof ModelEvents.FIELD_NOT_FOUND;

// Enhanced validator interface
export interface Validator {
    type: string;
    message: string;
    validate: (value: any, data?: Record<string, any>) => boolean | Promise<boolean>;
    // Optional conditional validation
    condition?: (data: Record<string, any>) => boolean;
}

export interface ValidationError {
    field: string;
    message: string;
    rule?: string;
    // Add error code to support internationalization
    code?: string;
}

export type ModelErrorCode =
    | 'reaction_error'
    | 'dependency_error'
    | 'circular_dependency'
    | 'field_not_found';

export interface ModelError {
    code: ModelErrorCode;
    field?: string;
    message: string;
    originalError?: Error;
}

export interface ModelEventMap<T = Record<string, any>> {
    [ModelEvents.VALIDATION_ERROR]: ValidationError;
    [ModelEvents.REACTION_ERROR]: ModelError;
    [ModelEvents.DEPENDENCY_ERROR]: ModelError;
    [ModelEvents.FIELD_NOT_FOUND]: ModelError;
    [ModelEvents.FIELD_CHANGE]: {
        field: keyof T & string;
        value: T[keyof T];
    };
    [ModelEvents.VALIDATION_COMPLETE]: { isValid: boolean };
    [ModelEvents.FIELD_VALIDATION_COMPLETE]: {
        field: keyof T & string;
        isValid: boolean;
        dirty: boolean;
    };
    [ModelEvents.DIRTY_DATA_CLEARED]: { fields: Array<keyof T & string> };
}

export interface Reaction {
    fields: string[];
    computed: (values: Record<string, any>) => any;
    action?: (data: Record<string, any>) => void | PromiseLike<void>;
}

// Enhanced field schema interface
export interface FieldSchema {
    // Field type - added date and enum types
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'enum';
    // Validation rules
    validator?: Validator[];
    // Default value
    default?: unknown;
    // Optional literal set for enum fields; enables useful schema inference.
    values?: readonly unknown[];
    /**
     * Reaction definition. When an array is used, matching reactions are
     * scheduled in declaration order for each changed dependency field.
     */
    reaction?: Reaction | Reaction[];
    // Value transformation function
    transform?: (value: any) => any;
}

export type Model<T = Record<string, any>> = {
    [K in keyof T]-?: FieldSchema;
};

/**
 * Map a `FieldSchema['type']` literal to its TypeScript value type.
 * Used by `InferModelData` to derive the data shape from a schema.
 */
type InferArrayItem<S extends FieldSchema> = S extends {
    default: readonly (infer Item)[];
}
    ? [Item] extends [never]
        ? unknown
        : Item
    : unknown;

type InferObjectShape<S extends FieldSchema> = S extends {
    default: infer Value extends Record<string, unknown>;
}
    ? keyof Value extends never
        ? Record<string, unknown>
        : Value
    : Record<string, unknown>;

export type InferFieldType<S extends FieldSchema> =
    S['type'] extends 'string' ? string :
    S['type'] extends 'number' ? number :
    S['type'] extends 'boolean' ? boolean :
    S['type'] extends 'date' ? Date :
    S['type'] extends 'array' ? InferArrayItem<S>[] :
    S['type'] extends 'object' ? InferObjectShape<S> :
    S['type'] extends 'enum' ?
        S extends { values: readonly (infer Value)[] }
            ? Value
            : unknown :
    unknown;

/**
 * Derive the model data shape from a schema literal. Fields without a default
 * include `undefined`; array/object defaults and enum `values` retain useful
 * literal-derived value types.
 */
export type InferModelData<S extends Record<string, FieldSchema>> = {
    [K in keyof S]: InferFieldType<S[K]> |
        (S[K] extends { default: infer Default } ? Default : undefined);
};

export interface ModelOptions {
    // Async validation timeout in milliseconds
    asyncValidationTimeout?: number;
    // Debounce time for reaction triggers in milliseconds
    debounceReactions?: number;
    // Strict mode (unknown fields will throw errors)
    strictMode?: boolean;
    // Validation strategy: if true, stop validating a field after the first error
    failFast?: boolean;
}

export interface ModelReturn<T = Record<string, any>> {
    /** Stable shallow read-only snapshot of the field map. */
    data: Readonly<T>;
    /** Read-only snapshot of current validation errors. */
    validationErrors: Readonly<Record<string, readonly ValidationError[]>>;
    setField: <K extends keyof T>(field: K, value: T[K]) => Promise<boolean>;
    getField: <K extends keyof T>(field: K) => T[K];
    setFields: (fields: Partial<T>) => Promise<boolean>;
    validateAll: () => Promise<boolean>;
    on: <E extends keyof ModelEventMap<T>>(
        event: E,
        callback: (payload: ModelEventMap<T>[E]) => void
    ) => () => void;
    /** Return a stable shallow read-only snapshot of rejected input values. */
    getDirtyData: () => Readonly<Partial<T>>;
    clearDirtyData: () => void;
    // Wait for all pending reactions and validations to complete
    settled: () => Promise<void>;
    dispose: () => void;
    /** Subscribe to a single field; returns an unsubscribe function. */
    subscribeField: <K extends keyof T>(
        field: K,
        callback: (value: T[K]) => void
    ) => () => void;
    /**
     * Subscribe to a derived value via a selector. The callback fires only
     * when the selected value changes (compared with `isEqual`, default Object.is).
     */
    subscribe: <R>(
        selector: (data: Readonly<T>) => R,
        callback: (value: R, prev: R) => void,
        isEqual?: (a: R, b: R) => boolean
    ) => () => void;
}

/**
 * Internal options threaded through the validate → commit pipeline.
 * Not re-exported from the package entry point (`index.ts`); it is an
 * implementation detail shared inside the library only.
 *
 * `changedFields`, when provided, collects the names of fields whose committed
 * value actually changed. Batched callers (`setFields` / `validateAll`) suppress
 * per-field reactions and use this set to fire a single reaction pass for only
 * the fields that really moved.
 */
export interface CommitOptions {
    reactionStack?: string[];
    suppressReactions?: boolean;
    changedFields?: Set<string>;
    validationData?: Record<string, any>;
}
