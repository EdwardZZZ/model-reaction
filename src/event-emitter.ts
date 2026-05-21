// Event emitter class
export class EventEmitter {
    private events: Record<string, Array<(data: any) => void>> = {};

    // Subscribe to event
    on(event: string, callback: (data: any) => void): void {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    // Unsubscribe from event
    off(event: string, callback?: (data: any) => void): void {
        if (!this.events[event]) return;

        if (callback) {
            this.events[event] = this.events[event].filter(
                (cb) => cb !== callback
            );
        } else {
            delete this.events[event];
        }
    }

    // Trigger event
    emit(event: string, data: any): void {
        if (this.events[event]) {
            // Snapshot listeners so on/off during dispatch don't affect this iteration
            const listeners = this.events[event].slice();
            listeners.forEach((callback) => {
                try {
                    callback(data);
                } catch (err) {
                    /* eslint-disable no-console */
                    console.error(
                        `[EventEmitter] listener for event "${event}" threw`,
                        err
                    );
                    /* eslint-enable no-console */
                }
            });
        }
    }

    // One-time event subscription
    once(event: string, callback: (data: any) => void): void {
        const wrapper = (data: any) => {
            callback(data);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    }

    // Clear all events
    clear(): void {
        this.events = {};
    }
}
