import type { FieldSchema } from '../types';

/** Internal options for the validation and commit pipeline. */
export interface CommitOptions {
    reactionStack?: string[];
    /** Collect fields whose committed values actually changed. */
    changedFields?: Set<string>;
    /** Shared candidate data used by all validators in a direct batch. */
    validationData?: Readonly<Record<string, any>>;
    initializeReactions?: boolean;
}

/** A field's transformed input and schema, ready for validation. */
export interface PreparedFieldWrite {
    field: string;
    schema: FieldSchema;
    value: unknown;
}

/**
 * Resolve every field before reading its value or running any transform.
 * This preserves batch preflight: an unknown key rejects the whole batch
 * before transform or validation starts.
 */
export function prepareFieldWrites(
    fields: Readonly<Record<string, unknown>>,
    resolveSchema: (field: string) => FieldSchema
): PreparedFieldWrite[] {
    const resolved = Object.keys(fields).map((field) => ({
        field,
        schema: resolveSchema(field),
    }));

    return resolved.map(({ field, schema }) => {
        const input = fields[field];
        return {
            field,
            schema,
            value: schema.transform ? schema.transform(input) : input,
        };
    });
}

/** Build the shallow, frozen candidate view shared by a validation batch. */
export function createValidationSnapshot(
    currentData: Readonly<Record<string, any>>,
    prepared: readonly PreparedFieldWrite[]
): Readonly<Record<string, any>> {
    return Object.freeze({
        ...currentData,
        ...Object.fromEntries(prepared.map(({ field, value }) => [field, value])),
    });
}
