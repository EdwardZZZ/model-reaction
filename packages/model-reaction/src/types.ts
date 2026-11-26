// Schema

/** Pure validation rule; never await this model's global waiting methods. */
export interface Validator {
    type: string;
    message: string;
    validate: (value: any, data?: Record<string, any>) => boolean | Promise<boolean>;
    /** Skip this validator when the predicate returns false. */
    condition?: (data: Record<string, any>) => boolean;
}

/**
 * Return from `reaction.computed` to skip the current reaction without
 * validating or committing its target field, running its `action`, or
 * triggering downstream reactions.
 */
export const SKIP_REACTION = Symbol.for('model-reaction.SKIP_REACTION');

/** Return tracked work; never await this model's settled/validateAll. See docs/API.md. */
export type ReactionAction<T = any> = (context: {
    field: string;
    value: T;
}) => void | PromiseLike<void>;

/**
 * @typeParam T Computed result type.
 * @typeParam V Latest committed action value; defaults to T for standalone reactions.
 */
export interface Reaction<T = any, V = T> {
    /** Top-level model fields whose values are passed to `computed`. */
    fields: string[];
    /**
     * Synchronously and purely derive the target field's next value from the
     * declared dependencies. Must not return a Promise; keep asynchronous work
     * and other side effects in `action`. Return {@link SKIP_REACTION} to leave
     * the target unchanged and skip `action`.
     */
    computed: (values: Record<string, any>) => T | typeof SKIP_REACTION;
    /** Side effects deduplicated by reference and called after computation settles; see docs/API.md. */
    action?: ReactionAction<V>[];
}

/**
 * Field definition, discriminated by `type`: `reaction.computed` must return
 * the matching {@link FieldValueMap} value or {@link SKIP_REACTION}.
 * `FieldSchema<'number'>` selects a single variant. Action values default to
 * unknown because tags alone do not constrain defaults or direct writes.
 */
export type FieldSchema<K extends FieldType = FieldType, V = unknown> = {
    [P in K]: TypedFieldSchema<P, V>;
}[K];

/** Explicit T is the caller's value contract and supplies each action's value type. */
export type Model<T = Record<string, any>> = {
    [K in keyof T]-?: FieldSchema<FieldType, T[K]>;
} & Record<symbol, never>;

// Value inference

/** Tag-derived values plus all declared computed results, excluding skipped writes. */
export type InferFieldType<S extends AnyFieldSchema> = S extends AnyFieldSchema
    ? InferTaggedValue<S> |
        ('reaction' extends keyof S ? InferComputedValue<S['reaction']> : never)
    : never;

/**
 * Derive the model data shape from a schema literal. Fields without a default
 * include `undefined`; widened optional defaults retain their declared type.
 * Array/object defaults, computed results and enum values retain their shapes.
 */
export type InferModelData<S extends Record<string, AnyFieldSchema>> = {
    [K in keyof S]: InferFieldType<S[K]> | Exclude<InferDefault<S[K]>, InferFieldType<S[K]>>;
};

// Errors and events

export interface ValidationError {
    field: string;
    message: string;
    rule?: string;
    /** Application-defined localization or classification key. */
    code?: string;
}

export type ValidationErrors = Readonly<Record<string, readonly ValidationError[]>>;

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

export interface ModelEventMap<T = Record<string, any>> {
    [ModelEvents.VALIDATION_ERROR]: ValidationError;
    [ModelEvents.REACTION_ERROR]: ModelError;
    [ModelEvents.DEPENDENCY_ERROR]: ModelError;
    [ModelEvents.FIELD_NOT_FOUND]: ModelError;
    [ModelEvents.FIELD_CHANGE]: {
        [K in ModelFieldKey<T>]-?: { field: `${K}`; value: T[K] };
    }[ModelFieldKey<T>];
    /** Final validation result after tracked work settles; see docs/API.md. */
    [ModelEvents.VALIDATION_COMPLETE]: { isValid: boolean };
    [ModelEvents.FIELD_VALIDATION_COMPLETE]: {
        field: ModelFieldName<T>;
        isValid: boolean;
        dirty: boolean;
    };
    [ModelEvents.DIRTY_DATA_CLEARED]: { fields: ModelFieldName<T>[] };
}

