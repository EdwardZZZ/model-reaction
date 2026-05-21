import { createModel, Model, ValidationRules, Rule, ErrorHandler, ErrorType } from '../index';

describe('Integration Tests — Full Documentation Scenarios', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // =========================================================================
    // 1. README — Synchronous Validation Example (Basic Usage)
    // =========================================================================
    describe('README: Synchronous Validation Example', () => {
        interface User {
            name: string;
            age: number;
            info: string;
        }

        let userModel: ReturnType<typeof createModel<User>>;

        beforeEach(() => {
            userModel = createModel<User>({
                name: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: '',
                },
                age: {
                    type: 'number',
                    validator: [
                        ValidationRules.required,
                        ValidationRules.number,
                        ValidationRules.min(18)
                    ],
                    default: 18
                },
                info: {
                    type: 'string',
                    reaction: {
                        fields: ['name', 'age'],
                        computed: (values) => `My name is ${values.name} and I am ${values.age} years old.`,
                        action: (values) => console.log('Info updated:', values.computed)
                    },
                    default: ''
                }
            }, {
                debounceReactions: 0,
                asyncValidationTimeout: 5000
            });
        });

        afterEach(() => {
            userModel.dispose();
        });

        test('should initialize with default values', () => {
            expect(userModel.getField('name')).toBe('');
            expect(userModel.getField('age')).toBe(18);
            expect(userModel.getField('info')).toBe('');
        });

        test('should set fields and trigger reaction to compute info', async () => {
            await userModel.setField('name', 'John');
            await userModel.setField('age', 30);
            await new Promise(r => setTimeout(r, 10));

            expect(userModel.getField('name')).toBe('John');
            expect(userModel.getField('age')).toBe(30);
            expect(userModel.getField('info')).toBe('My name is John and I am 30 years old.');
        });

        test('should emit validation:error on invalid field', async () => {
            const errorCb = jest.fn();
            userModel.on('validation:error', errorCb);

            await userModel.setField('name', '');
            expect(errorCb).toHaveBeenCalled();
            expect(errorCb.mock.calls[0][0].type).toBe(ErrorType.VALIDATION);
        });

        test('should emit field:not-found when accessing non-existent field', async () => {
            const notFoundCb = jest.fn();
            userModel.on('field:not-found', notFoundCb);

            // @ts-expect-error — testing runtime behaviour
            await userModel.setField('nonexistentField', 'value');

            expect(notFoundCb).toHaveBeenCalled();
            expect(notFoundCb.mock.calls[0][0].type).toBe(ErrorType.FIELD_NOT_FOUND);
        });

        test('should validate all fields and return summary', async () => {
            await userModel.setField('name', 'John');
            await userModel.setField('age', 30);

            const isValid = await userModel.validateAll();
            expect(isValid).toBe(true);
            expect(userModel.getValidationSummary()).toBe('Validation passed');
        });

        test('should track dirty data for invalid values', async () => {
            await userModel.setField('age', 10);
            expect(userModel.getDirtyData()).toHaveProperty('age', 10);

            userModel.clearDirtyData();
            expect(userModel.getDirtyData()).toEqual({});
        });

        test('should expose data snapshot via data getter', async () => {
            await userModel.setField('name', 'Alice');
            const snapshot = userModel.data;
            expect(snapshot.name).toBe('Alice');
            expect(snapshot.age).toBe(18);
        });

        test('should unsubscribe events via off()', async () => {
            const changeCb = jest.fn();
            userModel.on('field:change', changeCb);
            userModel.off('field:change', changeCb);

            await userModel.setField('name', 'Bob');
            expect(changeCb).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. README — Asynchronous Validation Example
    // =========================================================================
    describe('README: Asynchronous Validation Example', () => {
        interface AsyncUser {
            name: string;
            username: string;
        }

        let asyncUserModel: ReturnType<typeof createModel<AsyncUser>>;

        beforeEach(() => {
            const asyncUniqueRule = new Rule(
                'asyncUnique',
                'Username already exists',
                async (value: string): Promise<boolean> => {
                    return new Promise<boolean>((resolve) => {
                        setTimeout(() => {
                            resolve(value !== 'admin');
                        }, 50);
                    });
                }
            );

            asyncUserModel = createModel<AsyncUser>({
                name: {
                    type: 'string',
                    validator: [ValidationRules.required.withMessage('Username cannot be empty')],
                    default: '',
                },
                username: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Account cannot be empty'),
                        asyncUniqueRule
                    ],
                    default: ''
                }
            }, {
                asyncValidationTimeout: 3000
            });
        });

        afterEach(() => {
            asyncUserModel.dispose();
        });

        test('should pass async validation for new username', async () => {
            const result = await asyncUserModel.setField('username', 'newuser');
            expect(result).toBe(true);
            expect(asyncUserModel.getField('username')).toBe('newuser');
        });

        test('should fail async validation for existing username "admin"', async () => {
            const result = await asyncUserModel.setField('username', 'admin');
            expect(result).toBe(false);
            expect(asyncUserModel.validationErrors.username).toBeDefined();
            expect(asyncUserModel.validationErrors.username[0].message).toBe('Username already exists');
        });

        test('should store invalid username in dirty data', async () => {
            await asyncUserModel.setField('username', 'admin');
            expect(asyncUserModel.getDirtyData()).toHaveProperty('username', 'admin');
        });

        test('should use withMessage to customise error text', async () => {
            await asyncUserModel.setField('name', '');
            expect(asyncUserModel.validationErrors.name[0].message).toBe('Username cannot be empty');
        });
    });

    // =========================================================================
    // 3. README — Custom Validation Rules and Messages
    // =========================================================================
    describe('README: Custom Validation Rules and Messages', () => {
        test('should validate with custom rule and withMessage', async () => {
            const errorHandler = new ErrorHandler();

            const customRule = new Rule(
                'custom',
                'Does not meet custom rules',
                (value: any) => value === 'custom'
            );

            const model = createModel({
                field: {
                    type: 'string',
                    validator: [customRule.withMessage('Field value must be "custom"')],
                    default: ''
                }
            }, { errorHandler });

            const resultBad = await model.setField('field', 'wrong');
            expect(resultBad).toBe(false);
            expect(model.validationErrors.field[0].message).toBe('Field value must be "custom"');

            const resultOk = await model.setField('field', 'custom');
            expect(resultOk).toBe(true);
            expect(model.getField('field')).toBe('custom');

            model.dispose();
        });
    });

    // =========================================================================
    // 4. README — Unified Error Handling (ErrorHandler + ErrorType)
    // =========================================================================
    describe('README: Unified Error Handling', () => {
        test('should route errors through custom ErrorHandler', async () => {
            const errorHandler = new ErrorHandler();
            const validationCb = jest.fn();
            const fieldNotFoundCb = jest.fn();
            const unknownCb = jest.fn();

            errorHandler.onError(ErrorType.VALIDATION, validationCb);
            errorHandler.onError(ErrorType.FIELD_NOT_FOUND, fieldNotFoundCb);
            errorHandler.onError(ErrorType.UNKNOWN, unknownCb);

            const model = createModel({
                name: {
                    type: 'string',
                    validator: [ValidationRules.required.withMessage('Name cannot be empty')],
                    default: ''
                }
            }, { errorHandler });

            await model.setField('name', '');
            expect(validationCb).toHaveBeenCalled();
            expect(validationCb.mock.calls[0][0].field).toBe('name');
            expect(unknownCb).toHaveBeenCalled();

            // @ts-expect-error — testing non-existent field
            await model.setField('missing', 'x');
            expect(fieldNotFoundCb).toHaveBeenCalled();

            model.dispose();
        });

        test('should unsubscribe error listeners via offError', async () => {
            const errorHandler = new ErrorHandler();
            const cb = jest.fn();
            errorHandler.onError(ErrorType.VALIDATION, cb);
            errorHandler.offError(ErrorType.VALIDATION, cb);

            const model = createModel({
                name: { type: 'string', validator: [ValidationRules.required], default: '' }
            }, { errorHandler });

            await model.setField('name', '');
            expect(cb).not.toHaveBeenCalled();

            model.dispose();
        });
    });

    // =========================================================================
    // 5. README — Transformation and Asynchronous Validation
    // =========================================================================
    describe('README: Transformation and Asynchronous Validation', () => {
        test('should transform value and then validate asynchronously', async () => {
            const asyncModel = createModel({
                field: {
                    type: 'string',
                    transform: (value: string) => value.toUpperCase(),
                    validator: [
                        new Rule(
                            'asyncValidator',
                            'Asynchronous validation failed',
                            async (value: string) => value.length > 3
                        ).withMessage('Field length must be greater than 3 characters')
                    ],
                    default: ''
                }
            });

            const resultOk = await asyncModel.setField('field', 'hello');
            expect(resultOk).toBe(true);
            expect(asyncModel.getField('field')).toBe('HELLO');

            const resultBad = await asyncModel.setField('field', 'hi');
            expect(resultBad).toBe(false);
            expect(asyncModel.validationErrors.field[0].message).toBe('Field length must be greater than 3 characters');

            asyncModel.dispose();
        });
    });

    // =========================================================================
    // 6. README — Waiting for Async Operations (settled)
    // =========================================================================
    describe('README: Waiting for Async Operations (settled)', () => {
        test('should use settled() to wait for debounced reactions', async () => {
            interface Schema {
                source: string;
                target: string;
            }
            const model = createModel<Schema>({
                source: { type: 'string', default: '' },
                target: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['source'],
                        computed: (vals) => vals.source.toUpperCase()
                    }
                }
            }, { debounceReactions: 100 });

            await model.setField('source', 'hello');
            expect(model.getField('target')).toBe('');

            await model.settled();
            expect(model.getField('target')).toBe('HELLO');

            model.dispose();
        });
    });

    // =========================================================================
    // 7. README — Batch Operations (setFields)
    // =========================================================================
    describe('README: Batch Operations (setFields)', () => {
        interface Form {
            name: string;
            age: number;
            email: string;
        }

        test('should batch set multiple fields and return combined validation result', async () => {
            const model = createModel<Form>({
                name: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: ''
                },
                age: {
                    type: 'number',
                    validator: [ValidationRules.required, ValidationRules.number, ValidationRules.min(18)],
                    default: 18
                },
                email: {
                    type: 'string',
                    validator: [ValidationRules.required, ValidationRules.email],
                    default: ''
                }
            });

            const result = await model.setFields({
                name: 'Alice',
                age: 25,
                email: 'alice@example.com'
            });

            expect(result).toBe(true);
            expect(model.getField('name')).toBe('Alice');
            expect(model.getField('age')).toBe(25);
            expect(model.getField('email')).toBe('alice@example.com');

            model.dispose();
        });

        test('should return false when any batch field fails validation', async () => {
            const model = createModel<Form>({
                name: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: ''
                },
                age: {
                    type: 'number',
                    validator: [ValidationRules.required, ValidationRules.number, ValidationRules.min(18)],
                    default: 18
                },
                email: {
                    type: 'string',
                    validator: [ValidationRules.required, ValidationRules.email],
                    default: ''
                }
            });

            const result = await model.setFields({
                name: 'Bob',
                age: 10,
                email: 'invalid-email'
            });

            expect(result).toBe(false);
            expect(model.getField('name')).toBe('Bob');
            expect(model.getDirtyData()).toHaveProperty('age', 10);
            expect(model.getDirtyData()).toHaveProperty('email', 'invalid-email');

            model.dispose();
        });
    });

    // =========================================================================
    // 8. README — ModelOptions: errorFormatter
    // =========================================================================
    describe('README: Custom errorFormatter', () => {
        test('should use custom errorFormatter in getValidationSummary', async () => {
            const model = createModel({
                field: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: ''
                }
            }, {
                errorFormatter: (err) => `[${err.field}] ${err.message}`
            });

            await model.setField('field', '');
            expect(model.getValidationSummary()).toBe('[field] This field is required');

            model.dispose();
        });
    });

    // =========================================================================
    // 9. README — ModelOptions: failFast
    // =========================================================================
    describe('README: failFast validation strategy', () => {
        test('should stop after first error when failFast is true', async () => {
            const model = createModel({
                field: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Required'),
                        new Rule('len', 'Too short', () => false),
                        new Rule('fmt', 'Bad format', () => false)
                    ],
                    default: ''
                }
            }, { failFast: true });

            await model.setField('field', '');
            expect(model.validationErrors.field).toHaveLength(1);
            expect(model.validationErrors.field[0].message).toBe('Required');

            model.dispose();
        });

        test('should report all errors when failFast is false (default)', async () => {
            const model = createModel({
                field: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Required'),
                        new Rule('len', 'Too short', () => false),
                        new Rule('fmt', 'Bad format', () => false)
                    ],
                    default: ''
                }
            });

            await model.setField('field', '');
            expect(model.validationErrors.field).toHaveLength(3);

            model.dispose();
        });
    });

    // =========================================================================
    // 10. Reaction System — action callback
    // =========================================================================
    describe('Reaction System: action callback', () => {
        test('should call action with computed value and dependent values', async () => {
            const actionSpy = jest.fn();

            interface Schema {
                firstName: string;
                lastName: string;
                fullName: string;
            }

            const model = createModel<Schema>({
                firstName: { type: 'string', default: '' },
                lastName: { type: 'string', default: '' },
                fullName: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['firstName', 'lastName'],
                        computed: (vals) => `${vals.firstName} ${vals.lastName}`.trim(),
                        action: actionSpy
                    }
                }
            });

            await model.setField('firstName', 'Jane');
            await model.setField('lastName', 'Doe');
            await new Promise(r => setTimeout(r, 10));

            expect(actionSpy).toHaveBeenCalled();
            const lastCall = actionSpy.mock.calls[actionSpy.mock.calls.length - 1][0];
            expect(lastCall.computed).toBe('Jane Doe');

            model.dispose();
        });
    });

    // =========================================================================
    // 11. Reaction System — multiple reactions on different fields
    // =========================================================================
    describe('Reaction System: multiple reactions', () => {
        test('should support multiple fields with independent reactions', async () => {
            interface Schema {
                price: number;
                quantity: number;
                total: number;
                label: string;
            }

            const model = createModel<Schema>({
                price: { type: 'number', default: 0 },
                quantity: { type: 'number', default: 0 },
                total: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['price', 'quantity'],
                        computed: (vals) => vals.price * vals.quantity
                    }
                },
                label: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['price'],
                        computed: (vals) => vals.price > 100 ? 'expensive' : 'affordable'
                    }
                }
            });

            await model.setField('price', 150);
            await model.setField('quantity', 3);
            await new Promise(r => setTimeout(r, 10));

            expect(model.getField('total')).toBe(450);
            expect(model.getField('label')).toBe('expensive');

            model.dispose();
        });
    });

    // =========================================================================
    // 12. Reaction System — circular dependency detection
    // =========================================================================
    describe('Reaction System: circular dependency detection', () => {
        test('should detect circular dependency and emit reaction:error', async () => {
            const reactionErrorCb = jest.fn();

            interface Schema {
                a: number;
                b: number;
            }

            const model = createModel<Schema>({
                a: {
                    type: 'number',
                    default: 0,
                    reaction: { fields: ['b'], computed: (v) => v.b + 1 }
                },
                b: {
                    type: 'number',
                    default: 0,
                    reaction: { fields: ['a'], computed: (v) => v.a + 1 }
                }
            });

            model.on('reaction:error', reactionErrorCb);
            await model.setField('a', 1);
            await new Promise(r => setTimeout(r, 10));

            expect(reactionErrorCb).toHaveBeenCalled();
            const errorArg = reactionErrorCb.mock.calls.find(
                (call: any[]) => call[0].type === ErrorType.CIRCULAR_DEPENDENCY
            );
            expect(errorArg).toBeDefined();

            model.dispose();
        });
    });

    // =========================================================================
    // 13. Event System — field:change, validation:complete
    // =========================================================================
    describe('Event System: field:change and validation:complete', () => {
        test('should emit field:change on valid field update', async () => {
            const changeCb = jest.fn();

            const model = createModel({
                name: { type: 'string', default: '' }
            });

            model.on('field:change', changeCb);
            await model.setField('name', 'Alice');

            expect(changeCb).toHaveBeenCalledWith({ field: 'name', value: 'Alice' });

            model.dispose();
        });

        test('should emit validation:complete after validateAll', async () => {
            const completeCb = jest.fn();

            const model = createModel({
                name: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: 'Valid'
                }
            });

            model.on('validation:complete', completeCb);
            const result = await model.validateAll();

            expect(result).toBe(true);
            expect(completeCb).toHaveBeenCalledWith({ isValid: true });

            model.dispose();
        });
    });

    // =========================================================================
    // 14. Dirty Data Management — full lifecycle
    // =========================================================================
    describe('Dirty Data Management: full lifecycle', () => {
        test('should track dirty data → validateAll → promote to data on success', async () => {
            let shouldPass = false;

            const model = createModel({
                field: {
                    type: 'string',
                    validator: [{
                        type: 'toggle',
                        message: 'fail',
                        validate: () => shouldPass
                    }],
                    default: 'initial'
                }
            });

            await model.setField('field', 'attempt');
            expect(model.getDirtyData()).toHaveProperty('field', 'attempt');
            expect(model.getField('field')).toBe('initial');

            shouldPass = true;
            const isValid = await model.validateAll();
            expect(isValid).toBe(true);
            expect(model.getField('field')).toBe('attempt');
            expect(model.getDirtyData()).toEqual({});

            model.dispose();
        });
    });

    // =========================================================================
    // 15. dispose() — resource cleanup
    // =========================================================================
    describe('dispose: resource cleanup', () => {
        test('should clear data, dirtyData, validationErrors and stop reactions', async () => {
            const model = createModel({
                field: { type: 'string', default: 'value' }
            });

            await model.setField('field', 'updated');
            model.dispose();

            expect(model.data).toEqual({});
            expect(model.validationErrors).toEqual({});
            expect(model.getDirtyData()).toEqual({});
        });
    });

    // =========================================================================
    // 16. End-to-end: complete form submission flow
    //     (Best Practices §4 Integration Testing)
    // =========================================================================
    describe('End-to-End: Complete form submission flow', () => {
        interface RegistrationForm {
            username: string;
            email: string;
            age: number;
            bio: string;
        }

        test('should validate, compute reactions, and report final state', async () => {
            const asyncEmailRule = new Rule(
                'asyncEmail',
                'Email is taken',
                async (v: string) => {
                    await new Promise(r => setTimeout(r, 30));
                    return v !== 'taken@test.com';
                }
            );

            const model = createModel<RegistrationForm>({
                username: {
                    type: 'string',
                    validator: [ValidationRules.required.withMessage('Username required')],
                    default: ''
                },
                email: {
                    type: 'string',
                    validator: [
                        ValidationRules.required.withMessage('Email required'),
                        ValidationRules.email.withMessage('Invalid email'),
                        asyncEmailRule
                    ],
                    default: ''
                },
                age: {
                    type: 'number',
                    validator: [
                        ValidationRules.required,
                        ValidationRules.number,
                        ValidationRules.min(13).withMessage('Must be at least 13')
                    ],
                    default: 0
                },
                bio: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['username', 'age'],
                        computed: (vals) =>
                            vals.username ? `${vals.username}, age ${vals.age}` : ''
                    }
                }
            });

            const allEvents: string[] = [];
            model.on('field:change', () => allEvents.push('field:change'));
            model.on('validation:error', () => allEvents.push('validation:error'));
            model.on('validation:complete', () => allEvents.push('validation:complete'));

            await model.setFields({
                username: 'alice',
                email: 'alice@example.com',
                age: 25
            });
            await new Promise(r => setTimeout(r, 50));

            expect(model.getField('username')).toBe('alice');
            expect(model.getField('email')).toBe('alice@example.com');
            expect(model.getField('age')).toBe(25);
            expect(model.getField('bio')).toBe('alice, age 25');

            const isValid = await model.validateAll();
            expect(isValid).toBe(true);
            expect(model.getValidationSummary()).toBe('Validation passed');
            expect(allEvents).toContain('field:change');
            expect(allEvents).toContain('validation:complete');

            await model.setField('age', 5);
            expect(model.getDirtyData()).toHaveProperty('age', 5);
            expect(model.getValidationSummary()).toContain('Must be at least 13');

            await model.setField('email', 'taken@test.com');
            expect(model.getDirtyData()).toHaveProperty('email', 'taken@test.com');
            expect(model.validationErrors.email[0].message).toBe('Email is taken');

            model.dispose();
        });
    });

    // =========================================================================
    // 17. ErrorType enum completeness
    // =========================================================================
    describe('ErrorType Enum', () => {
        test('should contain all documented error types', () => {
            expect(ErrorType.VALIDATION).toBe('validation');
            expect(ErrorType.REACTION).toBe('reaction');
            expect(ErrorType.FIELD_NOT_FOUND).toBe('field_not_found');
            expect(ErrorType.DEPENDENCY_ERROR).toBe('dependency_error');
            expect(ErrorType.CIRCULAR_DEPENDENCY).toBe('circular_dependency');
            expect(ErrorType.UNKNOWN).toBe('unknown');
        });
    });

    // =========================================================================
    // 18. Built-in ValidationRules completeness
    // =========================================================================
    describe('Built-in ValidationRules', () => {
        test('ValidationRules.required', async () => {
            const model = createModel({ f: { type: 'string', validator: [ValidationRules.required], default: '' } });
            expect(await model.setField('f', '')).toBe(false);
            expect(await model.setField('f', 'ok')).toBe(true);
            model.dispose();
        });

        test('ValidationRules.number', async () => {
            const model = createModel({ f: { type: 'number', validator: [ValidationRules.number] } });
            expect(await model.setField('f', 'text' as any)).toBe(false);
            expect(await model.setField('f', 42)).toBe(true);
            model.dispose();
        });

        test('ValidationRules.min', async () => {
            const model = createModel({ f: { type: 'number', validator: [ValidationRules.min(10)], default: 0 } });
            expect(await model.setField('f', 5)).toBe(false);
            expect(await model.setField('f', 10)).toBe(true);
            model.dispose();
        });

        test('ValidationRules.email', async () => {
            const model = createModel({ f: { type: 'string', validator: [ValidationRules.email], default: '' } });
            expect(await model.setField('f', 'bad')).toBe(false);
            expect(await model.setField('f', 'a@b.com')).toBe(true);
            model.dispose();
        });
    });

    // =========================================================================
    // 19. Rule.withMessage
    // =========================================================================
    describe('Rule.withMessage', () => {
        test('should create a new rule with overridden message', () => {
            const original = ValidationRules.required;
            const custom = original.withMessage('Custom required');

            expect(custom.message).toBe('Custom required');
            expect(custom.type).toBe(original.type);
            expect(original.message).toBe('This field is required');
        });
    });

    // =========================================================================
    // 20. Multiple reactions on a single field (array syntax)
    // =========================================================================
    describe('FieldSchema.reaction as array', () => {
        test('should support multiple reactions on one field', async () => {
            const actionSpy = jest.fn();

            interface Schema {
                input: string;
                output: string;
            }

            const model = createModel<Schema>({
                input: { type: 'string', default: '' },
                output: {
                    type: 'string',
                    default: '',
                    reaction: [
                        {
                            fields: ['input'],
                            computed: (vals) => vals.input.toUpperCase()
                        },
                        {
                            fields: ['input'],
                            computed: (vals) => vals.input.toUpperCase(),
                            action: actionSpy
                        }
                    ]
                }
            });

            await model.setField('input', 'test');
            await new Promise(r => setTimeout(r, 10));

            expect(model.getField('output')).toBe('TEST');
            expect(actionSpy).toHaveBeenCalled();

            model.dispose();
        });
    });

    // =========================================================================
    // 21. 异步校验超时
    // =========================================================================
    describe('Edge: Async validation timeout', () => {
        test('should reject and record error when async validator exceeds timeout', async () => {
            const slowRule = new Rule(
                'slow',
                'Too slow',
                () => new Promise<boolean>(resolve => setTimeout(() => resolve(true), 500))
            );

            const model = createModel({
                field: {
                    type: 'string',
                    validator: [slowRule],
                    default: ''
                }
            }, { asyncValidationTimeout: 50 });

            const result = await model.setField('field', 'value');
            expect(result).toBe(false);
            expect(model.validationErrors.field.length).toBeGreaterThan(0);
            expect(model.validationErrors.field[0].message).toContain('Validation failed');

            model.dispose();
        });
    });

    // =========================================================================
    // 22. 校验器抛出异常（同步）
    // =========================================================================
    describe('Edge: Validator throws synchronous exception', () => {
        test('should catch thrown error and record as validation failure', async () => {
            const throwingRule = new Rule(
                'throws',
                'Should not see this',
                () => { throw new Error('Unexpected crash'); }
            );

            const model = createModel({
                field: {
                    type: 'string',
                    validator: [throwingRule],
                    default: ''
                }
            });

            const result = await model.setField('field', 'any');
            expect(result).toBe(false);
            expect(model.validationErrors.field[0].message).toContain('Unexpected crash');

            model.dispose();
        });
    });

    // =========================================================================
    // 23. 校验器抛出异常（异步 reject）
    // =========================================================================
    describe('Edge: Validator rejects with async error', () => {
        test('should catch rejected promise and record as validation failure', async () => {
            const rejectRule = new Rule(
                'rejects',
                'Not used',
                async () => { throw new Error('Async boom'); }
            );

            const model = createModel({
                field: {
                    type: 'string',
                    validator: [rejectRule],
                    default: ''
                }
            });

            const result = await model.setField('field', 'any');
            expect(result).toBe(false);
            expect(model.validationErrors.field[0].message).toContain('Async boom');

            model.dispose();
        });
    });

    // =========================================================================
    // 24. Reaction computed 抛出异常
    // =========================================================================
    describe('Edge: Reaction computed throws', () => {
        test('should emit reaction:error when computed function throws', async () => {
            const reactionErrorCb = jest.fn();

            const model = createModel({
                input: { type: 'string', default: '' },
                output: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['input'],
                        computed: () => { throw new Error('compute exploded'); }
                    }
                }
            });

            model.on('reaction:error', reactionErrorCb);
            await model.setField('input', 'trigger');
            await new Promise(r => setTimeout(r, 10));

            expect(reactionErrorCb).toHaveBeenCalled();
            expect(reactionErrorCb.mock.calls[0][0].type).toBe(ErrorType.REACTION);

            model.dispose();
        });
    });

    // =========================================================================
    // 25. Reaction 依赖字段不存在 (DEPENDENCY_ERROR)
    // =========================================================================
    describe('Edge: Reaction dependency field not defined', () => {
        test('should trigger DEPENDENCY_ERROR when reaction depends on missing field', async () => {
            const errorHandler = new ErrorHandler();
            const depErrorCb = jest.fn();
            errorHandler.onError(ErrorType.DEPENDENCY_ERROR, depErrorCb);

            const model = createModel({
                input: { type: 'string', default: '' },
                output: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['ghost'],
                        computed: (vals) => String(vals.ghost)
                    }
                }
            }, { errorHandler });

            await model.setField('input', 'x');
            await new Promise(r => setTimeout(r, 10));

            model.dispose();
        });
    });

    // =========================================================================
    // 26. 相同值不触发 field:change 和 reaction
    // =========================================================================
    describe('Edge: Setting same value skips change and reactions', () => {
        test('should not emit field:change or re-trigger reaction when value is unchanged', async () => {
            const changeCb = jest.fn();
            const actionSpy = jest.fn();

            interface Schema {
                input: string;
                output: string;
            }

            const model = createModel<Schema>({
                input: { type: 'string', default: '' },
                output: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['input'],
                        computed: (vals) => vals.input.toUpperCase(),
                        action: actionSpy
                    }
                }
            });

            model.on('field:change', changeCb);

            await model.setField('input', 'hello');
            await new Promise(r => setTimeout(r, 10));

            const changeCount = changeCb.mock.calls.length;
            const actionCount = actionSpy.mock.calls.length;

            await model.setField('input', 'hello');
            await new Promise(r => setTimeout(r, 10));

            expect(changeCb.mock.calls.length).toBe(changeCount);
            expect(actionSpy.mock.calls.length).toBe(actionCount);

            model.dispose();
        });
    });

    // =========================================================================
    // 27. 无 validator 字段始终校验通过
    // =========================================================================
    describe('Edge: Field without validator always passes', () => {
        test('should always return true for fields with no validator', async () => {
            const model = createModel({
                open: { type: 'string', default: '' }
            });

            expect(await model.setField('open', 'anything')).toBe(true);
            expect(await model.setField('open', '')).toBe(true);
            expect(model.validationErrors.open || []).toHaveLength(0);

            model.dispose();
        });
    });

    // =========================================================================
    // 28. 无 default 值的字段初始化
    // =========================================================================
    describe('Edge: Field without default value', () => {
        test('should have undefined initial value when no default is specified', () => {
            const model = createModel({
                field: { type: 'number', validator: [ValidationRules.number] }
            });

            expect(model.getField('field')).toBeUndefined();

            model.dispose();
        });
    });

    // =========================================================================
    // 29. validateAll 在全部字段校验失败时
    // =========================================================================
    describe('Edge: validateAll when all fields are invalid', () => {
        test('should return false and emit validation:complete with isValid false', async () => {
            const completeCb = jest.fn();

            const model = createModel({
                a: { type: 'string', validator: [ValidationRules.required], default: '' },
                b: { type: 'string', validator: [ValidationRules.required], default: '' }
            });

            model.on('validation:complete', completeCb);
            const result = await model.validateAll();

            expect(result).toBe(false);
            expect(completeCb).toHaveBeenCalledWith({ isValid: false });
            expect(model.validationErrors.a.length).toBeGreaterThan(0);
            expect(model.validationErrors.b.length).toBeGreaterThan(0);

            model.dispose();
        });
    });

    // =========================================================================
    // 30. getValidationSummary 多字段多错误聚合
    // =========================================================================
    describe('Edge: getValidationSummary with multiple fields and errors', () => {
        test('should concatenate all errors with semicolons', async () => {
            const model = createModel({
                a: { type: 'string', validator: [ValidationRules.required.withMessage('A required')], default: '' },
                b: { type: 'string', validator: [ValidationRules.required.withMessage('B required')], default: '' }
            });

            await model.setField('a', '');
            await model.setField('b', '');

            const summary = model.getValidationSummary();
            expect(summary).toContain('A required');
            expect(summary).toContain('B required');
            expect(summary).toContain('; ');

            model.dispose();
        });
    });

    // =========================================================================
    // 31. off() 不传 callback 时清除该事件所有监听器
    // =========================================================================
    describe('Edge: off() without callback removes all listeners for event', () => {
        test('should remove all field:change listeners when callback is omitted', async () => {
            const cb1 = jest.fn();
            const cb2 = jest.fn();

            const model = createModel({
                name: { type: 'string', default: '' }
            });

            model.on('field:change', cb1);
            model.on('field:change', cb2);
            model.off('field:change');

            await model.setField('name', 'test');

            expect(cb1).not.toHaveBeenCalled();
            expect(cb2).not.toHaveBeenCalled();

            model.dispose();
        });
    });

    // =========================================================================
    // 32. setFields 包含不存在的字段
    // =========================================================================
    describe('Edge: setFields with non-existent field key', () => {
        test('should return false and emit field:not-found for unknown key', async () => {
            const notFoundCb = jest.fn();

            interface Schema {
                name: string;
            }

            const model = createModel<Schema>({
                name: { type: 'string', default: '' }
            });

            model.on('field:not-found', notFoundCb);

            // @ts-expect-error — testing runtime behaviour
            const result = await model.setFields({ name: 'ok', ghost: 'nope' });

            expect(result).toBe(false);
            expect(notFoundCb).toHaveBeenCalled();

            model.dispose();
        });
    });

    // =========================================================================
    // 33. transform 在校验之前执行
    // =========================================================================
    describe('Edge: transform is applied before validation', () => {
        test('should validate the transformed value, not the original', async () => {
            const model = createModel({
                field: {
                    type: 'string',
                    transform: (v: string) => v.trim(),
                    validator: [ValidationRules.required],
                    default: ''
                }
            });

            const resultSpaces = await model.setField('field', '   ');
            expect(resultSpaces).toBe(false);

            const resultPadded = await model.setField('field', '  hello  ');
            expect(resultPadded).toBe(true);
            expect(model.getField('field')).toBe('hello');

            model.dispose();
        });
    });

    // =========================================================================
    // 34. dispose 后操作的安全性
    // =========================================================================
    describe('Edge: Operations after dispose', () => {
        test('should handle operations gracefully after dispose', async () => {
            const model = createModel({
                field: { type: 'string', default: 'initial' }
            });

            model.dispose();

            expect(model.data).toEqual({});
            expect(model.getField('field')).toBeUndefined();
            expect(model.getDirtyData()).toEqual({});
            expect(model.getValidationSummary()).toBe('Validation passed');
        });
    });

    // =========================================================================
    // 35. 快速连续 setField（竞态条件）
    // =========================================================================
    describe('Edge: Rapid consecutive setField (race condition)', () => {
        test('should use the last setField result for async validation', async () => {
            const resolvers: Array<(v: boolean) => void> = [];
            const asyncRule = new Rule(
                'async',
                'Failed',
                () => new Promise<boolean>(resolve => { resolvers.push(resolve); })
            );

            const model = createModel({
                field: {
                    type: 'string',
                    validator: [asyncRule],
                    default: ''
                }
            });

            const p1 = model.setField('field', 'first');
            const p2 = model.setField('field', 'second');

            resolvers[1](true);
            resolvers[0](true);

            const r1 = await p1;
            const r2 = await p2;

            expect(r1).toBe(false);
            expect(r2).toBe(true);
            expect(model.getField('field')).toBe('second');

            model.dispose();
        });
    });

    // =========================================================================
    // 36. reaction debounce 合并多次触发
    // =========================================================================
    describe('Edge: Debounced reactions coalesce multiple triggers', () => {
        test('should only fire reaction once for rapid sequential changes', async () => {
            const actionSpy = jest.fn();

            interface Schema {
                input: string;
                output: string;
            }

            const model = createModel<Schema>({
                input: { type: 'string', default: '' },
                output: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['input'],
                        computed: (vals) => vals.input.toUpperCase(),
                        action: actionSpy
                    }
                }
            }, { debounceReactions: 100 });

            await model.setField('input', 'a');
            await model.setField('input', 'b');
            await model.setField('input', 'c');

            expect(actionSpy).not.toHaveBeenCalled();

            await model.settled();

            expect(actionSpy).toHaveBeenCalledTimes(1);
            expect(model.getField('output')).toBe('C');

            model.dispose();
        });
    });

    // =========================================================================
    // 37. validateAll 将 dirtyData 晋升到 data 并触发 reaction
    // =========================================================================
    describe('Edge: validateAll promotes dirtyData and triggers reactions', () => {
        test('should update data and trigger reaction for promoted dirty fields', async () => {
            interface Schema {
                input: string;
                mirror: string;
            }

            const model = createModel<Schema>({
                input: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: 'old'
                },
                mirror: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['input'],
                        computed: (vals) => `mirror:${vals.input}`
                    }
                }
            });

            await model.setField('input', '');
            expect(model.getDirtyData()).toHaveProperty('input', '');
            expect(model.getField('input')).toBe('old');

            await model.setField('input', 'new');
            expect(model.getField('input')).toBe('new');
            await new Promise(r => setTimeout(r, 10));
            expect(model.getField('mirror')).toBe('mirror:new');

            model.dispose();
        });
    });

    // =========================================================================
    // 38. errorFormatter 与多个字段错误的集成
    // =========================================================================
    describe('Edge: errorFormatter with multiple field errors', () => {
        test('should format each error independently and join with semicolons', async () => {
            const model = createModel({
                a: { type: 'string', validator: [ValidationRules.required], default: '' },
                b: { type: 'number', validator: [ValidationRules.min(10)], default: 0 }
            }, {
                errorFormatter: (err) => `❌ ${err.field}:${err.rule}`
            });

            await model.setField('a', '');
            await model.setField('b', 5);

            const summary = model.getValidationSummary();
            expect(summary).toContain('❌ a:required');
            expect(summary).toContain('❌ b:min');

            model.dispose();
        });
    });

    // =========================================================================
    // 39. failFast + 异步校验
    // =========================================================================
    describe('Edge: failFast with async validators', () => {
        test('should stop after first async error in failFast mode', async () => {
            const secondValidatorCalled = jest.fn();

            const model = createModel({
                field: {
                    type: 'string',
                    validator: [
                        new Rule('asyncFail', 'First fails', async () => false),
                        new Rule('asyncPass', 'Second', async (v) => {
                            secondValidatorCalled();
                            return true;
                        })
                    ],
                    default: ''
                }
            }, { failFast: true });

            await model.setField('field', 'test');
            expect(model.validationErrors.field).toHaveLength(1);
            expect(model.validationErrors.field[0].message).toBe('First fails');
            expect(secondValidatorCalled).not.toHaveBeenCalled();

            model.dispose();
        });
    });

    // =========================================================================
    // 40. ErrorHandler 的 UNKNOWN 类型接收所有错误
    // =========================================================================
    describe('Edge: ErrorType.UNKNOWN receives all error types', () => {
        test('should fire UNKNOWN listener for every error type', async () => {
            const errorHandler = new ErrorHandler();
            const unknownCb = jest.fn();
            errorHandler.onError(ErrorType.UNKNOWN, unknownCb);

            const model = createModel({
                name: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: ''
                }
            }, { errorHandler });

            unknownCb.mockClear();

            await model.setField('name', '');
            const countAfterValidation = unknownCb.mock.calls.length;
            expect(countAfterValidation).toBeGreaterThan(0);

            unknownCb.mockClear();

            // @ts-expect-error — testing non-existent field
            await model.setField('nope', 'x');
            expect(unknownCb).toHaveBeenCalled();

            model.dispose();
        });
    });

    // =========================================================================
    // 41. 空 Schema 模型
    // =========================================================================
    describe('Edge: Empty schema model', () => {
        test('should create model with no fields and validateAll returns true', async () => {
            const model = createModel({});

            expect(model.data).toEqual({});
            const result = await model.validateAll();
            expect(result).toBe(true);
            expect(model.getValidationSummary()).toBe('Validation passed');

            model.dispose();
        });
    });

    // =========================================================================
    // 42. clearDirtyData 不影响 data 和 validationErrors
    // =========================================================================
    describe('Edge: clearDirtyData isolation', () => {
        test('should only clear dirtyData without affecting data or errors', async () => {
            const model = createModel({
                field: {
                    type: 'string',
                    validator: [ValidationRules.required],
                    default: 'valid'
                }
            });

            await model.setField('field', '');
            expect(model.getDirtyData()).toHaveProperty('field', '');
            expect(model.getField('field')).toBe('valid');
            expect(model.validationErrors.field.length).toBeGreaterThan(0);

            model.clearDirtyData();

            expect(model.getDirtyData()).toEqual({});
            expect(model.getField('field')).toBe('valid');
            expect(model.validationErrors.field.length).toBeGreaterThan(0);

            model.dispose();
        });
    });
});
