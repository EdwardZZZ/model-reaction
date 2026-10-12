import {
    CommitOptions,
    FieldSchema,
    Model,
    ModelError,
    ModelEventMap,
    ModelEvents,
    ModelOptions,
    ModelReturn,
    ValidationError,
} from '../types';
import { validateField } from '../validation/validate-field';
import { cloneDefault } from '../utils/clone-default';
import { deepEqual } from '../utils/deep-equal';
import { EventEmitter } from './event-emitter';
import { PendingTasks } from './pending-tasks';
import { ReactionSystem } from '../reaction/reaction-system';

/**
 * Core class behind `createModel(...)`.
 *
 * Owns:
 *   - the data store (`data`) and dirty buffer (`dirtyData`)
 *   - per-field async validation request IDs (race guard)
 *   - in-flight validation counter (drives `settled()`)
 *   - lifecycle (`dispose`, `disposed` guard)
 */
export class ModelManager<
    T extends Record<string, any> = Record<string, any>,
> implements ModelReturn<T> {
    private modelData: T = {} as T;
    private errors: Record<string, readonly ValidationError[]> = {};
    /** Last value provided for a field whose validation failed. */
    private dirtyData: Partial<T> = {};
    private dataSnapshot: Readonly<T> | null = null;
    private errorsSnapshot:
        | Readonly<Record<string, readonly ValidationError[]>>
        | null = null;
    private dirtyDataSnapshot: Readonly<Partial<T>> | null = null;

    private readonly schema: Model<T>;
    private readonly options: ModelOptions;
    private readonly eventEmitter = new EventEmitter<ModelEventMap<T>>();
    private readonly pendingTasks = new PendingTasks();
    private readonly reactionSystem: ReactionSystem;

    private readonly asyncValidationTimeout: number;
    private validationRequestIds: Record<string, number> = {};
    private requestIdCounter = 0;

    private disposed = false;

    constructor(schema: Model<T>, options: ModelOptions = {}) {
        this.schema = schema;
        this.options = options;
        this.asyncValidationTimeout = options.asyncValidationTimeout ?? 5000;

        this.reactionSystem = new ReactionSystem(
            this.schema,
            this.options,
            {
                getValue: (field) => this.getField(field as keyof T),
                setValue: (field, value, opts) =>
                    this.updateField(field, value, opts),
                setError: (field, error) => this.recordError(field, error),
                reportError: (event, error) =>
                    this.emit(event, error),
            },
            this.pendingTasks
        );

        this.initializeDefaults();
    }

    // -------------------------------------------------------------------------
    // Lifecycle helpers
    // -------------------------------------------------------------------------

    /**
     * Seed `data` from each field's `default`, then run one initial reaction
     * pass so derived fields start with a correct value.
     *
     * Only non-derived defaults are reaction inputs. Treating a derived
     * field's placeholder default as a change can run downstream work with a
     * stale value and create a false cycle when the real value commits.
     * Defaults bypass validation, but computed values use the normal validated
     * commit path and the initial pass is tracked by `settled()`.
     */
    private initializeDefaults(): void {
        const seededInputs: string[] = [];
        Object.entries(this.schema).forEach(([field, schema]) => {
            if (schema.default !== undefined) {
                (this.modelData as any)[field] = cloneDefault(schema.default);
                if (schema.reaction === undefined) {
                    seededInputs.push(field);
                }
            }
        });

        if (seededInputs.length > 0) {
            this.reactionSystem.triggerReactionsForFields(seededInputs);
        }
    }

    private ensureNotDisposed(): void {
        if (this.disposed) {
            throw new Error(
                'ModelManager has been disposed and cannot be used'
            );
        }
    }

    // -------------------------------------------------------------------------
    // Event facade
    // -------------------------------------------------------------------------

    on = <E extends keyof ModelEventMap<T>>(
        event: E,
        callback: (data: ModelEventMap<T>[E]) => void
    ): (() => void) => {
        this.eventEmitter.on(event, callback);
        return () => this.eventEmitter.off(event, callback);
    };

    /**
     * Surface an event through the typed bus. Failed validation and reaction
     * errors are normal, recoverable outcomes, so the library does not log them
     * itself — subscribe via `model.on(...)` to observe or log.
     */
    private emit<E extends keyof ModelEventMap<T>>(
        event: E,
        data: ModelEventMap<T>[E]
    ): void {
        this.eventEmitter.emit(event, data);
    }

    // -------------------------------------------------------------------------
    // Public mutation API
    // -------------------------------------------------------------------------

    setField = async <K extends keyof T>(
        field: K,
        value: T[K]
    ): Promise<boolean> => {
        this.ensureNotDisposed();
        return this.updateField(field as string, value);
    };

    setFields = async (fields: Partial<T>): Promise<boolean> => {
        return this.runBatch((options) => {
            const entries = Object.entries(fields);
            const prepared = entries.map(([field, value]) => {
                const schema = this.schema[field];
                return {
                    field,
                    schema,
                    value: schema?.transform ? schema.transform(value) : value,
                };
            });
            const validationData = {
                ...(this.modelData as Record<string, any>),
            };
            prepared.forEach(({ field, schema, value }) => {
                if (schema) validationData[field] = value;
            });
            const commitOptions: CommitOptions = {
                ...options,
                validationData,
            };
            return Promise.allSettled(
                prepared.map(({ field, schema, value }) =>
                    schema
                        ? this.validateAndCommit(field, schema, value, commitOptions)
                        : this.updateField(field, value, commitOptions)
                )
            );
        }, (results) => {
            const rejection = results.find(
                (result): result is PromiseRejectedResult =>
                    result.status === 'rejected'
            );
            if (rejection) throw rejection.reason;

            return results.every(
                (result) => result.status === 'fulfilled' && result.value
            );
        });
    };

    validateAll = async (): Promise<boolean> => {
        return this.runBatch((options) => {
            const fields = Object.keys(this.schema);
            const validationData = {
                ...(this.modelData as Record<string, any>),
                ...(this.dirtyData as Record<string, any>),
            };
            const commitOptions: CommitOptions = { ...options, validationData };
            return Promise.all(
                fields.map((field) => this.validateAndCommit(
                    field,
                    this.schema[field] as FieldSchema,
                    field in this.dirtyData
                        ? this.dirtyData[field as keyof T]
                        : this.modelData[field as keyof T],
                    commitOptions
                ))
            );
        }, (results) => {
            const allValid = results.every(Boolean);
            this.emit(ModelEvents.VALIDATION_COMPLETE, { isValid: allValid });
            return allValid;
        });
    };

    /**
     * Hold a batch through validation, reaction registration, and completion.
     * Callers choose their promise aggregation and result handling; only actual
     * committed changes enter the shared reaction pass.
     */
    private async runBatch<R>(
        validate: (options: CommitOptions) => Promise<R>,
        complete: (results: R) => boolean
    ): Promise<boolean> {
        this.ensureNotDisposed();
        const endBatch = this.pendingTasks.begin();
        const changedFields = new Set<string>();
        try {
            const results = await validate({ changedFields });
            this.reactionSystem.triggerReactionsForFields([...changedFields]);
            return complete(results);
        } finally {
            endBatch();
        }
    }

    // -------------------------------------------------------------------------
    // Selector subscriptions
    // -------------------------------------------------------------------------

    /**
     * Subscribe to a derived value. Callback fires only when `selector(data)`
     * changes (compared via `isEqual`, default `Object.is`).
     */
    subscribe = <R>(
        selector: (data: Readonly<T>) => R,
        callback: (value: R, prev: R) => void,
        isEqual: (a: R, b: R) => boolean = Object.is
    ): (() => void) => {
        let prev = selector(this.data);
        return this.on(ModelEvents.FIELD_CHANGE, () => {
            const next = selector(this.data);
            if (!isEqual(next, prev)) {
                const old = prev;
                prev = next;
                callback(next, old);
            }
        });
    };

    // -------------------------------------------------------------------------
    // Public read API
    // -------------------------------------------------------------------------

    get data(): Readonly<T> {
        if (this.dataSnapshot === null) {
            this.dataSnapshot = Object.freeze({ ...this.modelData });
        }
        return this.dataSnapshot;
    }

    get validationErrors(): Readonly<Record<string, readonly ValidationError[]>> {
        if (this.errorsSnapshot === null) {
            this.errorsSnapshot = Object.freeze({ ...this.errors });
        }
        return this.errorsSnapshot;
    }

    getField = <K extends keyof T>(field: K): T[K] => {
        return this.modelData[field];
    };

    getDirtyData = (): Readonly<Partial<T>> => {
        if (this.dirtyDataSnapshot === null) {
            this.dirtyDataSnapshot = Object.freeze({ ...this.dirtyData });
        }
        return this.dirtyDataSnapshot;
    };

    clearDirtyData = (): void => {
        const fields = Object.keys(this.dirtyData) as Array<keyof T & string>;
        this.dirtyData = {};
        this.dirtyDataSnapshot = null;
        if (fields.length > 0) {
            this.emit(ModelEvents.DIRTY_DATA_CLEARED, { fields });
        }
    };

    // -------------------------------------------------------------------------
    // Settled / dispose
    // -------------------------------------------------------------------------

    settled = (): Promise<void> => {
        return this.pendingTasks.settled();
    };

    dispose = (): void => {
        if (this.disposed) return;
        this.disposed = true;

        this.reactionSystem.dispose();
        this.eventEmitter.clear();
        this.pendingTasks.dispose();

        this.modelData = {} as T;
        this.dirtyData = {};
        this.errors = {};
        this.validationRequestIds = {};
        this.dataSnapshot = null;
        this.errorsSnapshot = null;
        this.dirtyDataSnapshot = null;
    };

    // -------------------------------------------------------------------------
    // Internal: validate + commit
    // -------------------------------------------------------------------------

    /**
     * Validate `value` for `field`, then commit (or stash to dirtyData).
     * Used by setField, setFields, and the reaction system.
     */
    private async updateField(
        field: string,
        value: any,
        options: CommitOptions = {}
    ): Promise<boolean> {
        if (this.disposed) return false;
        const schema = this.schema[field];
        if (!schema) {
            const error: ModelError = {
                code: 'field_not_found',
                field,
                message: `Field ${field} does not exist in the model schema`,
            };
            this.emit(ModelEvents.FIELD_NOT_FOUND, error);
            if (this.options.strictMode) throw new Error(error.message);
            return false;
        }

        const transformed = schema.transform ? schema.transform(value) : value;

        return this.validateAndCommit(field, schema, transformed, options);
    }

    private async validateAndCommit(
        field: string,
        schema: FieldSchema,
        value: unknown,
        options: CommitOptions
    ): Promise<boolean> {
        if (this.disposed) return false;
        const endTask = this.pendingTasks.begin();
        try {
            const requestId = ++this.requestIdCounter;
            const isCurrent = () =>
                !this.disposed && this.validationRequestIds[field] === requestId;
            this.validationRequestIds[field] = requestId;
            this.errors[field] = Object.freeze([]);
            this.errorsSnapshot = null;

            const isValid = await validateField({
                schema,
                value,
                field,
                timeout: this.asyncValidationTimeout,
                failFast: this.options.failFast ?? false,
                data: {
                    ...(options.validationData ?? this.modelData),
                },
                isCurrent,
                onError: (error) => {
                    if (!isCurrent()) return;
                    this.recordError(field, error);
                    this.emit(ModelEvents.VALIDATION_ERROR, { ...error });
                },
            });

            if (!isCurrent()) return false;

            if (isValid) {
                this.commitValid(field, value, options);
            } else {
                this.dirtyData[field as keyof T] = value as T[keyof T];
                this.dirtyDataSnapshot = null;
            }
            this.emit(ModelEvents.FIELD_VALIDATION_COMPLETE, {
                field: field as keyof T & string,
                isValid,
                dirty: field in this.dirtyData,
            });
            return isValid;
        } finally {
            endTask();
        }
    }

    /** Store an error before its owner emits the corresponding typed event. */
    private recordError(field: string, error: ValidationError): void {
        if (this.disposed) return;
        this.errors[field] = Object.freeze([
            ...(this.errors[field] ?? []),
            Object.freeze({ ...error }),
        ]);
        this.errorsSnapshot = null;
    }

    /**
     * Commit a validated value:
     *   - if the value differs from `data`, write it, drop any dirty entry,
     *     emit `field:change`, and fire reactions.
     *   - if the value equals `data` but a stale `dirtyData[field]` lingers
     *     (e.g. user re-typed the original valid value to undo a bad input),
     *     drop the dirty entry silently — `data` did not change, so neither
     *     subscribers nor reactions should be disturbed.
     *   - otherwise, no-op.
     */
    private commitValid(
        field: string,
        value: any,
        options: CommitOptions
    ): void {
        const { reactionStack = [], changedFields } = options;
        const fieldKey = field as keyof T;
        const dataChanged = !deepEqual(this.modelData[fieldKey], value);
        const hadDirty = field in this.dirtyData;

        if (!dataChanged && !hadDirty) return;

        if (dataChanged) {
            this.modelData[fieldKey] = value;
            this.dataSnapshot = null;
        }
        if (hadDirty) {
            delete this.dirtyData[field];
            this.dirtyDataSnapshot = null;
        }

        if (dataChanged) {
            // Record the real change so a batched caller can trigger reactions
            // for exactly the fields that moved.
            changedFields?.add(field);
            this.emit(ModelEvents.FIELD_CHANGE, {
                field,
                value,
            });
            if (!changedFields) {
                this.reactionSystem.triggerReactionsForFields([field], reactionStack);
            }
        }
    }
}
