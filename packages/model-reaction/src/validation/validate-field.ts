import {
    FieldSchema,
    ValidationError,
    Validator,
} from '../types';

/** Sequential first-error validation; the model owns error freshness and storage. */
export async function validateField(
    options: {
        schema: FieldSchema<FieldSchema['type'], any>;
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

    const fail = (rule: string, message: string): false => {
        onError({ field, rule, message });
        return false;
    };

    const runValidator = async (validator: Validator): Promise<boolean> => {
        if (!validator.validate) return true;
        try {
            const result = validator.validate(value, data);
            const ok = await (typeof result === 'boolean'
                ? result
                : raceTimeout(Promise.resolve(result), field, timeout));
            return ok ? true : fail(validator.type, validator.message);
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            return fail('validation_error', `Validation failed: ${detail}`);
        }
    };

    for (const validator of schema.validator) {
        if (!isCurrent()) return false;
        try {
            if (validator.condition && !validator.condition(data)) continue;
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            return fail('condition_error', `Validation condition failed: ${detail}`);
        }
        if (!(await runValidator(validator)) || !isCurrent()) return false;
    }
    return true;
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
