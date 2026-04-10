import { ErrorType, AppError } from './types';

// Unified error handling class
export class ErrorHandler {
    private errorListeners: Record<
        ErrorType,
        Array<(error: AppError) => void>
    > = {
        [ErrorType.VALIDATION]: [],
        [ErrorType.REACTION]: [],
        [ErrorType.FIELD_NOT_FOUND]: [],
        [ErrorType.DEPENDENCY_ERROR]: [],
        [ErrorType.CIRCULAR_DEPENDENCY]: [],
        [ErrorType.UNKNOWN]: [],
    };

    constructor() {}

    // Subscribe to errors
    onError(type: ErrorType, listener: (error: AppError) => void): void {
        if (!this.errorListeners[type]) {
            this.errorListeners[type] = [];
        }
        this.errorListeners[type].push(listener);
    }

    // Unsubscribe from errors
    offError(type: ErrorType, listener: (error: AppError) => void): void {
        if (this.errorListeners[type]) {
            this.errorListeners[type] = this.errorListeners[type].filter(
                (l) => l !== listener
            );
        }
    }

    // Trigger an error
    triggerError(error: AppError): void {
        /* eslint-disable no-console */
        console.error(
            `[${error.type}] ${error.field ? `field ${error.field}: ` : ''}${
                error.message
            }`
        );

        // Trigger specific type error listeners
        if (this.errorListeners[error.type]) {
            this.errorListeners[error.type].forEach((listener) =>
                listener(error)
            );
        }

        // Trigger general error listeners
        if (this.errorListeners[ErrorType.UNKNOWN]) {
            this.errorListeners[ErrorType.UNKNOWN].forEach((listener) =>
                listener(error)
            );
        }
    }

    // Create validation error
    createValidationError(field: string, message: string): AppError {
        return {
            type: ErrorType.VALIDATION,
            field,
            message,
        };
    }

    // Create reaction error
    createReactionError(field: string, error: Error): AppError {
        return {
            type: ErrorType.REACTION,
            field,
            message: error.message,
            originalError: error,
        };
    }

    // Create field not found error
    createFieldNotFoundError(field: string): AppError {
        return {
            type: ErrorType.FIELD_NOT_FOUND,
            field,
            message: `Field ${field} does not exist in the model schema`,
        };
    }

    // Create dependency error
    createDependencyError(field: string, dependency: string): AppError {
        return {
            type: ErrorType.DEPENDENCY_ERROR,
            field,
            message: `Dependency field ${dependency} is not defined`,
        };
    }

    // Create circular dependency error
    createCircularDependencyError(path: string, field: string): AppError {
        return {
            type: ErrorType.CIRCULAR_DEPENDENCY,
            field,
            message: `Circular dependency detected: ${path} -> ${field}`,
        };
    }

    dispose(): void {
        Object.keys(this.errorListeners).forEach((key) => {
            this.errorListeners[key as ErrorType] = [];
        });
    }
}
