import { EventEmitter } from '../event-emitter';

describe('EventEmitter', () => {
    let eventEmitter: EventEmitter;

    beforeEach(() => {
        eventEmitter = new EventEmitter();
    });

    test('should subscribe to and emit events', () => {
        const callback = jest.fn();

        eventEmitter.on('test-event', callback);
        eventEmitter.emit('test-event', { data: 'test data' });

        expect(callback).toHaveBeenCalledWith({ data: 'test data' });
    });

    test('should unsubscribe from events', () => {
        const callback = jest.fn();

        eventEmitter.on('test-event', callback);
        eventEmitter.off('test-event', callback);
        eventEmitter.emit('test-event', { data: 'test data' });

        expect(callback).not.toHaveBeenCalled();
    });

    test('should handle once events', () => {
        const callback = jest.fn();

        eventEmitter.once('test-event', callback);
        eventEmitter.emit('test-event', { data: 'first call' });
        eventEmitter.emit('test-event', { data: 'second call' });

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ data: 'first call' });
    });

    test('should handle multiple subscribers', () => {
        const callback1 = jest.fn();
        const callback2 = jest.fn();

        eventEmitter.on('test-event', callback1);
        eventEmitter.on('test-event', callback2);
        eventEmitter.emit('test-event', { data: 'test data' });

        expect(callback1).toHaveBeenCalledWith({ data: 'test data' });
        expect(callback2).toHaveBeenCalledWith({ data: 'test data' });
    });

    test('should remove all listeners when off called without callback', () => {
        const cb1 = jest.fn();
        const cb2 = jest.fn();

        eventEmitter.on('event', cb1);
        eventEmitter.on('event', cb2);

        eventEmitter.off('event');
        eventEmitter.emit('event', 'data');

        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).not.toHaveBeenCalled();
    });

    test('should handle off for non-existent event without throwing', () => {
        expect(() => eventEmitter.off('non-existent')).not.toThrow();
        expect(() => eventEmitter.off('non-existent', () => {})).not.toThrow();
    });

    test('clear() should remove every listener for every event', () => {
        const cb1 = jest.fn();
        const cb2 = jest.fn();

        eventEmitter.on('a', cb1);
        eventEmitter.on('b', cb2);

        eventEmitter.clear();

        eventEmitter.emit('a', 1);
        eventEmitter.emit('b', 2);

        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).not.toHaveBeenCalled();
    });

    test('listener throwing should not prevent subsequent listeners', () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const calls: string[] = [];

        eventEmitter.on('evt', () => {
            calls.push('first');
            throw new Error('boom');
        });
        eventEmitter.on('evt', () => {
            calls.push('second');
        });

        eventEmitter.emit('evt', null);

        expect(calls).toEqual(['first', 'second']);
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    test('listener added during emit is NOT invoked in the same dispatch', () => {
        const calls: string[] = [];
        let added = false;

        eventEmitter.on('evt', () => {
            calls.push('outer');
            if (!added) {
                added = true;
                eventEmitter.on('evt', () => calls.push('inner'));
            }
        });

        eventEmitter.emit('evt', null);
        // Snapshotted dispatch -> inner should not fire on this emit
        expect(calls).toEqual(['outer']);

        eventEmitter.emit('evt', null);
        expect(calls).toContain('inner');
    });
});
