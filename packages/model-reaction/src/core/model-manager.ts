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
import {
    createValidationSnapshot,
    prepareFieldWrites,
} from './write-preparation';
import type { PreparedFieldWrite } from './write-preparation';
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
    private modelData: T = Object.create(null);
    private errors: Record<string, readonly ValidationError[]> = Object.create(null);
    /** Last value provided for a field whose validation failed. */
    private dirtyData: Partial<T> = Object.create(null);
    private dataSnapshot: Readonly<T> | null = null;
    private errorsSnapshot:
        | Readonly<Record<string, readonly ValidationError[]>>
        | null = null;
    private dirtyDataSnapshot: Readonly<Partial<T>> | null = null;

    private readonly schema: Model<T>;
    private readonly eventEmitter = new EventEmitter<ModelEventMap<T>>();
    private readonly pendingTasks = new PendingTasks();
    private readonly reactionSystem: ReactionSystem;

    private readonly asyncValidationTimeout: number;
    private validationRequestIds: Record<string, number> = Object.create(null);
    private requestIdCounter = 0;

    private disposed = false;

    constructor(schema: Model<T>, options: ModelOptions = {}) {
        for (const [field, definition] of Object.entries(schema)) {
            if (Array.isArray(definition.reaction)) {
                throw new TypeError(`Field ${field} must declare a single reaction, not an array`);
            }
        }
        this.schema = schema;
        this.asyncValidationTimeout = options.asyncValidationTimeout ?? 5000;

        this.reactionSystem = new ReactionSystem(
            this.schema,
            options,
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

    /** Seed defaults and bootstrap derived values; see docs/API.md. */
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
            this.reactionSystem.triggerReactionsForFields(seededInputs, [], true);
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
        return this.eventEmitter.on(event, callback);
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
        return this.setFields({ [field]: value } as unknown as Partial<T>);
    };

    setFields = async (fields: Partial<T>): Promise<boolean> => {
        return this.runBatch((options) => {
            const prepared = prepareFieldWrites(
                fields,
                (field) => this.requireField(field)
            );
            return this.validatePrepared(prepared, options);
        });
    };

    validateAll = async (): Promise<boolean> => {
        return this.runBatch((options) => {
            return this.validatePrepared(
                Object.keys(this.schema).map((field) => ({
                    field,
                    schema: this.schema[field] as FieldSchema,
                    value: Object.prototype.hasOwnProperty.call(this.dirtyData, field)
                        ? this.dirtyData[field as keyof T]
                        : this.modelData[field as keyof T],
                })),
                options
            );
        }, (allValid) => {
            this.emit(ModelEvents.VALIDATION_COMPLETE, { isValid: allValid });
        });
    };

    /** Shared candidate snapshot; validateAll supplies already transformed values. */
    private async validatePrepared(
        prepared: readonly PreparedFieldWrite[],
        options: CommitOptions
    ): Promise<boolean> {
        const validationData = createValidationSnapshot(this.modelData, prepared);
        const results = await Promise.allSettled(prepared.map(({ field, schema, value }) =>
            this.validateAndCommit(field, schema, value, { ...options, validationData })
        ));
        const rejection = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        if (rejection) throw rejection.reason;
        return results.every((result) => result.status === 'fulfilled' && result.value);
    }

    /** Batch task and rejection handling: docs/DESIGN_SIMPLIFICATION_CN.md §4. */
    private async runBatch(
        validate: (options: CommitOptions) => Promise<boolean>,
        complete?: (allValid: boolean) => void
    ): Promise<boolean> {
        this.ensureNotDisposed();
        const endBatch = this.pendingTasks.begin();
        const changedFields = new Set<string>();
        try {
            let allValid: boolean;
            try {
                allValid = await validate({ changedFields, origin: 'direct' });
            } finally {
                this.reactionSystem.triggerReactionsForFields([...changedFields]);
            }
            complete?.(allValid);
            return allValid;
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
        this.dirtyData = Object.create(null);
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

        this.modelData = Object.create(null);
        this.dirtyData = Object.create(null);
        this.errors = Object.create(null);
        this.validationRequestIds = Object.create(null);
        this.dataSnapshot = null;
        this.errorsSnapshot = null;
        this.dirtyDataSnapshot = null;
    };

    // -------------------------------------------------------------------------
    // Internal: validate + commit
    // -------------------------------------------------------------------------

    private requireField(field: string): FieldSchema {
        if (!Object.prototype.hasOwnProperty.call(this.schema, field)) {
            const error: ModelError = {
                code: 'field_not_found',
                field,
                message: `Field ${field} does not exist in the model schema`,
            };
            this.emit(ModelEvents.FIELD_NOT_FOUND, error);
            throw new Error(error.message);
        }
        return this.schema[field]!;
    }

    /** Reaction writeback retains its path and initialization context. */
    private async updateField(
        field: string,
        value: any,
        options: CommitOptions
    ): Promise<boolean> {
        if (this.disposed) return false;
        const schema = this.requireField(field);

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
                data: options.validationData ?? this.data,
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
                dirty: Object.prototype.hasOwnProperty.call(this.dirtyData, field),
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
        const {
            reactionStack = [],
            changedFields,
            initializeReactions = false,
        } = options;
        const fieldKey = field as keyof T;
        const dataChanged = !deepEqual(this.modelData[fieldKey], value);
        const hadDirty = Object.prototype.hasOwnProperty.call(this.dirtyData, field);

        if (!dataChanged && !hadDirty && !initializeReactions) return;

        if (dataChanged) {
            this.modelData[fieldKey] = value;
            this.dataSnapshot = null;
            if (options.origin === 'direct') {
                this.reactionSystem.invalidateActionsForField(field);
            }
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
        }
        if (!changedFields && (dataChanged || initializeReactions)) {
            this.reactionSystem.triggerReactionsForFields(
                [field],
                reactionStack,
                initializeReactions
            );
        }
    }
}
