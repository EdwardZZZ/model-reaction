import { ValidationError, Validator, ValidateFieldOptions } from './types';
import { ErrorHandler } from './error-handler';

// Unified validation function - supports both synchronous and asynchronous validation
export async function validateField(options: ValidateFieldOptions): Promise<boolean> {
    const { schema, value, errors, field, timeout = 5000, errorHandler, failFast = false, data, isCurrent } = options;
    if (!schema.validator) return true;
    let isValid = true;
    const ctxData = data || {};

    if (failFast) {
        for (const validator of schema.validator) {
            if (validator.condition && !validator.condition(ctxData)) {
                continue;
            }
            const result = await executeValidator(validator, value, field, timeout, errors, errorHandler, ctxData, isCurrent);
            if (!result) {
                isValid = false;
                break;
            }
        }
    } else {
        const applicableValidators = schema.validator.filter(validator => {
            if (validator.condition && !validator.condition(ctxData)) {
                return false;
            }
            return true;
        });

        const validationPromises = applicableValidators.map(validator => 
            executeValidator(validator, value, field, timeout, errors, errorHandler, ctxData, isCurrent)
                .then(res => {
                    if (!res) isValid = false;
                    return res;
                })
        );

        await Promise.all(validationPromises);
    }

    return isValid;
}

async function executeValidator(
    validator: Validator,
    value: any,
    field: string,
    timeout: number,
    errors: Record<string, ValidationError[]>,
    errorHandler: ErrorHandler,
    data?: Record<string, any>,
    isCurrent?: () => boolean
): Promise<boolean> {
    if (!validator.validate) {
        return true;
    }

    try {
        const result = validator.validate(value, data);
        
        // Check if result is a promise
        if (result instanceof Promise) {
            // Async validation with timeout
            let timeoutId: number;
            const timeoutPromise = new Promise<boolean>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`Validation timeout: ${field}`)), timeout) as unknown as number;
            });

            try {
                const res = await Promise.race([result, timeoutPromise]);
                clearTimeout(timeoutId!);
                if (!res) {
                    if (isCurrent && !isCurrent()) return false;
                    handleValidationError(field, validator, validator.message, errors, errorHandler);
                    return false;
                }
                return true;
            } catch (error) {
                clearTimeout(timeoutId!);
                if (isCurrent && !isCurrent()) return false;
                const errorMessage = error instanceof Error ? error.message : String(error);
                handleExceptionError(field, errorMessage, errors, errorHandler);
                return false;
            }
        } else {
            // Synchronous validation - no timeout needed
            if (!result) {
                if (isCurrent && !isCurrent()) return false;
                handleValidationError(field, validator, validator.message, errors, errorHandler);
                return false;
            }
            return true;
        }
    } catch (error) {
        // Handle synchronous validation errors
        if (isCurrent && !isCurrent()) return false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        handleExceptionError(field, errorMessage, errors, errorHandler);
        return false;
    }
}

function handleValidationError(
    field: string, 
    validator: Validator, 
    message: string, 
    errors: Record<string, ValidationError[]>, 
    errorHandler: ErrorHandler
) {
    errors[field] = errors[field] || [];
    errors[field].push({
        field,
        rule: validator.type,
        message: message
    });
    // Trigger validation error
    const error = errorHandler.createValidationError(field, message);
    errorHandler.triggerError(error);
}

function handleExceptionError(
    field: string, 
    message: string, 
    errors: Record<string, ValidationError[]>, 
    errorHandler: ErrorHandler
) {
    errors[field] = errors[field] || [];
    errors[field].push({
        field,
        rule: 'validation_error',
        message: `Validation failed: ${message}`
    });
    // Trigger validation error
    const appError = errorHandler.createValidationError(field, `Validation failed: ${message}`);
    errorHandler.triggerError(appError);
}

export function deepEqual(a: any, b: any, seen = new WeakSet<object>()): boolean {
    if (a === b) return true;

    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }

    if (seen.has(a) || seen.has(b)) return a === b;
    seen.add(a);
    seen.add(b);

    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    if (a instanceof Date !== b instanceof Date) return false;

    if (a instanceof RegExp && b instanceof RegExp) {
        return a.source === b.source && a.flags === b.flags;
    }
    if (a instanceof RegExp !== b instanceof RegExp) return false;

    const isArrayA = Array.isArray(a);
    const isArrayB = Array.isArray(b);

    if (isArrayA !== isArrayB) return false;

    if (isArrayA && isArrayB) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i], seen)) return false;
        }
        return true;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key], seen)) {
            return false;
        }
    }
    return true;
}
