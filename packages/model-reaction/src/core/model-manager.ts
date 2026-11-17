import {
    FieldSchema,
    Model,
    ModelError,
    ModelEventMap,
    ModelEvents,
    ModelReturn,
} from '../types';
import type { CommitOptions } from './internal-types';
import { cloneDefault } from '../utils/clone-default';
import { deepEqual } from '../utils/deep-equal';
import { EventEmitter } from './event-emitter';
import { PendingTasks } from './pending-tasks';
import { prepareFieldWrites } from './write-preparation';
import { ReactionSystem } from '../reaction/reaction-system';

/** Owns committed data and lifecycle; see docs/ARCHITECTURE.md. */
export class ModelManager<
    T extends Record<string, any> = Record<string, any>,
> implements ModelReturn<T> {
    private modelData: T = Object.create(null);
    private dataSnapshot: Readonly<T> | null = null;
    private readonly schema: Model<T>;
    private readonly eventEmitter = new EventEmitter<ModelEventMap<T>>();
    private readonly pendingTasks = new PendingTasks();
    private readonly reactionSystem: ReactionSystem;
    private disposed = false;

    constructor(schema: Model<T>) {
        for (const [field, definition] of Object.entries(schema)) {
            if (Array.isArray(definition.reaction)) {
                throw new TypeError(`Field ${field} must declare a single reaction, not an array`);
            }
        }
        this.schema = schema;
        this.reactionSystem = new ReactionSystem(
            schema,
            {
                getValue: (field) => this.getField(field as keyof T),
                setValue: (field, value, opts) => this.updateField(field, value, opts),
                reportError: (event, error) => this.eventEmitter.emit(event, error),
            },
            this.pendingTasks
        );
        this.initializeDefaults();
    }

    private initializeDefaults(): void {
        const seededInputs: string[] = [];
        for (const [field, schema] of Object.entries(this.schema)) {
            if (schema.default !== undefined) {
                this.modelData[field as keyof T] = cloneDefault(schema.default) as T[keyof T];
                if (schema.reaction === undefined) seededInputs.push(field);
            }
        }
        this.reactionSystem.triggerReactionsForFields(seededInputs, [], true);
    }

    private ensureNotDisposed(): void {
        if (this.disposed) {
            throw new Error('ModelManager has been disposed and cannot be used');
        }
    }

    on = <E extends keyof ModelEventMap<T>>(
        event: E,
        callback: (data: ModelEventMap<T>[E]) => void
    ): (() => void) => this.eventEmitter.on(event, callback);

    setField = <K extends keyof T>(field: K, value: T[K]): void => {
        this.setFields({ [field]: value } as unknown as Partial<T>);
    };

    /** Batch preparation and reentrant event semantics: docs/API.md#writes. */
    setFields = (fields: Partial<T>): void => {
        this.ensureNotDisposed();
        const endBatch = this.pendingTasks.begin();
        const changedFields = new Set<string>();
        try {
            const prepared = prepareFieldWrites(fields, (field) => this.requireField(field));
            for (const { field, value } of prepared) {
                if (this.disposed) return;
                this.commit(field, value, { changedFields, origin: 'direct' });
            }
        } finally {
            try {
                this.reactionSystem.triggerReactionsForFields([...changedFields]);
            } finally {
                endBatch();
            }
        }
    };

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

    get data(): Readonly<T> {
        if (this.dataSnapshot === null) {
            this.dataSnapshot = Object.freeze({ ...this.modelData });
        }
        return this.dataSnapshot;
    }

    getField = <K extends keyof T>(field: K): T[K] => this.modelData[field];

    settled = (): Promise<void> => this.pendingTasks.settled();

    dispose = (): void => {
        if (this.disposed) return;
        this.disposed = true;
        this.reactionSystem.dispose();
        this.eventEmitter.clear();
        this.pendingTasks.dispose();
        this.modelData = Object.create(null);
        this.dataSnapshot = null;
    };

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

    private updateField(field: string, value: any, options: CommitOptions): void {
        if (this.disposed) return;
        const schema = this.requireField(field);
        const transformed = schema.transform ? schema.transform(value) : value;
        if (!this.disposed) this.commit(field, transformed, options);
    }

    private commit(field: string, value: any, options: CommitOptions): void {
        const { reactionStack = [], changedFields, initializeReactions = false } = options;
        const dataChanged = !deepEqual(this.modelData[field as keyof T], value);
        if (!dataChanged && !initializeReactions) return;

        if (dataChanged) {
            this.modelData[field as keyof T] = value;
            this.dataSnapshot = null;
            if (options.origin === 'direct') this.reactionSystem.invalidateActionsForField(field);
            changedFields?.add(field);
            this.eventEmitter.emit(ModelEvents.FIELD_CHANGE, { field, value });
        }
        if (!changedFields) {
            this.reactionSystem.triggerReactionsForFields([field], reactionStack, initializeReactions);
        }
    }
}
