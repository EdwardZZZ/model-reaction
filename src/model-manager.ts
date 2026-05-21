import { Model, ModelOptions, ValidationError, FieldSchema, ErrorType, ModelEvents } from './types';
import { validateField, deepEqual } from './utils';
import { ErrorHandler } from './error-handler';
import { EventEmitter } from './event-emitter';
import { ReactionSystem } from './reaction-system';

// Core model class - encapsulates all model-related functionality
export class ModelManager<T extends Record<string, any> = Record<string, any>> {
    data: T = {} as T;
    validationErrors: Record<string, ValidationError[]> = {};
    dirtyData: Partial<T> = {}; // Stores fields with validation failures and their values
    
    private readonly schema: Model;
    private readonly options: ModelOptions;
    private readonly eventEmitter: EventEmitter;
    private readonly errorHandler: ErrorHandler;
    private readonly ownsErrorHandler: boolean;
    private readonly errorListenerRegistrations: Array<{ type: ErrorType; listener: (e: any) => void }> = [];
    private readonly reactionSystem: ReactionSystem;
    private asyncValidationTimeout: number;
    private validationRequestIds: Record<string, number> = {};
    private requestIdCounter = 0;
    private pendingValidations = 0;
    private validationSettledResolvers: Array<() => void> = [];
    private disposed = false;

    constructor(schema: Model, options?: ModelOptions) {
        this.schema = schema;
        this.options = options || {};
        this.asyncValidationTimeout = this.options.asyncValidationTimeout || 5000; // Default timeout 5 seconds
        this.ownsErrorHandler = !this.options.errorHandler;
        this.errorHandler = this.options.errorHandler || new ErrorHandler();
        this.eventEmitter = new EventEmitter();

        this.setupErrorHandling();
        
        // Initialize reaction system
        this.reactionSystem = new ReactionSystem(
            this.schema, 
            this.options, 
            {
                getValue: (field) => this.getField(field),
                setValue: (field, value, opts) => this.updateField(field, value, opts),
                emit: (event, data) => this.emit(event, data),
                setError: (field, error) => {
                    if (!this.validationErrors[field]) {
                        this.validationErrors[field] = [];
                    }
                    this.validationErrors[field].push(error);
                }
            },
            this.errorHandler
        );

        this.initializeDefaults();
    }

    private setupErrorHandling(): void {
        const register = (type: ErrorType, listener: (error: any) => void) => {
            this.errorHandler.onError(type, listener);
            this.errorListenerRegistrations.push({ type, listener });
        };

        // Default error listeners
        register(ErrorType.VALIDATION, (error) => {
            this.emit(ModelEvents.VALIDATION_ERROR, error);
        });

        register(ErrorType.REACTION, (error) => {
            this.emit(ModelEvents.REACTION_ERROR, error);
        });

        register(ErrorType.CIRCULAR_DEPENDENCY, (error) => {
            this.emit(ModelEvents.REACTION_ERROR, error);
        });

        register(ErrorType.DEPENDENCY_ERROR, (error) => {
            this.emit(ModelEvents.DEPENDENCY_ERROR, error);
        });

        // Add field not found error event forwarding
        register(ErrorType.FIELD_NOT_FOUND, (error) => {
            this.emit(ModelEvents.FIELD_NOT_FOUND, error);
        });
    }

    // Initialize default values
    private initializeDefaults(): void {
        Object.entries(this.schema).forEach(([field, schema]) => {
            if (schema.default !== undefined) {
                (this.data as any)[field] = schema.default;
            }
        });
    }

    // Subscribe to events
    on(event: string, callback: (data: any) => void): void {
        this.eventEmitter.on(event, callback);
    }

    // Unsubscribe from events
    off(event: string, callback?: (data: any) => void): void {
        this.eventEmitter.off(event, callback);
    }

    // Trigger event
    private emit(event: string, data: any): void {
        this.eventEmitter.emit(event, data);
    }

