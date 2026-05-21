import {
    ErrorType,
    FieldSchema,
    Model,
    ModelEvents,
    ModelOptions,
    ValidationError,
} from './types';
import { validateField } from './validate-field';
import { deepEqual } from './deep-equal';
import { ErrorHandler } from './error-handler';
import { EventEmitter } from './event-emitter';
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
> {
    data: T = {} as T;
    validationErrors: Record<string, ValidationError[]> = {};
    /** Last value provided for a field whose validation failed. */
    dirtyData: Partial<T> = {};

    private readonly schema: Model;
    private readonly options: ModelOptions;
    private readonly eventEmitter = new EventEmitter();
    private readonly errorHandler: ErrorHandler;
    private readonly ownsErrorHandler: boolean;
    private readonly errorListenerRegistrations: Array<{
        type: ErrorType;
        listener: (e: any) => void;
    }> = [];
    private readonly reactionSystem: ReactionSystem;

    private readonly asyncValidationTimeout: number;
    private validationRequestIds: Record<string, number> = {};
    private requestIdCounter = 0;

    private pendingValidations = 0;
    private validationSettledResolvers: Array<() => void> = [];

    private disposed = false;

    constructor(schema: Model, options: ModelOptions = {}) {
        this.schema = schema;
        this.options = options;
        this.asyncValidationTimeout = options.asyncValidationTimeout ?? 5000;
        this.ownsErrorHandler = !options.errorHandler;
        this.errorHandler = options.errorHandler ?? new ErrorHandler();

        this.setupErrorHandling();

        this.reactionSystem = new ReactionSystem(
            this.schema,
            this.options,
            {
                getValue: (field) => this.getField(field as keyof T),
                setValue: (field, value, opts) =>
                    this.updateField(field, value, opts),
                emit: (event, data) => this.emit(event, data),
                setError: (field, error) => {
                    if (!this.validationErrors[field]) {
                        this.validationErrors[field] = [];
                    }
                    this.validationErrors[field].push(error);
                },
            },
            this.errorHandler
        );

        this.initializeDefaults();
    }

    // -------------------------------------------------------------------------
    // Lifecycle helpers
    // -------------------------------------------------------------------------

    private setupErrorHandling(): void {
        const register = (
            type: ErrorType,
            listener: (error: any) => void
        ): void => {
            this.errorHandler.onError(type, listener);
            this.errorListenerRegistrations.push({ type, listener });
        };

        register(ErrorType.VALIDATION, (e) =>
            this.emit(ModelEvents.VALIDATION_ERROR, e)
        );
        register(ErrorType.REACTION, (e) =>
            this.emit(ModelEvents.REACTION_ERROR, e)
        );
        register(ErrorType.CIRCULAR_DEPENDENCY, (e) =>
            this.emit(ModelEvents.REACTION_ERROR, e)
        );
        register(ErrorType.DEPENDENCY_ERROR, (e) =>
            this.emit(ModelEvents.DEPENDENCY_ERROR, e)
        );
        register(ErrorType.FIELD_NOT_FOUND, (e) =>
            this.emit(ModelEvents.FIELD_NOT_FOUND, e)
        );
    }

    private initializeDefaults(): void {
        Object.entries(this.schema).forEach(([field, schema]) => {
            if (schema.default !== undefined) {
                (this.data as any)[field] = schema.default;
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

    on(event: string, callback: (data: any) => void): void {
        this.eventEmitter.on(event, callback);
    }

    off(event: string, callback?: (data: any) => void): void {
        this.eventEmitter.off(event, callback);
    }

    private emit(event: string, data: any): void {
        this.eventEmitter.emit(event, data);
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
        let prev = selector(this.data);
        const handler = (): void => {
            const next = selector(this.data);
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

    getField<K extends keyof T>(field: K): T[K] {
        return this.data[field];
    }

    getDirtyData(): Partial<T> {
        return { ...this.dirtyData };
    }

    clearDirtyData(): void {
        this.dirtyData = {};
    }

    getValidationSummary(): string {
        const errors = Object.values(this.validationErrors).flat();
        if (errors.length === 0) return 'Validation passed';
        if (this.options.errorFormatter) {
            return errors.map(this.options.errorFormatter).join('; ');
        }
        return errors.map((err) => `${err.field}: ${err.message}`).join('; ');
    }

    // -------------------------------------------------------------------------
    // Settled / dispose
    // -------------------------------------------------------------------------

    /**
     * Resolve once both reactions and validations are quiet at the same time.
     * Reactions can spawn validations and vice versa, so a single pass isn't
     * enough; the loop is bounded defensively.
     */
    async settled(): Promise<void> {
        for (let i = 0; i < 50; i++) {
            await this.reactionSystem.settled();
            if (this.pendingValidations === 0) return;
            await new Promise<void>((resolve) => {
                this.validationSettledResolvers.push(resolve);
            });
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.reactionSystem.dispose();
        this.eventEmitter.clear();

        // Only off the listeners we registered so a shared errorHandler keeps
        // working for other consumers.
        this.errorListenerRegistrations.forEach(({ type, listener }) => {
            this.errorHandler.offError(type, listener);
        });
        this.errorListenerRegistrations.length = 0;

        if (this.ownsErrorHandler) this.errorHandler.dispose();

        // Wake up anyone waiting on settled() so they don't hang forever.
        const waiters = this.validationSettledResolvers.splice(0);
        waiters.forEach((resolve) => resolve());

        this.data = {} as T;
        this.dirtyData = {};
        this.validationErrors = {};
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
        this.pendingValidations++;
        try {
            const schema = this.schema[field];
            if (!schema) {
                const error = this.errorHandler.createFieldNotFoundError(field);
                this.errorHandler.triggerError(error);
                if (this.options.strictMode) throw new Error(error.message);
                return false;
            }

            const requestId = ++this.requestIdCounter;
            this.validationRequestIds[field] = requestId;
            this.validationErrors[field] = [];

            const transformed = schema.transform
                ? schema.transform(value)
                : value;

            const isValid = await this.runValidators(
                schema,
                transformed,
                field,
                requestId
            );

            // Stale: a newer request superseded us.
            if (this.validationRequestIds[field] !== requestId) return false;

            if (isValid) {
                this.commitValid(
                    field,
                    transformed,
                    options.reactionStack,
                    options.suppressReactions
                );
            } else {
                this.dirtyData[field as keyof T] = transformed as T[keyof T];
            }
            return isValid;
        } finally {
            this.pendingValidations--;
            this.notifyValidationsSettledIfIdle();
        }
    }

    /**
     * Re-validate the *current* committed (or last-attempted) value of a field.
     * Used by `validateAll`.
     */
    private async revalidateField(
        field: string,
        opts: { suppressReactions?: boolean } = {}
    ): Promise<boolean> {
        this.pendingValidations++;
        try {
            const schema = this.schema[field] as FieldSchema;
            const fieldKey = field as keyof T;
            const value =
                field in this.dirtyData
                    ? this.dirtyData[fieldKey]
                    : this.data[fieldKey];

            const requestId = ++this.requestIdCounter;
            this.validationRequestIds[field] = requestId;
            this.validationErrors[field] = [];

            const isValid = await this.runValidators(
                schema,
                value,
                field,
                requestId
            );
            if (this.validationRequestIds[field] !== requestId) return false;

            if (!isValid) {
                this.dirtyData[fieldKey] = value as T[keyof T];
            } else if (field in this.dirtyData) {
                delete this.dirtyData[fieldKey];
                if (!deepEqual(this.data[fieldKey], value)) {
                    this.data[fieldKey] = value as T[keyof T];
                    this.emit(ModelEvents.FIELD_CHANGE, { field, value });
                    if (!opts.suppressReactions) {
                        this.reactionSystem.triggerReactions(field);
                    }
                }
            }
            return isValid;
        } finally {
            this.pendingValidations--;
            this.notifyValidationsSettledIfIdle();
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
            errors: this.validationErrors,
            field,
            timeout: this.asyncValidationTimeout,
            errorHandler: this.errorHandler,
            failFast: this.options.failFast ?? false,
            data: this.data as Record<string, any>,
            isCurrent: () => this.validationRequestIds[field] === requestId,
        });
    }

    private commitValid(
        field: string,
        value: any,
        reactionStack: string[] = [],
        suppressReactions = false
    ): void {
        if (deepEqual(this.data[field as keyof T], value)) return;
        this.data[field as keyof T] = value;
        if (field in this.dirtyData) delete this.dirtyData[field];
        this.emit(ModelEvents.FIELD_CHANGE, { field, value });
        if (!suppressReactions) {
            this.reactionSystem.triggerReactions(field, reactionStack);
        }
    }

    private notifyValidationsSettledIfIdle(): void {
        if (
            this.pendingValidations === 0 &&
            this.validationSettledResolvers.length > 0
        ) {
            const resolvers = this.validationSettledResolvers.splice(0);
            resolvers.forEach((resolve) => resolve());
        }
    }
}
