import { createModel, Model, ErrorHandler, ErrorType } from '../index';

describe('ErrorHandler', () => {
    let errorHandler: ErrorHandler;

    beforeEach(() => {
        errorHandler = new ErrorHandler();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // Test error subscription and triggering
    test('should subscribe to and trigger errors', () => {
        const validationErrorCallback = jest.fn();
        const unknownErrorCallback = jest.fn();

        // Subscribe to specific error type
        errorHandler.onError(ErrorType.VALIDATION, validationErrorCallback);
        // Subscribe to unknown error type
        errorHandler.onError(ErrorType.UNKNOWN, unknownErrorCallback);

        // Create and trigger validation error
        const validationError = errorHandler.createValidationError('name', 'Name cannot be empty');
        errorHandler.triggerError(validationError);

        // Validate callbacks were called
        expect(validationErrorCallback).toHaveBeenCalledWith(validationError);
        expect(unknownErrorCallback).toHaveBeenCalledWith(validationError);
    });

    // Test unsubscription
    test('should unsubscribe from errors', () => {
        const callback = jest.fn();

        errorHandler.onError(ErrorType.VALIDATION, callback);
        errorHandler.offError(ErrorType.VALIDATION, callback);

        const error = errorHandler.createValidationError('name', 'Name cannot be empty');
        errorHandler.triggerError(error);

        expect(callback).not.toHaveBeenCalled();
    });

    // Test error handling in ModelManager
    test('should handle errors in ModelManager', async () => {
        interface User {
            name: string;
        }
        const testSchema: Model<User> = {
            name: {
                type: 'string',
                validator: [],
                default: '',
            },
        };

        const modelManager = createModel<User>(testSchema);
        const errorCallback = jest.fn();

        // Listen for field not found error
        modelManager.on('field:not-found', errorCallback);

        // Try to set non-existent field
        // @ts-expect-error - Testing runtime error for non-existent field
        await modelManager.setField('nonexistentField', 'value');

        // Validate error was triggered
        expect(errorCallback).toHaveBeenCalled();
        expect(errorCallback.mock.calls[0][0].type).toBe(ErrorType.FIELD_NOT_FOUND);
        expect(errorCallback.mock.calls[0][0].field).toBe('nonexistentField');
    });

    test('should initialize missing listener arrays in onError', () => {
        const anyHandler = errorHandler as any;
        delete anyHandler.errorListeners[ErrorType.VALIDATION];

        const cb = jest.fn();
        errorHandler.onError(ErrorType.VALIDATION, cb);

        expect(Array.isArray(anyHandler.errorListeners[ErrorType.VALIDATION])).toBe(true);
        expect(anyHandler.errorListeners[ErrorType.VALIDATION]).toContain(cb);
    });

    test('should handle triggerError without field and missing listener buckets', () => {
        const anyHandler = errorHandler as any;

        const unknownCb = jest.fn();
        errorHandler.onError(ErrorType.UNKNOWN, unknownCb);

        delete anyHandler.errorListeners[ErrorType.REACTION];

        errorHandler.triggerError({ type: ErrorType.REACTION, message: 'boom' } as any);

        expect((console.error as any) as jest.Mock).toHaveBeenCalledWith('[reaction] boom');
        expect(unknownCb).toHaveBeenCalledWith(expect.objectContaining({ type: ErrorType.REACTION, message: 'boom' }));
    });

    test('should not fail when unknown listeners are missing', () => {
        const anyHandler = errorHandler as any;
        delete anyHandler.errorListeners[ErrorType.UNKNOWN];

        const cb = jest.fn();
        errorHandler.onError(ErrorType.VALIDATION, cb);

        const err = errorHandler.createValidationError('name', 'Name cannot be empty');
        errorHandler.triggerError(err);

        expect(cb).toHaveBeenCalledWith(err);
    });

    test('should ignore offError when listener buckets are missing', () => {
        const anyHandler = errorHandler as any;
        delete anyHandler.errorListeners[ErrorType.FIELD_NOT_FOUND];

        expect(() => errorHandler.offError(ErrorType.FIELD_NOT_FOUND, jest.fn())).not.toThrow();
    });
});
