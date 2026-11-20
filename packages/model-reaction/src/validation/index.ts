/** Optional validation helpers, independent of the core model implementation. */
import type { ValidationError, ValidationErrors } from '../types';

export { ValidationRules, Rule } from './rules';

export type ValidationErrorFormatter = (error: ValidationError) => string;

const defaultFormatter: ValidationErrorFormatter = (error) =>
    `${error.field}: ${error.message}`;

export function formatValidationErrors(
    errors: ValidationErrors,
    formatter: ValidationErrorFormatter = defaultFormatter
): string {
    const allErrors = Object.values(errors).flat();
    if (allErrors.length === 0) return 'Validation passed';
    return allErrors.map(formatter).join('; ');
}
