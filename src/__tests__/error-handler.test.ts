import { ErrorHandler } from '../error-handler';
import { ErrorType } from '../types';

describe('ErrorHandler', () => {
    let errorHandler: ErrorHandler;

    beforeEach(() => {
        errorHandler = new ErrorHandler();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('should subscribe to and trigger errors', () => {
        const validationErrorCallback = jest.fn();
        const unknownErrorCallback = jest.fn();

        errorHandler.onError(ErrorType.VALIDATION, validationErrorCallback);
        errorHandler.onError(ErrorType.UNKNOWN, unknownErrorCallback);

        const validationError = errorHandler.createValidationError(
            'name',
            'Name cannot be empty'
        );
        errorHandler.triggerError(validationError);

        expect(validationErrorCallback).toHaveBeenCalledWith(validationError);
        expect(unknownErrorCallback).toHaveBeenCalledWith(validationError);
    });

    test('should unsubscribe from errors', () => {
        const callback = jest.fn();

        errorHandler.onError(ErrorType.VALIDATION, callback);
        errorHandler.offError(ErrorType.VALIDATION, callback);

        const error = errorHandler.createValidationError('name', 'Name cannot be empty');
        errorHandler.triggerError(error);

        expect(callback).not.toHaveBeenCalled();
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
        expect(unknownCb).toHaveBeenCalledWith(
            expect.objectContaining({ type: ErrorType.REACTION, message: 'boom' })
        );
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

        expect(() =>
            errorHandler.offError(ErrorType.FIELD_NOT_FOUND, jest.fn())
        ).not.toThrow();
    });

    describe('factory helpers', () => {
        test('createValidationError sets type=VALIDATION', () => {
            const e = errorHandler.createValidationError('f', 'm');
            expect(e.type).toBe(ErrorType.VALIDATION);
            expect(e.field).toBe('f');
            expect(e.message).toBe('m');
        });

        test('createReactionError preserves originalError', () => {
            const orig = new Error('boom');
            const e = errorHandler.createReactionError('f', orig);
            expect(e.type).toBe(ErrorType.REACTION);
            expect(e.message).toBe('boom');
            expect(e.originalError).toBe(orig);
        });

        test('createFieldNotFoundError formats message', () => {
            const e = errorHandler.createFieldNotFoundError('ghost');
            expect(e.type).toBe(ErrorType.FIELD_NOT_FOUND);
            expect(e.message).toContain('ghost');
        });

        test('createDependencyError formats message', () => {
            const e = errorHandler.createDependencyError('a', 'b');
            expect(e.type).toBe(ErrorType.DEPENDENCY_ERROR);
            expect(e.message).toContain('b');
        });

        test('createCircularDependencyError includes path and field', () => {
            const e = errorHandler.createCircularDependencyError('a -> b', 'a');
            expect(e.type).toBe(ErrorType.CIRCULAR_DEPENDENCY);
            expect(e.message).toContain('a -> b');
            expect(e.message).toContain('-> a');
        });
    });

    test('dispose() clears all registered listeners', () => {
        const cb = jest.fn();
        errorHandler.onError(ErrorType.VALIDATION, cb);
        errorHandler.dispose();

        errorHandler.triggerError(
            errorHandler.createValidationError('x', 'y')
        );
        expect(cb).not.toHaveBeenCalled();
    });
});
