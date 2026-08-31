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
} from './types';
import { validateField } from './validate-field';
import { cloneDefault } from './clone-default';
import { deepEqual } from './deep-equal';
import { EventEmitter } from './event-emitter';
import { PendingTasks } from './pending-tasks';
import { ReactionSystem } from './reaction-system';

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
    private errors: Record<string, ValidationError[]> = {};
    /** Last value provided for a field whose validation failed. */
    private dirtyData: Partial<T> = {};

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
                setError: (field, error) => {
                    if (!this.errors[field]) {
                        this.errors[field] = [];
                    }
                    this.errors[field].push(error);
                },
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

    private initializeDefaults(): void {
        Object.entries(this.schema).forEach(([field, schema]) => {
            if (schema.default !== undefined) {
                (this.modelData as any)[field] = cloneDefault(schema.default);
            }
        });
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
        this.ensureNotDisposed();
        const entries = Object.entries(fields);
        // Collect only fields whose committed value actually changed, so the
        // batched reaction pass mirrors the single-field path (which fires a
        // reaction only on a real change) instead of firing for every input.
        const changedFields = new Set<string>();
        const results = await Promise.all(
            entries.map(([field, value]) =>
                this.updateField(field, value, {
                    suppressReactions: true,
                    changedFields,
                })
            )
        );
        // Single batched reaction trigger after all fields settle.
        this.reactionSystem.triggerReactionsForFields([...changedFields]);
        return results.every(Boolean);
    };

    validateAll = async (): Promise<boolean> => {
        this.ensureNotDisposed();
        const fields = Object.keys(this.schema);
        const changedFields = new Set<string>();
        const results = await Promise.all(
            fields.map((field) =>
                this.revalidateField(field, {
                    suppressReactions: true,
                    changedFields,
                })
            )
        );
        const allValid = results.every(Boolean);

        // Single batched reaction trigger for fields that actually committed.
        this.reactionSystem.triggerReactionsForFields([...changedFields]);

        this.emit(ModelEvents.VALIDATION_COMPLETE, { isValid: allValid });
        return allValid;
    };

    // -------------------------------------------------------------------------
    // Selector / field subscriptions (UI binding layer)
    // -------------------------------------------------------------------------

    /**
     * Subscribe to a single field. Callback fires only when that field's
     * committed value changes. Returns an unsubscribe function.
     */
    subscribeField = <K extends keyof T>(
        field: K,
        callback: (value: T[K]) => void
    ): (() => void) => {
        return this.on(ModelEvents.FIELD_CHANGE, (e) => {
            if (e.field === field) callback(e.value as T[K]);
        });
    };

    /**
     * Subscribe to a derived value. Callback fires only when `selector(data)`
     * changes (compared via `isEqual`, default `Object.is`).
     */
    subscribe = <R>(
        selector: (data: T) => R,
        callback: (value: R, prev: R) => void,
        isEqual: (a: R, b: R) => boolean = Object.is
    ): (() => void) => {
        let prev = selector(this.modelData);
        return this.on(ModelEvents.FIELD_CHANGE, () => {
            const next = selector(this.modelData);
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

    get data(): T {
        return { ...this.modelData };
    }

    get validationErrors(): Record<string, ValidationError[]> {
        return { ...this.errors };
    }

    getField = <K extends keyof T>(field: K): T[K] => {
        return this.modelData[field];
    };

    getDirtyData = (): Partial<T> => {
        return { ...this.dirtyData };
    };

    clearDirtyData = (): void => {
        this.dirtyData = {};
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

        const transformed = schema.transform
            ? schema.transform(value)
            : value;

        return this.validateAndCommit(field, schema, transformed, options);
    }

    /**
     * Re-validate the *current* committed (or last-attempted) value of a field.
     * Used by `validateAll`.
     */
    private async revalidateField(
        field: string,
        opts: CommitOptions = {}
    ): Promise<boolean> {
        const fieldKey = field as keyof T;
        const value =
            field in this.dirtyData
                ? this.dirtyData[fieldKey]
                : this.modelData[fieldKey];

        return this.validateAndCommit(
            field,
            this.schema[field] as FieldSchema,
            value,
            opts
        );
    }

    private async validateAndCommit(
        field: string,
        schema: FieldSchema,
        value: unknown,
        options: CommitOptions
    ): Promise<boolean> {
        const endTask = this.pendingTasks.begin();
        try {
            const requestId = ++this.requestIdCounter;
            this.validationRequestIds[field] = requestId;
            this.errors[field] = [];

            const isValid = await this.runValidators(
                schema,
                value,
                field,
                requestId
            );

            if (this.validationRequestIds[field] !== requestId) return false;

            if (isValid) {
                this.commitValid(field, value, options);
            } else {
                this.dirtyData[field as keyof T] = value as T[keyof T];
            }
            return isValid;
        } finally {
            endTask();
        }
    }

    private runValidators(
        schema: FieldSchema,
        value: unknown,
        field: string,
        requestId: number
    ): Promise<boolean> {
        return validateField({
            schema,
            value,
            errors: this.errors,
            field,
            timeout: this.asyncValidationTimeout,
            failFast: this.options.failFast ?? false,
            data: this.modelData as Record<string, any>,
            isCurrent: () => this.validationRequestIds[field] === requestId,
            onError: (error) => this.emit(ModelEvents.VALIDATION_ERROR, error),
        });
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
        options: CommitOptions = {}
    ): void {
        const { reactionStack = [], suppressReactions = false, changedFields } =
            options;
        const fieldKey = field as keyof T;
        const dataChanged = !deepEqual(this.modelData[fieldKey], value);
        const hadDirty = field in this.dirtyData;

        if (!dataChanged && !hadDirty) return;

        if (dataChanged) {
            this.modelData[fieldKey] = value;
        }
        if (hadDirty) {
            delete this.dirtyData[field];
        }

        if (dataChanged) {
            // Record the real change so a batched caller can trigger reactions
            // for exactly the fields that moved.
            changedFields?.add(field);
            this.emit(ModelEvents.FIELD_CHANGE, { field, value });
            if (!suppressReactions) {
                this.reactionSystem.triggerReactions(field, reactionStack);
            }
        }
    }
}

