/**
 * Public type surface for model-reaction-lite.
 *
 * Synchronous, minimal subset of model-reaction. Only two events are emitted
 * by the core: `field:change` (on commit) and `error` (on validation /
 * reaction failure). No async paths, no dirtyData, no per-error type taxonomy.
 */

export const FIELD_CHANGE = 'field:change';
export const ERROR = 'error';

export type ErrorKind = 'validation' | 'reaction';

export interface ModelError {
    kind: ErrorKind;
    field: string;
    message: string;
    rule?: string;
    cause?: Error;
}

export interface Validator {
    type: string;
    message: string;
    /** Synchronous only — Promise return values are forbidden. */
    validate: (value: any, data?: Record<string, any>) => boolean;
}

export interface ValidationError {
    field: string;
    message: string;
    rule?: string;
}

export interface Reaction {
    fields: string[];
    /** Pure synchronous computation. Side effects belong in `action`. */
    computed: (values: Record<string, any>) => any;
    action?: (data: Record<string, any>) => void;
}

export interface FieldSchema {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'enum';
    validator?: Validator[];
    default?: any;
    reaction?: Reaction | Reaction[];
}

export type Model<T = Record<string, any>> = {
    [K in keyof T]-?: FieldSchema;
};

export type InferFieldType<S extends FieldSchema> =
    S['type'] extends 'string' ? string :
    S['type'] extends 'number' ? number :
    S['type'] extends 'boolean' ? boolean :
    S['type'] extends 'date' ? Date :
    S['type'] extends 'array' ? any[] :
    S['type'] extends 'object' ? Record<string, any> :
    S['type'] extends 'enum' ? any :
    any;

export type InferModelData<S extends Record<string, FieldSchema>> = {
    [K in keyof S]: InferFieldType<S[K]>;
};

/**
 * No options today. Reserved as a hook for future minimal additions.
 */
export type ModelOptions = Record<string, never>;

export interface ModelReturn<T = Record<string, any>> {
    data: T;
    validationErrors: Record<string, ValidationError[]>;
    /** Synchronous. Returns true if the value passed validation. */
    setField: <K extends keyof T>(field: K, value: T[K]) => boolean;
    getField: <K extends keyof T>(field: K) => T[K];
    setFields: (fields: Partial<T>) => boolean;
    validateAll: () => boolean;
    on: (event: typeof FIELD_CHANGE | typeof ERROR, callback: (payload: any) => void) => void;
    off: (event: typeof FIELD_CHANGE | typeof ERROR, callback?: (payload: any) => void) => void;
    dispose: () => void;
    /**
     * Subscribe to a derived value. Equality uses `Object.is` — return
     * primitives or stable references from the selector.
     */
    subscribe: <R>(
        selector: (data: T) => R,
        callback: (value: R, prev: R) => void
    ) => () => void;
}
