import {
    FieldSchema,
    Model,
    ModelError,
    ModelEventMap,
    ModelEvents,
    ModelFieldKey,
    ModelFieldName,
    ModelOptions,
    ModelReturn,
    ValidationError,
    ValidationErrors,
} from '../types';
import { validateField } from '../validation/validate-field';
import { cloneDefault } from './clone-default';
import { deepEqual } from './deep-equal';
import { EventEmitter } from './event-emitter';
import { PendingTasks } from './pending-tasks';
import {
    createValidationSnapshot,
    prepareFieldWrites,
} from './write-preparation';
import type { PreparedFieldWrite } from './write-preparation';
import { ReactionSystem, type ReactionWriteContext } from '../reaction/reaction-system';

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
    private errorsSnapshot: ValidationErrors | null = null;
    private dirtyDataSnapshot: Readonly<Partial<T>> | null = null;

    private readonly schema: Model<T>;
    private readonly eventEmitter = new EventEmitter<ModelEventMap<T>>();
    private readonly pendingTasks = new PendingTasks();
    private readonly reactionSystem: ReactionSystem;

    private readonly asyncValidationTimeout: number;
    private validationRequestIds: Record<string, number> = Object.create(null);

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
                getValue: (field) => this.getField(field as ModelFieldKey<T>),
                setValue: (field, value, opts) =>
                    this.updateField(field, value, opts),
                setError: (field, error) => this.recordError(field, error),
                reportError: (event, error) =>
                    this.eventEmitter.emit(event, error),
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
            // Own undefined values keep prototype-named fields safe in snapshots.
            this.modelData[field as keyof T] = cloneDefault(schema.default) as T[keyof T];
            if (schema.default !== undefined) {
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

    // -------------------------------------------------------------------------
    // Public mutation API
    // -------------------------------------------------------------------------

    /**
     * Direct writes follow one pipeline: prepare every input, validate against
     * a shared candidate snapshot, commit each valid field, then trigger one
     * reaction pass for the fields that actually changed. A batch is not atomic:
     * one field can commit even when a sibling fails validation.
     */

    setField = async <K extends ModelFieldKey<T>>(
        field: K,
        value: T[K]
    ): Promise<boolean> => {
        return this.setFields({ [field]: value } as unknown as Partial<T>);
    };

    setFields = async (fields: Partial<T>): Promise<boolean> => {
        return this.runBatch(() =>
            prepareFieldWrites(fields, (field) => this.requireField(field))
        );
    };

    validateAll = async (): Promise<boolean> => {
        let allValid = false;
        try {
            allValid = await this.runBatch(() =>
                Object.keys(this.schema).map((field) => ({
                    field,
                    schema: this.schema[field] as FieldSchema,
                    value: Object.prototype.hasOwnProperty.call(this.dirtyData, field)
                        ? this.dirtyData[field as keyof T]
                        : this.modelData[field as keyof T],
                }))
            );
        } finally {
            await this.settled();
        }

        if (this.disposed) return false;

        const valid = allValid &&
            Object.keys(this.dirtyData).length === 0 &&
            Object.values(this.errors).every((errors) => errors.length === 0);
        this.eventEmitter.emit(ModelEvents.VALIDATION_COMPLETE, { isValid: valid });
        return valid;
    };

    /** Track the whole batch, including reactions from partial commits on rejection. */
    private async runBatch(
        prepare: () => PreparedFieldWrite[]
    ): Promise<boolean> {
        this.ensureNotDisposed();
        const endBatch = this.pendingTasks.begin();
        const changedFields = new Set<string>();
        try {
            const prepared = prepare();
            const data = createValidationSnapshot(this.modelData, prepared);
            const results = await Promise.allSettled(prepared.map((write) =>
                this.validateAndCommit(write, data, (changed) => {
                    if (changed) changedFields.add(write.field);
                })
            ));
            const rejection = results.find(
                (result): result is PromiseRejectedResult => result.status === 'rejected'
            );
            if (rejection) throw rejection.reason;
            return results.every((result) => result.status === 'fulfilled' && result.value);
        } finally {
            try {
                this.reactionSystem.triggerReactionsForFields([...changedFields]);
            } finally {
                endBatch();
            }
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

    get validationErrors(): ValidationErrors {
        if (this.errorsSnapshot === null) {
            this.errorsSnapshot = Object.freeze({ ...this.errors });
        }
        return this.errorsSnapshot;
    }

    getField = <K extends ModelFieldKey<T>>(field: K): T[K] => {
        return this.modelData[field];
    };

    getDirtyData = (): Readonly<Partial<T>> => {
        if (this.dirtyDataSnapshot === null) {
            this.dirtyDataSnapshot = Object.freeze({ ...this.dirtyData });
        }
        return this.dirtyDataSnapshot;
    };

    clearDirtyData = (): void => {
        const fields = Object.keys(this.dirtyData) as ModelFieldName<T>[];
        this.dirtyData = Object.create(null);
        this.dirtyDataSnapshot = null;
        if (fields.length > 0) {
            this.eventEmitter.emit(ModelEvents.DIRTY_DATA_CLEARED, { fields });
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
            this.eventEmitter.emit(ModelEvents.FIELD_NOT_FOUND, error);
            throw new Error(error.message);
        }
        return this.schema[field]!;
    }

    /** Reaction writeback retains its path and initialization context. */
    private async updateField(
        field: string,
        value: any,
        { reactionStack, initializeReactions }: ReactionWriteContext
    ): Promise<boolean> {
        if (this.disposed) return false;
        const schema = this.requireField(field);

        const transformed = schema.transform ? schema.transform(value) : value;

        return this.validateAndCommit({ field, schema, value: transformed }, this.data, (changed) => {
            if (changed || initializeReactions) {
                this.reactionSystem.triggerReactionsForFields([field], reactionStack, initializeReactions);
            }
        });
    }

    private async validateAndCommit(
        { field, schema, value }: PreparedFieldWrite,
        data: Readonly<Record<string, any>>,
        onCommit: (changed: boolean) => void
    ): Promise<boolean> {
        if (this.disposed) return false;
        const requestId = (this.validationRequestIds[field] ?? 0) + 1;
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
            data,
            isCurrent,
            onError: (error) => {
                if (!isCurrent()) return;
                this.recordError(field, error);
                this.eventEmitter.emit(ModelEvents.VALIDATION_ERROR, { ...error });
            },
        });

        if (!isCurrent()) return false;

        if (isValid) {
            onCommit(this.commitValid(field, value));
        } else {
            this.dirtyData[field as keyof T] = value as T[keyof T];
            this.dirtyDataSnapshot = null;
        }
        this.eventEmitter.emit(ModelEvents.FIELD_VALIDATION_COMPLETE, {
            field: field as ModelFieldName<T>,
            isValid,
            dirty: Object.prototype.hasOwnProperty.call(this.dirtyData, field),
        });
        return isValid;
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

    /** Commit validated values; see docs/ARCHITECTURE.md#write-path. */
    private commitValid(
        field: string,
        value: any
    ): boolean {
        const fieldKey = field as keyof T;
        const dataChanged = !deepEqual(this.modelData[fieldKey], value);
        const hadDirty = Object.prototype.hasOwnProperty.call(this.dirtyData, field);

        if (hadDirty) {
            delete this.dirtyData[field];
            this.dirtyDataSnapshot = null;
        }

        if (dataChanged) {
            this.modelData[fieldKey] = value;
            this.dataSnapshot = null;
            this.eventEmitter.emit<typeof ModelEvents.FIELD_CHANGE>(ModelEvents.FIELD_CHANGE, {
                field,
                value,
            } as ModelEventMap<T>[typeof ModelEvents.FIELD_CHANGE]);
        }
        return dataChanged;
    }
}
