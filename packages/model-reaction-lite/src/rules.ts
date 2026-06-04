/**
 * Synchronous-only validation rules.
 *
 * `Rule` is a thin convenience class with no fluent helpers — pass plain
 * `{ type, message, validate }` objects directly if you don't want it.
 */

const isFiniteNumber = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);

const isString = (v: unknown): v is string => typeof v === 'string';

export class Rule {
    type: string;
    message: string;
    validate: (value: any, data?: Record<string, any>) => boolean;

    constructor(
        type: string,
        message: string,
        validate: (value: any, data?: Record<string, any>) => boolean
    ) {
        this.type = type;
        this.message = message;
        this.validate = validate;
    }
}

export const ValidationRules = {
    required: new Rule(
        'required',
        'This field is required',
        (v) => v !== undefined && v !== null && v !== ''
    ),
    number: new Rule('number', 'Must be a number', (v) => isFiniteNumber(v)),
    integer: new Rule(
        'integer',
        'Must be an integer',
        (v) => isFiniteNumber(v) && Number.isInteger(v)
    ),
    boolean: new Rule(
        'boolean',
        'Must be a boolean',
        (v) => typeof v === 'boolean'
    ),
    string: new Rule('string', 'Must be a string', (v) => isString(v)),
    min: (min: number) =>
        new Rule(
            'min',
            `Value must be greater than or equal to ${min}`,
            (v) => isFiniteNumber(v) && v >= min
        ),
    max: (max: number) =>
        new Rule(
            'max',
            `Value must be less than or equal to ${max}`,
            (v) => isFiniteNumber(v) && v <= max
        ),
    minLength: (min: number) =>
        new Rule(
            'minLength',
            `Length must be greater than or equal to ${min}`,
            (v) => (isString(v) || Array.isArray(v)) && v.length >= min
        ),
    maxLength: (max: number) =>
        new Rule(
            'maxLength',
            `Length must be less than or equal to ${max}`,
            (v) => (isString(v) || Array.isArray(v)) && v.length <= max
        ),
    pattern: (regex: RegExp, message = 'Invalid format') =>
        new Rule('pattern', message, (v) => isString(v) && regex.test(v)),
    email: new Rule(
        'email',
        'Invalid email format',
        (v) =>
            isString(v) &&
            /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v)
    ),
};
