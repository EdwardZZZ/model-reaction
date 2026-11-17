import type { FieldSchema } from '../types';

/** A transformed input ready to commit. */
export interface PreparedFieldWrite {
    field: string;
    value: unknown;
}

/**
 * Resolve every field before reading its value or running any transform.
 * An unknown key throws before any input is read or transformed.
 */
export function prepareFieldWrites<T extends Record<string, any>>(
    fields: Partial<T>,
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
            value: schema.transform ? schema.transform(input) : input,
        };
    });
}
