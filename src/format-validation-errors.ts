import { ValidationError } from './types';

export type ValidationErrorFormatter = (error: ValidationError) => string;

const defaultFormatter: ValidationErrorFormatter = (error) =>
    `${error.field}: ${error.message}`;

export function formatValidationErrors(
    errors: Record<string, ValidationError[]>,
    formatter: ValidationErrorFormatter = defaultFormatter
): string {
    const allErrors = Object.values(errors).flat();
    if (allErrors.length === 0) return 'Validation passed';
    return allErrors.map(formatter).join('; ');
}
