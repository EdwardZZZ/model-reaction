/** Public type contract for the core package entry. */
export const ModelEvents = {
    REACTION_ERROR: 'reaction:error',
    DEPENDENCY_ERROR: 'dependency:error',
    FIELD_NOT_FOUND: 'field:not-found',
    FIELD_CHANGE: 'field:change',
} as const;

/**
 * Return from `reaction.computed` to skip the current reaction without
 * committing its target field, running its `action`, or
 * triggering downstream reactions.
 */
export const SKIP_REACTION = Symbol.for('model-reaction.SKIP_REACTION');

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
    [ModelEvents.REACTION_ERROR]: ModelError;
    [ModelEvents.DEPENDENCY_ERROR]: ModelError;
    [ModelEvents.FIELD_NOT_FOUND]: ModelError;
    [ModelEvents.FIELD_CHANGE]: {
        field: keyof T & string;
        value: T[keyof T];
    };
}

/** Return tracked work; never await this model's settled() inside an action. */
export type ReactionAction = () => void | PromiseLike<void>;

/**
 * @typeParam T Value type `computed` must return. The `any` default leaves a
 * bare `Reaction` unchecked, so it fits any field.
 */
export interface Reaction<T = any> {
    /** Top-level model fields whose values are passed to `computed`. */
    fields: string[];
    /**
     * Synchronously and purely derive the target field's next value from the
     * declared dependencies. Must not return a Promise; keep asynchronous work
     * and other side effects in `action`. Return {@link SKIP_REACTION} to leave
     * the target unchanged and skip `action`.
     */
    computed: (values: Record<string, any>) => T | typeof SKIP_REACTION;
    /** Sequential side effects started after computation settles; see docs/API.md. */
    action?: ReactionAction[];
}

/**
 * Value type `reaction.computed` must return for each `type` tag. Enum
 * members live in `values`, which this per-tag lookup cannot see, so enum
 * results are not checked.
 */
interface ComputedValueMap {
    string: string;
    number: number;
    boolean: boolean;
    object: object;
    array: readonly unknown[];
    date: Date;
    enum: unknown;
}

type FieldType = keyof ComputedValueMap;

interface TypedFieldSchema<K extends FieldType> {
    /** Type metadata used for inference and tooling; not runtime validation. */
    type: K;
    /** Initial value, cloned and seeded directly. */
    default?: unknown;
    /** Literal set used to infer enum values; not a runtime membership check. */
    values?: readonly unknown[];
    /** One computation per field; side effects remain an action array. */
    reaction?: Reaction<ComputedValueMap[K]>;
    /** Synchronously transform direct writes and computed results before commit. */
    transform?: (value: any) => any;
}

/**
 * Field definition, discriminated by `type`: `reaction.computed` must return
 * the matching {@link ComputedValueMap} value or {@link SKIP_REACTION}.
 * `FieldSchema<'number'>` selects a single variant.
 */
export type FieldSchema<K extends FieldType = FieldType> = {
    [P in K]: TypedFieldSchema<P>;
}[K];

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

export interface ModelReturn<T = Record<string, any>> {
    /** Stable shallow read-only snapshot of the field map. */
    data: Readonly<T>;
    /** Synchronously transform, commit, and trigger computations. Throws on write errors. */
    setField: <K extends keyof T>(field: K, value: T[K]) => void;
    getField: <K extends keyof T>(field: K) => T[K];
    /** Prepare all inputs, commit them, then trigger one computation pass. */
    setFields: (fields: Partial<T>) => void;
    on: <E extends keyof ModelEventMap<T>>(
        event: E,
        callback: (payload: ModelEventMap<T>[E]) => void
    ) => () => void;
    /** Wait for tracked computations and action groups to complete. */
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
