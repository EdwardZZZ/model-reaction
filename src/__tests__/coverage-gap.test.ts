import { createModel, Model, ValidationRules } from '../index';
import { EventEmitter } from '../event-emitter';

describe('Coverage Gap Tests', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    // Test debounced reactions
    test('should handle debounced reactions', async () => {
        jest.useFakeTimers();
        interface Schema {
            input: string;
            output: string;
        }
        const schema: Model<Schema> = {
            input: { type: 'string', default: '' },
            output: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['input'],
                    computed: (values) => values.input.toUpperCase()
                }
            }
        };

        const model = createModel<Schema>(schema, { debounceReactions: 100 });
        
        // Trigger reaction multiple times rapidly
        await model.setField('input', 'a');
        await model.setField('input', 'b');
        await model.setField('input', 'c');

        // Should not have updated yet
        expect(model.getField('output')).toBe('');

        // Fast forward time
        jest.advanceTimersByTime(100);
        
        // Wait for any pending promises (validation, setField) to resolve
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(model.getField('output')).toBe('C');
    });

    // Test reaction with action
    test('should execute reaction action', async () => {
        const actionSpy = jest.fn();
        interface Schema {
            source: string;
            target: string;
        }
        const schema: Model<Schema> = {
            source: { type: 'string', default: 'start' },
            target: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['source'],
                    computed: (values) => values.source,
                    action: actionSpy
                }
            }
        };

        const model = createModel<Schema>(schema);
        await model.setField('source', 'end');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(actionSpy).toHaveBeenCalledWith(expect.objectContaining({
            source: 'end',
            computed: 'end'
        }));
    });

    // Test error formatter
    test('should use custom error formatter', async () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: {
                type: 'string',
                validator: [ValidationRules.required]
            }
        };

        const model = createModel<Schema>(schema, {
            errorFormatter: (err) => `[${err.field}] ${err.message}`
        });

        await model.setField('field', '');
        expect(model.getValidationSummary()).toBe('[field] This field is required');
    });

    // Test validateAll updates data from dirtyData
    test('should update data when validateAll passes on dirty data', async () => {
        // Create a rule that fails first then passes
        let shouldPass = false;
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: {
                type: 'string',
                validator: [{
                    type: 'custom',
                    message: 'error',
                    validate: () => shouldPass
                }],
                default: 'valid'
            }
        };

        const model = createModel<Schema>(schema);
        
        // First fail
        await model.setField('field', 'invalid');
        expect(model.getDirtyData()['field']).toBe('invalid');
        expect(model.getField('field')).toBe('valid'); // Data not updated

        // Now make it pass
        shouldPass = true;
        await model.validateAll();

        expect(model.getField('field')).toBe('invalid'); // Data updated
        expect(model.getDirtyData()).toEqual({}); // Dirty data cleared
    });

    // EventEmitter off without callback
    test('should remove all listeners when off called without callback', () => {
        const emitter = new EventEmitter();
        const cb1 = jest.fn();
        const cb2 = jest.fn();

        emitter.on('event', cb1);
        emitter.on('event', cb2);
        
        emitter.off('event');
        emitter.emit('event', 'data');

        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).not.toHaveBeenCalled();
    });

    // EventEmitter off for non-existent event
    test('should handle off for non-existent event', () => {
        const emitter = new EventEmitter();
        emitter.off('non-existent');
        // Should not throw
    });

    // ModelManager off
    test('should handle off in ModelManager', () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: { type: 'string' }
        };
        const model = createModel<Schema>(schema);
        const cb = jest.fn();

        model.on('field:change', cb);
        model.off('field:change', cb);
        
        model.setField('field', 'value'); // async but emit is sync inside
        
        // Wait for async setField
        return model.setField('field', 'value').then(() => {
            expect(cb).not.toHaveBeenCalled();
        });
    });

    // ModelManager transform
    test('should transform value before setting', async () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = {
            field: { 
                type: 'string',
                transform: (val) => val.trim()
            }
        };
        const model = createModel<Schema>(schema);
        
        await model.setField('field', '  value  ');
        expect(model.getField('field')).toBe('value');
    });

    // ModelManager getErrorHandler
    test('should expose error handler', () => {
        const schema: Model = {};
        const model = createModel(schema);
        // createModel returns ModelReturn which doesn't expose getErrorHandler directly
        // But we can check if it's accessible via internal instance if we had access,
        // OR we need to check if ModelReturn includes getErrorHandler.
        // Checking types.ts, ModelReturn does NOT include getErrorHandler.
        // It is only on ModelManager class.
        // However, the test requirement is to cover line 323 in model-manager.ts.
        // But createModel wraps it.
        // Wait, line 323 is `getErrorHandler(): ErrorHandler`.
        // If it's not in ModelReturn interface, we can't call it on the result of createModel.
        // Let's check index.ts to see if it exports ModelManager class directly or if we can access it.
        // It exports ModelManager class but createModel returns an object literal that delegates.
        // The object literal in index.ts:
        // return { ... getErrorHandler: undefined ... } - wait, it doesn't expose it.
        
        // So line 323 might be dead code unless we use ModelManager directly.
        // Let's import ModelManager and use it directly.
    });
});

import { ModelManager } from '../model-manager';

describe('ModelManager Direct Tests', () => {
    test('should expose error handler', () => {
        const manager = new ModelManager({});
        expect(manager.getErrorHandler()).toBeDefined();
    });

    // Test ModelReturn.data getter
    test('should expose data via getter', () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = { field: { type: 'string', default: 'val' } };
        const model = createModel<Schema>(schema);
        expect(model.data).toEqual({ field: 'val' });
    });

    test('should forward reaction-system emit through model manager', () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = { field: { type: 'string', default: 'val' } };
        const manager = new ModelManager(schema);
        const cb = jest.fn();
        manager.on('custom:event', cb);

        const internal = manager as any;
        internal.reactionSystem.callbacks.emit('custom:event', { value: 1 });

        expect(cb).toHaveBeenCalledWith({ value: 1 });
    });

    test('should reuse existing validation error array in reaction setError', () => {
        interface Schema {
            field: string;
        }
        const schema: Model<Schema> = { field: { type: 'string', default: 'val' } };
        const manager = new ModelManager(schema);
        const internal = manager as any;

        internal.reactionSystem.callbacks.setError('field', {
            field: 'field',
            rule: 'reaction_error',
            message: 'first'
        });
        internal.reactionSystem.callbacks.setError('field', {
            field: 'field',
            rule: 'reaction_error',
            message: 'second'
        });

        expect(manager.validationErrors.field?.length).toBe(2);
    });
});
