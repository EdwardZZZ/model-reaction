import { Rule, ValidationRules } from '../rules';
import { createModel, Model } from '../index';

describe('Rule class', () => {
    test('constructor stores type, message, validate', async () => {
        const rule = new Rule('t', 'msg', () => true);
        expect(rule.type).toBe('t');
        expect(rule.message).toBe('msg');
        expect(await rule.validate('any')).toBe(true);
    });

    test('constructor accepts optional condition', () => {
        const rule = new Rule(
            'required',
            'required when active',
            (v) => v !== '',
            (data) => data.active === true
        );
        expect(rule.condition).toBeDefined();
        expect(rule.condition!({ active: true })).toBe(true);
        expect(rule.condition!({ active: false })).toBe(false);
    });

    test('withMessage returns a new rule with overridden message', () => {
        const original = ValidationRules.required;
        const custom = original.withMessage('Custom required');

        expect(custom).toBeInstanceOf(Rule);
        expect(custom.message).toBe('Custom required');
        expect(custom.type).toBe(original.type);
        // Original rule must NOT be mutated
        expect(original.message).toBe('This field is required');
    });

    test('withMessage preserves the validate function', async () => {
        const rule = ValidationRules.required.withMessage('needs value');
        expect(await rule.validate('')).toBe(false);
        expect(await rule.validate('ok')).toBe(true);
    });

    test('.when() returns a new conditional Rule preserving validate and message', async () => {
        const baseRule = ValidationRules.required.withMessage('needs value');
        const conditional = baseRule.when((data) => data.toggle === true);

        expect(conditional).toBeInstanceOf(Rule);
        expect(conditional.condition).toBeDefined();
        expect(conditional.message).toBe('needs value');
        expect(await conditional.validate('ok')).toBe(true);
        expect(await conditional.validate('')).toBe(false);
    });

    test('Rule.validate signature accepts cross-field data', async () => {
        let receivedData: any = null;
        const rule = new Rule('crossField', 'mismatch', (value, data) => {
            receivedData = data;
            return value === data?.expected;
        });

        interface S {
            expected: string;
            actual: string;
        }
        const schema: Model<S> = {
            expected: { type: 'string', default: 'hello' },
            actual: { type: 'string', default: 'hello', validator: [rule] },
        };
        const model = createModel<S>(schema);
        await model.setField('actual', 'hello');
        expect(receivedData).toBeDefined();
        expect(receivedData.expected).toBe('hello');

        const fail = await model.setField('actual', 'world');
        expect(fail).toBe(false);
        model.dispose();
    });

    test('condition returning false skips the validator at runtime', async () => {
        interface S {
            hasDiscount: boolean;
            code: string;
        }
        const schema: Model<S> = {
            hasDiscount: { type: 'boolean', default: false },
            code: {
                type: 'string',
                default: '',
                validator: [
                    {
                        type: 'required',
                        message: 'Code is required when discount enabled',
                        validate: (v) => v !== '',
                        condition: (data) => data.hasDiscount === true,
                    },
                ],
            },
        };
        const model = createModel<S>(schema);

        // hasDiscount=false -> condition returns false -> skip -> empty code is OK
        expect(await model.validateAll()).toBe(true);

        // turn on discount, empty code should now fail
        await model.setField('hasDiscount', true);
        expect(await model.validateAll()).toBe(false);
        model.dispose();
    });
});