    // Update: Set field value (async)
    private ensureNotDisposed(): void {
        if (this.disposed) {
            throw new Error('ModelManager has been disposed and cannot be used');
        }
    }

    async setField<K extends keyof T>(field: K, value: T[K]): Promise<boolean> {
        this.ensureNotDisposed();
        return this.updateField(field as string, value);
    }

    // Internal method for setting field, supporting recursion control for reactions
    private async updateField(field: string, value: any, options: { reactionStack?: string[], suppressReactions?: boolean } = {}): Promise<boolean> {
        this.pendingValidations++;
        try {
            const schema = this.schema[field];
            if (!schema) {
                const error = this.errorHandler.createFieldNotFoundError(field);
                this.errorHandler.triggerError(error);
                if (this.options.strictMode) {
                    throw new Error(error.message);
                }
                return false;
            }

            // Track request ID for race condition handling
            const requestId = ++this.requestIdCounter;
            this.validationRequestIds[field] = requestId;

            // Clear previous errors
            this.validationErrors[field] = [];

            // Apply transformation
            let transformedValue = value;
            if (schema.transform) {
                transformedValue = schema.transform(value);
            }

            // Validate the field immediately
            const isValid = await this.validateSingleField(schema, transformedValue, field);

            // Check if this request is still valid (race condition check)
            if (this.validationRequestIds[field] !== requestId) {
                 return false;
            }

            // Process validation result
            if (isValid) {
                this.handleValidField(field, transformedValue, options.reactionStack, options.suppressReactions);
            } else {
                this.handleInvalidField(field, transformedValue);
            }

            // Return validation result
            return isValid;
        } finally {
            this.pendingValidations--;
            this.notifyValidationsSettledIfIdle();
        }
    }

    private notifyValidationsSettledIfIdle(): void {
        if (this.pendingValidations === 0 && this.validationSettledResolvers.length > 0) {
            const resolvers = this.validationSettledResolvers.splice(0);
            resolvers.forEach((resolve) => resolve());
        }
    }

    // Validate single field
    private async validateSingleField(schema: FieldSchema, value: any, field: string): Promise<boolean> {
        const requestId = this.validationRequestIds[field];
        return validateField({
            schema, 
            value, 
            errors: this.validationErrors, 
            field, 
            timeout: this.asyncValidationTimeout, 
            errorHandler: this.errorHandler,
            failFast: this.options.failFast ?? false,
            data: this.data as Record<string, any>,
            isCurrent: () => this.validationRequestIds[field] === requestId
        });
    }

    // Handle valid field value
    private handleValidField(field: string, value: any, reactionStack: string[] = [], suppressReactions: boolean = false): void {
        const valueChanged = !deepEqual(this.data[field], value);
        if (valueChanged) {
            this.data[field as keyof T] = value;
            if (field in this.dirtyData) {
                delete this.dirtyData[field];
            }
            this.emit(ModelEvents.FIELD_CHANGE, { field, value });
            
            if (!suppressReactions) {
                this.reactionSystem.triggerReactions(field, reactionStack);
            }
        }
    }

    // Handle invalid field value
    private handleInvalidField(field: string, value: any): void {
        // Validation failed, save to dirtyData
        this.dirtyData[field as keyof T] = value as T[keyof T];
    }

    // Update: Batch update fields (async)
    async setFields(fields: Partial<T>): Promise<boolean> {
        this.ensureNotDisposed();
        let allValid = true;
        
        // First validate and update each field
        // Optimization: Run in parallel since they are async
        const results = await Promise.all(
            Object.entries(fields).map(([field, value]) => 
                this.updateField(field as string, value, { suppressReactions: true })
            )
        );

        allValid = results.every(result => result);
        
        // Trigger reactions for all fields involved in the batch update
        this.reactionSystem.triggerReactionsForFields(Object.keys(fields));
        
        return allValid;
    }

    // Get field value
    getField<K extends keyof T>(field: K): T[K] {
        return this.data[field];
    }

