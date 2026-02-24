import { deepEqual, validateField } from '../utils';
import { ErrorHandler } from '../error-handler';
import { FieldSchema } from '../types';

describe('Utils', () => {
    describe('deepEqual', () => {
        // Basic types
        test('should handle basic types correctly', () => {
            expect(deepEqual(1, 1)).toBe(true);
            expect(deepEqual(1, 2)).toBe(false);
            expect(deepEqual('a', 'a')).toBe(true);
            expect(deepEqual('a', 'b')).toBe(false);
            expect(deepEqual(true, true)).toBe(true);
            expect(deepEqual(true, false)).toBe(false);
            expect(deepEqual(null, null)).toBe(true);
            expect(deepEqual(undefined, undefined)).toBe(true);
            expect(deepEqual(null, undefined)).toBe(false);
        });

        // Arrays
        test('should handle arrays correctly', () => {
            expect(deepEqual([], [])).toBe(true);
            expect(deepEqual([1, 2], [1, 2])).toBe(true);
            expect(deepEqual([1, 2], [1, 3])).toBe(false);
            expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
            expect(deepEqual([1, { a: 1 }], [1, { a: 1 }])).toBe(true);
        });

        // Objects
        test('should handle objects correctly', () => {
            expect(deepEqual({}, {})).toBe(true);
            expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
            expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
            expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
            expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
            
            // Nested objects
            expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
            expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
        });

        // Mixed types and edge cases
        test('should handle mixed types and edge cases', () => {
            expect(deepEqual([], {})).toBe(false);
            expect(deepEqual({}, null)).toBe(false);
            expect(deepEqual(null, {})).toBe(false);
            expect(deepEqual(1, '1')).toBe(false);
            
            const obj = { a: 1 };
            expect(deepEqual(obj, obj)).toBe(true); // Same reference
        });
    });

    describe('validateField', () => {
        test('should return true when schema has no validators', async () => {
            const errorHandler = new ErrorHandler();
            const schema: FieldSchema = { type: 'string' };
            const errors: Record<string, any[]> = {};

            const result = await validateField({
                schema,
                value: 'value',
                errors,
                field: 'testField',
                timeout: 1000,
                errorHandler
            });

            expect(result).toBe(true);
        });

        test('should handle validator without validate method', async () => {
            const errorHandler = new ErrorHandler();
            const errors = {};
            
            const schema: FieldSchema = {
                type: 'string',
                validator: [
                    // @ts-ignore - simulating invalid validator object
                    {
                        type: 'custom',
                        message: 'error'
                        // missing validate method
                    }
                ]
            };

            const result = await validateField({
                schema, 
                value: 'value', 
                errors, 
                field: 'testField', 
                timeout: 1000, 
                errorHandler
            });
            expect(result).toBe(true);
        });

        test('should handle synchronous validator throwing an error', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const errorHandler = new ErrorHandler();
            const triggerSpy = jest.spyOn(errorHandler, 'triggerError').mockImplementation(() => {});
            const errors: Record<string, any[]> = {};

            const schema: FieldSchema = {
                type: 'string',
                validator: [
                    {
                        type: 'throws',
                        message: 'should not be used',
                        validate: () => {
                            throw new Error('sync boom');
                        }
                    }
                ]
            };

            const result = await validateField({
                schema,
                value: 'value',
                errors,
                field: 'testField',
                timeout: 1000,
                errorHandler
            });

            expect(result).toBe(false);
            expect(errors.testField?.[0]?.rule).toBe('validation_error');
            expect(errors.testField?.[0]?.message).toContain('Validation failed: sync boom');
            expect(triggerSpy).toHaveBeenCalled();
        });

        test('should handle synchronous validator throwing a non-error value', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const errorHandler = new ErrorHandler();
            const errors: Record<string, any[]> = {};

            const schema: FieldSchema = {
                type: 'string',
                validator: [
                    {
                        type: 'throws',
                        message: 'should not be used',
                        validate: () => {
                            throw 'sync string';
                        }
                    }
                ]
            };

            const result = await validateField({
                schema,
                value: 'value',
                errors,
                field: 'testField',
                timeout: 1000,
                errorHandler
            });

            expect(result).toBe(false);
            expect(errors.testField?.[0]?.message).toContain('Validation failed: sync string');
        });

        test('should handle async validator rejection with non-error', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const errorHandler = new ErrorHandler();
            const errors: Record<string, any[]> = {};

            const schema: FieldSchema = {
                type: 'string',
                validator: [
                    {
                        type: 'async',
                        message: 'async failed',
                        validate: () => Promise.reject('async string')
                    }
                ]
            };

            const result = await validateField({
                schema,
                value: 'value',
                errors,
                field: 'testField',
                timeout: 1000,
                errorHandler
            });

            expect(result).toBe(false);
            expect(errors.testField?.[0]?.message).toContain('Validation failed: async string');
        });

        test('should reuse existing error array for validation failures', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const errorHandler = new ErrorHandler();
            const errors: Record<string, any[]> = {
                testField: [{ field: 'testField', rule: 'existing', message: 'existing' }]
            };

            const schema: FieldSchema = {
                type: 'string',
                validator: [
                    {
                        type: 'required',
                        message: 'required',
                        validate: () => false
                    }
                ]
            };

            const result = await validateField({
                schema,
                value: '',
                errors,
                field: 'testField',
                timeout: 1000,
                errorHandler
            });

            expect(result).toBe(false);
            expect(errors.testField?.length).toBe(2);
            expect(errors.testField?.[0]?.rule).toBe('existing');
        });
        test('should initialize error array when validation fails', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const errorHandler = new ErrorHandler();
            const errors: Record<string, any[]> = {};

            const schema: FieldSchema = {
                type: 'string',
                validator: [
                    {
                        type: 'required',
                        message: 'required',
                        validate: () => false
                    }
                ]
            };

            const result = await validateField({
                schema,
                value: '',
                errors,
                field: 'testField',
                timeout: 1000,
                errorHandler
            });

            expect(result).toBe(false);
            expect(errors.testField?.length).toBe(1);
        });

        test('should use default timeout and failFast values', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const errorHandler = new ErrorHandler();
            const errors: Record<string, any[]> = {};

            const schema: FieldSchema = {
                type: 'string',
                validator: [
                    {
                        type: 'ok',
                        message: 'ok',
                        validate: () => true
                    }
                ]
            };

            const result = await validateField({
                schema,
                value: 'value',
                errors,
                field: 'testField',
                errorHandler
            });

            expect(result).toBe(true);
            expect(errors.testField).toBeUndefined();
        });
    });
});
