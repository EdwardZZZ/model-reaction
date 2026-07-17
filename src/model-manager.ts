import {
    FieldSchema,
    Model,
    ModelError,
    ModelErrorEvent,
    ModelEventMap,
    ModelEvents,
    ModelOptions,
    ModelReturn,
    ValidationError,
} from './types';
import { validateField } from './validate-field';
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
    dirtyData: Partial<T> = {};

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
                    this.reportError(event, error),
            },
            this.pendingTasks
        );

        this.initializeDefaults();
        this.bindPublicMethods();
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

    private bindPublicMethods(): void {
        this.setField = this.setField.bind(this);
        this.getField = this.getField.bind(this);
        this.setFields = this.setFields.bind(this);
        this.validateAll = this.validateAll.bind(this);
        this.on = this.on.bind(this);
        this.getDirtyData = this.getDirtyData.bind(this);
        this.clearDirtyData = this.clearDirtyData.bind(this);
        this.settled = this.settled.bind(this);
        this.dispose = this.dispose.bind(this);
        this.subscribeField = this.subscribeField.bind(this);
        this.subscribe = this.subscribe.bind(this);
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

    on<E extends keyof ModelEventMap<T>>(
        event: E,
        callback: (data: ModelEventMap<T>[E]) => void
    ): () => void {
        this.eventEmitter.on(event, callback);
        return () => this.eventEmitter.off(event, callback);
    }

    private emit<E extends keyof ModelEventMap<T>>(
        event: E,
        data: ModelEventMap<T>[E]
    ): void {
        this.eventEmitter.emit(event, data);
    }

    private reportError(
        event: ModelErrorEvent,
        error: ModelError
    ): void {
        /* eslint-disable no-console */
        console.error(
            `[${error.code}] ${error.field ? `field ${error.field}: ` : ''}${error.message}`
        );
        this.emit(event, error);
    }

    private reportValidationError(error: ValidationError): void {
        /* eslint-disable no-console */
        console.error(
            `[validation] field ${error.field}: ${error.message}`
        );
        this.emit(ModelEvents.VALIDATION_ERROR, error);
    }

    // -------------------------------------------------------------------------
    // Public mutation API
    // -------------------------------------------------------------------------

    async setField<K extends keyof T>(field: K, value: T[K]): Promise<boolean> {
        this.ensureNotDisposed();
        return this.updateField(field as string, value);
    }

    async setFields(fields: Partial<T>): Promise<boolean> {
        this.ensureNotDisposed();
        const entries = Object.entries(fields);
        const results = await Promise.all(
            entries.map(([field, value]) =>
                this.updateField(field, value, { suppressReactions: true })
            )
        );
        // Single batched reaction trigger after all fields settle.
        this.reactionSystem.triggerReactionsForFields(entries.map(([f]) => f));
        return results.every(Boolean);
    }

    async validateAll(): Promise<boolean> {
        this.ensureNotDisposed();
        const fields = Object.keys(this.schema);
        const results = await Promise.all(
            fields.map((field) =>
                this.revalidateField(field, { suppressReactions: true })
            )
        );
        const allValid = results.every(Boolean);

        // Single batched reaction trigger for any fields that committed.
        this.reactionSystem.triggerReactionsForFields(fields);

        this.emit(ModelEvents.VALIDATION_COMPLETE, { isValid: allValid });
        return allValid;
    }

    // -------------------------------------------------------------------------
    // Selector / field subscriptions (UI binding layer)
    // -------------------------------------------------------------------------

    /**
     * Subscribe to a single field. Callback fires only when that field's
     * committed value changes. Returns an unsubscribe function.
     */
    subscribeField<K extends keyof T>(
        field: K,
        callback: (value: T[K]) => void
    ): () => void {
        const handler = (e: { field: string; value: any }): void => {
            if (e.field === field) callback(e.value as T[K]);
        };
        this.eventEmitter.on(ModelEvents.FIELD_CHANGE, handler);
        return () => this.eventEmitter.off(ModelEvents.FIELD_CHANGE, handler);
    }

    /**
     * Subscribe to a derived value. Callback fires only when `selector(data)`
     * changes (compared via `isEqual`, default `Object.is`).
     */
    subscribe<R>(
        selector: (data: T) => R,
        callback: (value: R, prev: R) => void,
        isEqual: (a: R, b: R) => boolean = Object.is
    ): () => void {
        let prev = selector(this.modelData);
        const handler = (): void => {
            const next = selector(this.modelData);
            if (!isEqual(next, prev)) {
                const old = prev;
                prev = next;
                callback(next, old);
            }
        };
        this.eventEmitter.on(ModelEvents.FIELD_CHANGE, handler);
        return () => this.eventEmitter.off(ModelEvents.FIELD_CHANGE, handler);
    }

    // -------------------------------------------------------------------------
    // Public read API
    // -------------------------------------------------------------------------

    get data(): T {
        return { ...this.modelData };
    }

    get validationErrors(): Record<string, ValidationError[]> {
        return { ...this.errors };
    }

    getField<K extends keyof T>(field: K): T[K] {
        return this.modelData[field];
    }

    getDirtyData(): Partial<T> {
        return { ...this.dirtyData };
    }

    clearDirtyData(): void {
        this.dirtyData = {};
    }

    // -------------------------------------------------------------------------
    // Settled / dispose
    // -------------------------------------------------------------------------

    settled(): Promise<void> {
        return this.pendingTasks.settled();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.reactionSystem.dispose();
        this.eventEmitter.clear();
        this.pendingTasks.dispose();

        this.modelData = {} as T;
        this.dirtyData = {};
        this.errors = {};
        this.validationRequestIds = {};
    }

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
        options: { reactionStack?: string[]; suppressReactions?: boolean } = {}
    ): Promise<boolean> {
        const schema = this.schema[field];
        if (!schema) {
            const error: ModelError = {
                code: 'field_not_found',
                field,
                message: `Field ${field} does not exist in the model schema`,
            };
            this.reportError(ModelEvents.FIELD_NOT_FOUND, error);
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
        opts: { suppressReactions?: boolean } = {}
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
        options: { reactionStack?: string[]; suppressReactions?: boolean }
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
                this.commitValid(
                    field,
                    value,
                    options.reactionStack,
                    options.suppressReactions
                );
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
            onError: (error) => this.reportValidationError(error),
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
        reactionStack: string[] = [],
        suppressReactions = false
    ): void {
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
            this.emit(ModelEvents.FIELD_CHANGE, { field, value });
            if (!suppressReactions) {
                this.reactionSystem.triggerReactions(field, reactionStack);
            }
        }
    }
}

/**
 * Clone a schema `default` so mutable defaults (arrays / plain objects) are
 * not shared across model instances created from the same schema literal.
 *
 * Primitives are returned as-is. `Date` / `RegExp` and other non-plain objects
 * are returned by reference intentionally — they are treated as immutable
 * leaves here, matching how `deepEqual` compares them. Cyclic structures are
 * guarded via a `WeakMap`.
 */
function cloneDefault<V>(value: V, seen: WeakMap<object, any> = new WeakMap()): V {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date || value instanceof RegExp) return value;

    const existing = seen.get(value as object);
    if (existing) return existing;

    if (Array.isArray(value)) {
        const copy: unknown[] = [];
        seen.set(value as object, copy);
        for (const item of value) copy.push(cloneDefault(item, seen));
        return copy as unknown as V;
    }

    // Only clone plain objects; leave class instances untouched by reference.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;

    const copy: Record<string, unknown> = {};
    seen.set(value as object, copy);
    for (const key of Object.keys(value as Record<string, unknown>)) {
        copy[key] = cloneDefault(
            (value as Record<string, unknown>)[key],
            seen
        );
    }
    return copy as unknown as V;
}
