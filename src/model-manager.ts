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
    private readonly reactionSystem: ReactionSystem;
    private asyncValidationTimeout: number;
    private validationRequestIds: Record<string, number> = {};
    private requestIdCounter = 0;
    private disposed = false;

    constructor(schema: Model, options?: ModelOptions) {
        this.schema = schema;
        this.options = options || {};
        this.asyncValidationTimeout = this.options.asyncValidationTimeout || 5000; // Default timeout 5 seconds
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
        // Default error listeners
        this.errorHandler.onError(ErrorType.VALIDATION, (error) => {
            this.emit(ModelEvents.VALIDATION_ERROR, error);
        });
    
        this.errorHandler.onError(ErrorType.REACTION, (error) => {
            this.emit(ModelEvents.REACTION_ERROR, error);
        });

        this.errorHandler.onError(ErrorType.CIRCULAR_DEPENDENCY, (error) => {
            this.emit(ModelEvents.REACTION_ERROR, error);
        });
    
        // Add field not found error event forwarding
        this.errorHandler.onError(ErrorType.FIELD_NOT_FOUND, (error) => {
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
    }

    // Validate single field
    private async validateSingleField(schema: FieldSchema, value: any, field: string): Promise<boolean> {
        return validateField({
            schema, 
            value, 
            errors: this.validationErrors, 
            field, 
            timeout: this.asyncValidationTimeout, 
            errorHandler: this.errorHandler,
            failFast: this.options.failFast ?? false,
            data: this.data as Record<string, any>
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
        (this.dirtyData as any)[field] = value;
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
        // Validate all fields
        const validationPromises = Object.keys(this.schema).map(field => this.validateAndUpdateField(field));
        
        const results = await Promise.all(validationPromises);
        const allValid = results.every(res => res);

        // Trigger validation complete event
        this.emit(ModelEvents.VALIDATION_COMPLETE, { isValid: allValid });

        // Check if there are any errors
        return allValid;
    }

    // Validate and update single field
    private async validateAndUpdateField(field: string): Promise<boolean> {
        const schema = this.schema[field] as FieldSchema;
        const value = field in this.dirtyData ? this.dirtyData[field] : this.data[field];
        this.validationErrors[field] = [];
        
        const isValid = await validateField({
            schema, 
            value, 
            errors: this.validationErrors, 
            field, 
            timeout: this.asyncValidationTimeout, 
            errorHandler: this.errorHandler,
            failFast: this.options.failFast ?? false,
            data: this.data as Record<string, any>
        });
        
        if (!isValid) {
            (this.dirtyData as any)[field] = value;
        } else {
            if (field in this.dirtyData) {
                delete this.dirtyData[field as keyof T];
            }
            // Update value in data
            if (!deepEqual(this.data[field as keyof T], value)) {
                (this.data as any)[field] = value;
                this.emit(ModelEvents.FIELD_CHANGE, { field, value });
                this.reactionSystem.triggerReactions(field);
            }
        }

        return isValid;
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
        await this.reactionSystem.settled();
        // Simple implementation: wait for next tick
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Clean up resources
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.reactionSystem.dispose();
        this.eventEmitter.clear();
        this.errorHandler.dispose();
        this.data = {} as T;
        this.dirtyData = {};
        this.validationErrors = {};
        this.validationRequestIds = {};
    }
}