    // Get dirty data
    getDirtyData(): Partial<T> {
        return { ...this.dirtyData };
    }

    // Clear dirty data
    clearDirtyData(): void {
        this.dirtyData = {};
    }

    // Update: Validate all fields (async)
    async validateAll(): Promise<boolean> {
        this.ensureNotDisposed();
        // Validate all fields with reactions suppressed; batch-trigger once at the end.
        const fields = Object.keys(this.schema);
        const validationPromises = fields.map((field) =>
            this.validateAndUpdateField(field, { suppressReactions: true })
        );

        const results = await Promise.all(validationPromises);
        const allValid = results.every((res) => res);

        // Single batched reaction trigger for all changed fields
        this.reactionSystem.triggerReactionsForFields(fields);

        // Trigger validation complete event
        this.emit(ModelEvents.VALIDATION_COMPLETE, { isValid: allValid });

        // Check if there are any errors
        return allValid;
    }

    // Validate and update single field
    private async validateAndUpdateField(
        field: string,
        opts: { suppressReactions?: boolean } = {}
    ): Promise<boolean> {
        this.pendingValidations++;
        try {
            const schema = this.schema[field] as FieldSchema;
            const fieldKey = field as keyof T;
            const value = field in this.dirtyData ? this.dirtyData[fieldKey] : this.data[fieldKey];
            const requestId = ++this.requestIdCounter;
            this.validationRequestIds[field] = requestId;
            this.validationErrors[field] = [];

            const isValid = await validateField({
                schema,
                value,
                errors: this.validationErrors,
                field,
                timeout: this.asyncValidationTimeout,
                errorHandler: this.errorHandler,
                failFast: this.options.failFast ?? false,
                data: this.data as Record<string, any>,
                isCurrent: () => this.validationRequestIds[field] === requestId
            });

            if (this.validationRequestIds[field] !== requestId) {
                return false;
            }

            if (!isValid) {
                this.dirtyData[fieldKey] = value as T[keyof T];
            } else {
                if (field in this.dirtyData) {
                    delete this.dirtyData[fieldKey];
                }
                // Update value in data
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

    // Get validation summary
    getValidationSummary(): string {
        const errors = Object.values(this.validationErrors).flat();
        if (errors.length === 0) return 'Validation passed';

        if (this.options.errorFormatter) {
            return errors.map(this.options.errorFormatter).join('; ');
        }

        return errors.map(err => `${err.field}: ${err.message}`).join('; ');
    }

    // Get error handler - allows external error subscription
    getErrorHandler(): ErrorHandler {
        return this.errorHandler;
    }
    
    // Wait for system to settle (reactions, async validations)
    async settled(): Promise<void> {
        // Loop until both reactions and validations are quiet at the same time.
        // Reactions can spawn validations and vice versa, so a single pass isn't enough.
        // Cap iterations defensively to prevent any hypothetical infinite loop.
        for (let i = 0; i < 50; i++) {
            await this.reactionSystem.settled();
            if (this.pendingValidations === 0) {
                return;
            }
            await new Promise<void>((resolve) => {
                this.validationSettledResolvers.push(resolve);
            });
        }
    }

    // Clean up resources
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.reactionSystem.dispose();
        this.eventEmitter.clear();

        // Only off the listeners we actually registered, never wipe a shared
        // errorHandler that other callers may still depend on.
        this.errorListenerRegistrations.forEach(({ type, listener }) => {
            this.errorHandler.offError(type, listener);
        });
        this.errorListenerRegistrations.length = 0;

        // If the errorHandler was created internally, fully dispose it.
        if (this.ownsErrorHandler) {
            this.errorHandler.dispose();
        }

        // Resolve any settled() waiters so they don't hang forever.
        const pendingValidationResolvers = this.validationSettledResolvers.splice(0);
        pendingValidationResolvers.forEach((resolve) => resolve());

        this.data = {} as T;
        this.dirtyData = {};
        this.validationErrors = {};
        this.validationRequestIds = {};
    }
}
