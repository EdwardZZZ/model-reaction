import {
    ValidationError,
    Validator,
    ValidateFieldOptions,
} from './types';
import { ErrorHandler } from './error-handler';

/**
 * Run all validators of a single field.
 *
 * Supports both sync and async validators, optional cross-field `data`,
 * `condition` predicates, `failFast` short-circuit, and a per-request
 * `isCurrent()` race-guard so a stale validator can't pollute current errors.
 */
export async function validateField(
    options: ValidateFieldOptions
): Promise<boolean> {
    const {
        schema,
        value,
        errors,
        field,
        timeout = 5000,
        errorHandler,
        failFast = false,
        data,
        isCurrent,
    } = options;

    if (!schema.validator) return true;

    const ctxData = data ?? {};
    const applicable = schema.validator.filter(
        (v) => !v.condition || v.condition(ctxData)
    );

    let isValid = true;

    if (failFast) {
        for (const validator of applicable) {
            const ok = await runValidator(
                validator,
                value,
                field,
                timeout,
                errors,
                errorHandler,
                ctxData,
                isCurrent
            );
            if (!ok) {
                isValid = false;
                break;
            }
        }
    } else {
        const results = await Promise.all(
            applicable.map((v) =>
                runValidator(
                    v,
                    value,
                    field,
                    timeout,
                    errors,
                    errorHandler,
                    ctxData,
                    isCurrent
                )
            )
        );
        isValid = results.every(Boolean);
    }

    return isValid;
}

async function runValidator(
    validator: Validator,
    value: unknown,
    field: string,
    timeout: number,
    errors: Record<string, ValidationError[]>,
    errorHandler: ErrorHandler,
    data: Record<string, any>,
    isCurrent?: () => boolean
): Promise<boolean> {
    if (!validator.validate) return true;

    try {
        const result = validator.validate(value, data);

        // Sync result: no timeout needed
        if (!(result instanceof Promise)) {
            if (!result) {
                if (isCurrent && !isCurrent()) return false;
                pushValidationError(
                    field,
                    validator.type,
                    validator.message,
                    errors,
                    errorHandler
                );
                return false;
            }
            return true;
        }

        // Async result: race against timeout
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<boolean>((_, reject) => {
            timeoutId = setTimeout(
                () => reject(new Error(`Validation timeout: ${field}`)),
                timeout
            );
        });

        try {
            const ok = await Promise.race([result, timeoutPromise]);
            if (timeoutId) clearTimeout(timeoutId);
            if (!ok) {
                if (isCurrent && !isCurrent()) return false;
                pushValidationError(
                    field,
                    validator.type,
                    validator.message,
                    errors,
                    errorHandler
                );
                return false;
            }
            return true;
        } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (isCurrent && !isCurrent()) return false;
            const msg = err instanceof Error ? err.message : String(err);
            pushValidationError(
                field,
                'validation_error',
                `Validation failed: ${msg}`,
                errors,
                errorHandler
            );
            return false;
        }
    } catch (err) {
        if (isCurrent && !isCurrent()) return false;
        const msg = err instanceof Error ? err.message : String(err);
        pushValidationError(
            field,
            'validation_error',
            `Validation failed: ${msg}`,
            errors,
            errorHandler
        );
        return false;
    }
}

function pushValidationError(
    field: string,
    rule: string,
    message: string,
    errors: Record<string, ValidationError[]>,
    errorHandler: ErrorHandler
): void {
    if (!errors[field]) errors[field] = [];
    errors[field].push({ field, rule, message });
    errorHandler.triggerError(
        errorHandler.createValidationError(field, message)
    );
}
