import {
    FieldSchema,
    ValidationError,
    Validator,
} from './types';

/**
 * Run all validators of a single field.
 *
 * Supports both sync and async validators, optional cross-field `data`,
 * `condition` predicates, `failFast` short-circuit, and a per-request
 * `isCurrent()` race-guard so a stale validator can't pollute current errors.
 */
export async function validateField(
    options: {
        schema: FieldSchema;
        value: unknown;
        errors: Record<string, ValidationError[]>;
        field: string;
        timeout?: number;
        failFast?: boolean;
        data?: Record<string, any>;
        isCurrent?: () => boolean;
        onError?: (error: ValidationError) => void;
    }
): Promise<boolean> {
    const {
        schema,
        value,
        errors,
        field,
        timeout = 5000,
        failFast = false,
        data,
        isCurrent,
        onError,
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
                ctxData,
                isCurrent,
                onError
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
                    ctxData,
                    isCurrent,
                    onError
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
    data: Record<string, any>,
    isCurrent?: () => boolean,
    onError?: (error: ValidationError) => void
): Promise<boolean> {
    if (!validator.validate) return true;

    try {
        const result = validator.validate(value, data);

        // Only async results race a timeout; sync results resolve immediately.
        const ok =
            result instanceof Promise
                ? await raceTimeout(result, field, timeout)
                : result;

        if (ok) return true;

        if (isCurrent && !isCurrent()) return false;
        pushValidationError(
            field,
            validator.type,
            validator.message,
            errors,
            onError
        );
        return false;
    } catch (err) {
        if (isCurrent && !isCurrent()) return false;
        const msg = err instanceof Error ? err.message : String(err);
        pushValidationError(
            field,
            'validation_error',
            `Validation failed: ${msg}`,
            errors,
            onError
        );
        return false;
    }
}

/** Resolve `promise`, rejecting if it does not settle within `timeout` ms. */
async function raceTimeout(
    promise: Promise<boolean>,
    field: string,
    timeout: number
): Promise<boolean> {
    // Assigned synchronously inside the executor below, so it is always set
    // by the time `finally` runs.
    let timeoutId!: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<boolean>((_, reject) => {
        timeoutId = setTimeout(
            () => reject(new Error(`Validation timeout: ${field}`)),
            timeout
        );
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

function pushValidationError(
    field: string,
    rule: string,
    message: string,
    errors: Record<string, ValidationError[]>,
    onError?: (error: ValidationError) => void
): void {
    if (!errors[field]) errors[field] = [];
    const error = { field, rule, message };
    errors[field].push(error);
    onError?.(error);
}
