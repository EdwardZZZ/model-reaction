import {
    FieldSchema,
    ValidationError,
    Validator,
} from '../types';

/**
 * Run all validators of a single field.
 *
 * Supports both sync and async validators, optional cross-field `data`,
 * `condition` predicates, `failFast` short-circuit, and a per-request
 * `isCurrent()` race-guard. Reports errors to the caller without owning or
 * mutating the model's error store.
 */
export async function validateField(
    options: {
        schema: FieldSchema;
        value: unknown;
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
        field,
        timeout = 5000,
        failFast = false,
        data,
        isCurrent,
        onError,
    } = options;

    if (!schema.validator) return true;

    const ctxData = data ?? {};
    const applicable: Validator[] = [];
    let conditionFailed = false;
    for (const validator of schema.validator) {
        try {
            if (!validator.condition || validator.condition(ctxData)) {
                applicable.push(validator);
            }
        } catch (err) {
            conditionFailed = true;
            if (!isCurrent || isCurrent()) {
                const detail = err instanceof Error ? err.message : String(err);
                reportValidationError(
                    field,
                    'condition_error',
                    `Validation condition failed: ${detail}`,
                    onError
                );
            }
            if (failFast) return false;
        }
    }

    let isValid = true;

    if (failFast) {
        for (const validator of applicable) {
            const ok = await runValidator(
                validator,
                value,
                field,
                timeout,
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
                    ctxData,
                    isCurrent,
                    onError
                )
            )
        );
        isValid = results.every(Boolean);
    }

    return isValid && !conditionFailed;
}

async function runValidator(
    validator: Validator,
    value: unknown,
    field: string,
    timeout: number,
    data: Record<string, any>,
    isCurrent?: () => boolean,
    onError?: (error: ValidationError) => void
): Promise<boolean> {
    if (!validator.validate) return true;

    try {
        const result = validator.validate(value, data);
        const ok = await raceTimeout(Promise.resolve(result), field, timeout);

        if (ok) return true;

        if (isCurrent && !isCurrent()) return false;
        reportValidationError(
            field,
            validator.type,
            validator.message,
            onError
        );
        return false;
    } catch (err) {
        if (isCurrent && !isCurrent()) return false;
        const msg = err instanceof Error ? err.message : String(err);
        reportValidationError(
            field,
            'validation_error',
            `Validation failed: ${msg}`,
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

function reportValidationError(
    field: string,
    rule: string,
    message: string,
    onError?: (error: ValidationError) => void
): void {
    onError?.({ field, rule, message });
}