// Model instance API

/** Supported API keys; events use their string representation. */
export type ModelFieldKey<T> = keyof T & (string | number);
export type ModelFieldName<T> = `${ModelFieldKey<T>}`;

export interface ModelOptions {
    /** Async validation timeout in milliseconds. */
    asyncValidationTimeout?: number;
    /** Debounce window for reactions in milliseconds. */
    debounceReactions?: number;
}

export interface ModelReturn<T = Record<string, any>> {
    /** Stable shallow read-only snapshot of the field map. */
    readonly data: Readonly<T>;
    /** Read-only snapshot of current validation errors. */
    readonly validationErrors: ValidationErrors;
    setField: <K extends ModelFieldKey<T>>(field: K, value: T[K]) => Promise<boolean>;
    getField: <K extends ModelFieldKey<T>>(field: K) => T[K];
    setFields: (fields: Partial<T>) => Promise<boolean>;
    /** Validate once, await tracked work, then check dirty values and errors; see docs/API.md. */
    validateAll: () => Promise<boolean>;
    on: <E extends keyof ModelEventMap<T>>(
        event: E,
        callback: (payload: ModelEventMap<T>[E]) => void
    ) => () => void;
    /** Return a stable shallow read-only snapshot of rejected input values. */
    getDirtyData: () => Readonly<Partial<T>>;
    clearDirtyData: () => void;
    /** Wait for pending validations, computations, and returned action Promises to complete. */
    settled: () => Promise<void>;
    dispose: () => void;
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

// Schema type helpers

/**
 * Value type `reaction.computed` must return for each `type` tag. Enum
 * members live in `values`, which this per-tag lookup cannot see, so enum
 * results are not checked.
 */
interface FieldValueMap {
    string: string;
    number: number;
    boolean: boolean;
    object: object;
    array: readonly unknown[];
    date: Date;
    enum: unknown;
}

type FieldType = keyof FieldValueMap;

interface TypedFieldSchema<K extends FieldType, V> {
    /** Type metadata used for inference and tooling; not runtime validation. */
    type: K;
    validator?: Validator[];
    /** Initial value, seeded without validation. */
    default?: unknown;
    /** Literal set used to infer enum values; validators enforce membership. */
    values?: readonly unknown[];
    /** One computation per field; side effects remain an action array. */
    reaction?: Reaction<FieldValueMap[K], V>;
    /** Transform input before validation. */
    transform?: (value: any) => any;
}

type AnyFieldSchema = FieldSchema<FieldType, any>;

/** Empty defaults keep their existing open array/object inference. */
type InferArrayItem<S extends AnyFieldSchema> = S extends {
    default: readonly (infer Item)[];
}
    ? [Item] extends [never]
        ? unknown
        : Item
    : unknown;

type InferObjectShape<S extends AnyFieldSchema> = S extends {
    default: infer Value extends Record<string, unknown>;
}
    ? keyof Value extends never
        ? Record<string, unknown>
        : Value
    : Record<string, unknown>;

type InferTaggedValue<S extends AnyFieldSchema> =
    S['type'] extends 'array' ? InferArrayItem<S>[] :
    S['type'] extends 'object' ? InferObjectShape<S> :
    S['type'] extends 'enum' ?
        S extends { values: readonly (infer Value)[] }
            ? Value
            : unknown :
    FieldValueMap[S['type']];

type InferComputedValue<R> = R extends Reaction
    ? Exclude<ReturnType<R['computed']>, typeof SKIP_REACTION>
    : never;

type InferDefault<S extends AnyFieldSchema> = S extends AnyFieldSchema
    ? 'default' extends keyof S ? S['default'] : undefined
    : never;
