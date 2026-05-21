import { ErrorHandler } from './error-handler';

export enum ErrorType {
  VALIDATION = 'validation',
  REACTION = 'reaction',
  FIELD_NOT_FOUND = 'field_not_found',
  DEPENDENCY_ERROR = 'dependency_error',
  CIRCULAR_DEPENDENCY = 'circular_dependency',
  UNKNOWN = 'unknown',
}

export enum ModelEvents {
  VALIDATION_ERROR = 'validation:error',
  REACTION_ERROR = 'reaction:error',
  FIELD_NOT_FOUND = 'field:not-found',
  FIELD_CHANGE = 'field:change',
  VALIDATION_COMPLETE = 'validation:complete',
}

export interface ValidateFieldOptions {
    schema: FieldSchema;
    value: any;
    errors: Record<string, ValidationError[]>;
    field: string;
    timeout?: number;
    errorHandler: ErrorHandler;
    failFast?: boolean;
    data?: Record<string, any>;
    // Race-condition guard: returns true if this validation request is still the latest
    isCurrent?: () => boolean;
}

export interface AppError {
  type: ErrorType;
  field?: string;
  message: string;
  originalError?: Error;
}

// Enhanced validator interface
export interface Validator {
    type: string;
    message: string;
    validate: (value: any, data?: Record<string, any>) => boolean | Promise<boolean>;
    // Optional conditional validation
    condition?: (data: Record<string, any>) => boolean;
}

export interface ValidationError {
    field: string;
    message: string;
    rule?: string;
    // Add error code to support internationalization
    code?: string;
}

export interface Reaction {
    fields: string[];
    computed: (values: Record<string, any>) => any;
    action?: (data: Record<string, any>) => void;
}

// Enhanced field schema interface
export interface FieldSchema {
    // Field type - added date and enum types
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'enum';
    // Validation rules
    validator?: Validator[];
    // Default value
    default?: any;
    // Reaction definition
    reaction?: Reaction | Reaction[];
    // Value transformation function
    transform?: (value: any) => any;
}

export type Model<T = Record<string, any>> = {
    [K in keyof T]-?: FieldSchema;
};

export interface ModelOptions {
    // Async validation timeout in milliseconds
    asyncValidationTimeout?: number;
    // Debounce time for reaction triggers in milliseconds
    debounceReactions?: number;
    // Custom error formatting function
    errorFormatter?: (error: ValidationError) => string;
    // Strict mode (unknown fields will throw errors)
    strictMode?: boolean;
    // Error handler instance
    errorHandler?: ErrorHandler;
    // Validation strategy: if true, stop validating a field after the first error
    failFast?: boolean;
}

export interface ModelReturn<T = Record<string, any>> {
    data: T;
    validationErrors: Record<string, ValidationError[]>;
    setField: <K extends keyof T>(field: K, value: T[K]) => Promise<boolean>;
    getField: <K extends keyof T>(field: K) => T[K];
    setFields: (fields: Partial<T>) => Promise<boolean>;
    validateAll: () => Promise<boolean>;
    getValidationSummary: () => string;
    on: (event: string, callback: (...args: any[]) => void) => void;
    off: (event: string, callback?: (...args: any[]) => void) => void;
    getDirtyData: () => Partial<T>;
    clearDirtyData: () => void;
    // Wait for all pending reactions and validations to complete
    settled: () => Promise<void>;
    dispose: () => void;
}