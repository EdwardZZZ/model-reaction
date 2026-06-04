import { EventEmitter } from './event-emitter';
import { ReactionSystem } from './reaction-system';
import {
    ERROR,
    FIELD_CHANGE,
    FieldSchema,
    Model,
    ModelError,
    ModelOptions,
    ValidationError,
    Validator,
} from './types';

/**
 * Synchronous core behind `createModel(...)` in lite.
 *
 * verify-then-commit, single tick:
 *   1. run validators synchronously
 *   2. on pass: write to `data` (compared with `Object.is`), emit
 *      `field:change`, run reactions synchronously
 *   3. on fail: drop the value; caller reads `validationErrors[field]`
 */
export class ModelManager<T extends Record<string, any> = Record<string, any>> {
    data: T = {} as T;
    validationErrors: Record<string, ValidationError[]> = {};

    private readonly schema: Model;
    private readonly eventEmitter = new EventEmitter();
    private readonly reactionSystem: ReactionSystem;

    private disposed = false;

    constructor(schema: Model, _options: ModelOptions = {}) {
        this.schema = schema;

        this.reactionSystem = new ReactionSystem(this.schema, {
            getValue: (field) => this.getField(field as keyof T),
            setValue: (field, value, opts) => this.updateField(field, value, opts),
            onError: (err) => this.eventEmitter.emit(ERROR, err),
        });

        this.initializeDefaults();
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
            throw new Error('ModelManager has been disposed and cannot be used');
        }
    }

    // ------------------------------------------------------------------
    // Event facade
    // ------------------------------------------------------------------

    on(event: string, callback: (data: any) => void): void {
        this.eventEmitter.on(event, callback);
    }

    off(event: string, callback?: (data: any) => void): void {
        this.eventEmitter.off(event, callback);
    }

    // ------------------------------------------------------------------
    // Public mutation API (synchronous)
    // ------------------------------------------------------------------

    setField<K extends keyof T>(field: K, value: T[K]): boolean {
        this.ensureNotDisposed();
        return this.updateField(field as string, value);
    }

    setFields(fields: Partial<T>): boolean {
        this.ensureNotDisposed();
        const entries = Object.entries(fields);
        const results = entries.map(([field, value]) =>
            this.updateField(field, value, { suppressReactions: true })
        );
        this.reactionSystem.triggerReactionsForFields(entries.map(([f]) => f));
        return results.every(Boolean);
    }

    /**
     * Re-run every field's validators against its current `data` value.
     * Useful after cross-field schema dependencies change. Does not mutate
     * `data`; only refreshes `validationErrors`.
     */
    validateAll(): boolean {
        this.ensureNotDisposed();
        const fields = Object.keys(this.schema);
        const results = fields.map((field) => {
            this.validationErrors[field] = [];
            const schema = this.schema[field] as FieldSchema;
            const value = this.data[field as keyof T];
            return this.runValidators(schema, value, field);
        });
        return results.every(Boolean);
    }

    // ------------------------------------------------------------------
    // Subscription
    // ------------------------------------------------------------------

    /**
     * Subscribe to a derived value via a selector. Equality uses `Object.is`
     * — return primitives or stable references from the selector.
     */
    subscribe<R>(
        selector: (data: T) => R,
        callback: (value: R, prev: R) => void
    ): () => void {
        let prev = selector(this.data);
        const handler = (): void => {
            const next = selector(this.data);
            if (!Object.is(next, prev)) {
                const old = prev;
                prev = next;
                callback(next, old);
            }
        };
        this.eventEmitter.on(FIELD_CHANGE, handler);
        return () => this.eventEmitter.off(FIELD_CHANGE, handler);
    }

    // ------------------------------------------------------------------
    // Public read API
    // ------------------------------------------------------------------

    getField<K extends keyof T>(field: K): T[K] {
        return this.data[field];
    }

    // ------------------------------------------------------------------
    // Dispose
    // ------------------------------------------------------------------

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.reactionSystem.dispose();
        this.eventEmitter.clear();

        this.data = {} as T;
        this.validationErrors = {};
    }

    // ------------------------------------------------------------------
    // Internal: validate + commit (all synchronous)
    // ------------------------------------------------------------------

    private updateField(
        field: string,
        value: any,
        options: { reactionStack?: string[]; suppressReactions?: boolean } = {}
    ): boolean {
        const schema = this.schema[field];
        if (!schema) {
            this.emitError({
                kind: 'validation',
                field,
                message: `Field ${field} does not exist in the model schema`,
            });
            return false;
        }

        this.validationErrors[field] = [];
        const isValid = this.runValidators(schema, value, field);

        if (isValid) {
            this.commitValid(field, value, options.reactionStack, options.suppressReactions);
        }
        return isValid;
    }

    /**
     * Synchronous validator runner. Async validators (Promise return) are
     * rejected with an explicit error so the lite contract stays clear.
     */
    private runValidators(
        schema: FieldSchema,
        value: unknown,
        field: string
    ): boolean {
        const validators = schema.validator ?? [];
        let allValid = true;

        for (const v of validators as Validator[]) {
            const result = v.validate(value, this.data as Record<string, any>);
            if (result && typeof (result as any).then === 'function') {
                this.recordError(field, {
                    field,
                    rule: v.type,
                    message:
                        'model-reaction-lite does not support async validators (Promise<boolean>)',
                });
                allValid = false;
                continue;
            }
            if (!result) {
                this.recordError(field, {
                    field,
                    rule: v.type,
                    message: v.message,
                });
                allValid = false;
            }
        }

        return allValid;
    }

    private recordError(field: string, error: ValidationError): void {
        if (!this.validationErrors[field]) this.validationErrors[field] = [];
        this.validationErrors[field].push(error);
        this.emitError({
            kind: 'validation',
            field,
            message: error.message,
            ...(error.rule !== undefined ? { rule: error.rule } : {}),
        });
    }

    private emitError(err: ModelError): void {
        this.eventEmitter.emit(ERROR, err);
    }

    private commitValid(
        field: string,
        value: any,
        reactionStack: string[] = [],
        suppressReactions = false
    ): void {
        const fieldKey = field as keyof T;
        if (Object.is(this.data[fieldKey], value)) return;

        this.data[fieldKey] = value;
        this.eventEmitter.emit(FIELD_CHANGE, { field, value });
        if (!suppressReactions) {
            this.reactionSystem.triggerReactions(field, reactionStack);
        }
    }
}