describe('Built-in ValidationRules', () => {
    test('required rejects empty / null / undefined', async () => {
        expect(await ValidationRules.required.validate('')).toBe(false);
        expect(await ValidationRules.required.validate(null)).toBe(false);
        expect(await ValidationRules.required.validate(undefined)).toBe(false);
        expect(await ValidationRules.required.validate('value')).toBe(true);
        expect(await ValidationRules.required.validate(0)).toBe(true);
        expect(await ValidationRules.required.validate(false)).toBe(true);
    });

    test('number rejects NaN / non-number', async () => {
        expect(await ValidationRules.number.validate(1)).toBe(true);
        expect(await ValidationRules.number.validate(0)).toBe(true);
        expect(await ValidationRules.number.validate(NaN)).toBe(false);
        expect(await ValidationRules.number.validate('1' as any)).toBe(false);
        expect(await ValidationRules.number.validate(Infinity)).toBe(false);
    });

    test('integer accepts whole numbers, rejects floats', async () => {
        expect(await ValidationRules.integer.validate(3)).toBe(true);
        expect(await ValidationRules.integer.validate(0)).toBe(true);
        expect(await ValidationRules.integer.validate(3.5)).toBe(false);
    });

    test('boolean strictly checks typeof', async () => {
        expect(await ValidationRules.boolean.validate(true)).toBe(true);
        expect(await ValidationRules.boolean.validate(false)).toBe(true);
        expect(await ValidationRules.boolean.validate('true' as any)).toBe(false);
        expect(await ValidationRules.boolean.validate(1 as any)).toBe(false);
    });

    test('string strictly checks typeof', async () => {
        expect(await ValidationRules.string.validate('hi')).toBe(true);
        expect(await ValidationRules.string.validate('')).toBe(true);
        expect(await ValidationRules.string.validate(1 as any)).toBe(false);
    });

    test('min rejects strings/arrays/null/undefined/NaN even if JS coercion would pass', async () => {
        const rule = ValidationRules.min(3);
        expect(await rule.validate(5)).toBe(true);
        expect(await rule.validate(3)).toBe(true);
        expect(await rule.validate(2)).toBe(false);
        expect(await rule.validate('5' as any)).toBe(false);
        expect(await rule.validate([5] as any)).toBe(false);
        expect(await rule.validate(null as any)).toBe(false);
        expect(await rule.validate(undefined as any)).toBe(false);
        expect(await rule.validate(NaN as any)).toBe(false);
    });

    test('max likewise enforces numeric type guard', async () => {
        const max = ValidationRules.max(10);
        expect(await max.validate(10)).toBe(true);
        expect(await max.validate(11)).toBe(false);
        expect(await max.validate('5' as any)).toBe(false);
    });

    test('minLength accepts string and array, rejects others', async () => {
        const minLen = ValidationRules.minLength(2);
        expect(await minLen.validate('ab')).toBe(true);
        expect(await minLen.validate('a')).toBe(false);
        expect(await minLen.validate([1, 2])).toBe(true);
        expect(await minLen.validate(123 as any)).toBe(false);
    });

    test('maxLength accepts string and array, rejects others', async () => {
        const maxLen = ValidationRules.maxLength(2);
        expect(await maxLen.validate('ab')).toBe(true);
        expect(await maxLen.validate('abc')).toBe(false);
        expect(await maxLen.validate([1, 2, 3])).toBe(false);
    });

    test('pattern accepts custom message and validates regex', async () => {
        const pat = ValidationRules.pattern(/^\d+$/, 'digits only');
        expect(await pat.validate('123')).toBe(true);
        expect(await pat.validate('12a')).toBe(false);
        expect(pat.message).toBe('digits only');
    });

    test('pattern uses default message when omitted', () => {
        const pat = ValidationRules.pattern(/^x/);
        expect(pat.message).toBe('Invalid format');
    });

    test('email validates RFC-style addresses', async () => {
        expect(await ValidationRules.email.validate('a@b.com')).toBe(true);
        expect(await ValidationRules.email.validate('user.name+tag@sub.example.io')).toBe(
            true
        );
        expect(await ValidationRules.email.validate('bad')).toBe(false);
        expect(await ValidationRules.email.validate(123 as any)).toBe(false);
    });
});

describe('Custom validation messages (withMessage end-to-end)', () => {
    interface User {
        name: string;
        age: number;
        email: string;
        customRule: string;
    }

    const testSchema: Model<User> = {
        name: {
            type: 'string',
            validator: [ValidationRules.required.withMessage('Name cannot be empty')],
            default: '',
        },
        age: {
            type: 'number',
            validator: [
                ValidationRules.required.withMessage('Age must be filled'),
                ValidationRules.number.withMessage('Age must be a number'),
                ValidationRules.min(18).withMessage('Age must be at least 18'),
            ],
            default: 18,
        },
        email: {
            type: 'string',
            validator: [
                ValidationRules.required,
                ValidationRules.email.withMessage('Please enter a valid email address'),
            ],
            default: '',
        },
        customRule: {
            type: 'string',
            validator: [
                new Rule('customPattern', 'Default error message', (value: string) => {
                    return value.startsWith('custom_');
                }).withMessage('Value must start with custom_'),
            ],
            default: '',
        },
    };

    let model: ReturnType<typeof createModel<User>>;

    beforeEach(() => {
        model = createModel<User>(testSchema);
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        model.dispose();
    });

    test('uses custom required message', async () => {
        await model.setField('name', '');
        expect(model.getValidationSummary()).toContain('name: Name cannot be empty');
    });

    test('uses custom number message', async () => {
        // @ts-expect-error - runtime type check
        await model.setField('age', 'not-a-number');
        expect(model.getValidationSummary()).toContain('age: Age must be a number');
    });

    test('uses custom min message', async () => {
        await model.setField('age', 16);
        expect(model.getValidationSummary()).toContain('age: Age must be at least 18');
    });

    test('uses custom email message', async () => {
        await model.setField('email', 'invalid-email');
        expect(model.getValidationSummary()).toContain(
            'email: Please enter a valid email address'
        );
    });

    test('uses custom rule message', async () => {
        await model.setField('customRule', 'wrong_value');
        expect(model.getValidationSummary()).toContain(
            'customRule: Value must start with custom_'
        );
    });

    test('falls back to default message when no custom message is set', async () => {
        await model.setField('email', '');
        expect(model.getValidationSummary()).toContain('email: This field is required');
    });
});
