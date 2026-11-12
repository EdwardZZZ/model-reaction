import {
    FieldSchema,
    ValidationError,
    Validator,
} from '../types';

/** Sequential first-error validation; the model owns error freshness and storage. */
export async function validateField(
    options: {
        schema: FieldSchema;
        value: unknown;
        field: string;
        timeout: number;
        data: Readonly<Record<string, any>>;
        isCurrent: () => boolean;
        onError: (error: ValidationError) => void;
    }
): Promise<boolean> {
    const {
        schema,
        value,
        field,
        timeout,
        data,
        isCurrent,
        onError,
    } = options;

    if (!schema.validator) return true;

    for (const validator of schema.validator) {
        if (!isCurrent()) return false;
        try {
            if (validator.condition && !validator.condition(data)) continue;
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            onError({
                field,
                rule: 'condition_error',
                message: `Validation condition failed: ${detail}`,
            });
            return false;
        }
        const ok = await runValidator(
            validator, value, field, timeout, data, onError
        );
        if (!ok || !isCurrent()) return false;
    }
    return true;
}

async function runValidator(
    validator: Validator,
    value: unknown,
    field: string,
    timeout: number,
    data: Record<string, any>,
    onError: (error: ValidationError) => void
): Promise<boolean> {
    if (!validator.validate) return true;

    try {
        const result = validator.validate(value, data);
        const ok = await (typeof result === 'boolean'
            ? result
            : raceTimeout(Promise.resolve(result), field, timeout));

        if (ok) return true;

        onError({
            field,
            rule: validator.type,
            message: validator.message,
        });
        return false;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onError({
            field,
            rule: 'validation_error',
            message: `Validation failed: ${msg}`,
        });
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
