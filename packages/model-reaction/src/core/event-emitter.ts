export class EventEmitter<
    Events extends Record<string, any> = Record<string, any>,
> {
    private events: Partial<{
        [E in keyof Events]: Array<(data: Events[E]) => void>;
    }> = Object.create(null);

    on<E extends keyof Events>(
        event: E,
        callback: (data: Events[E]) => void
    ): () => void {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event]!.push(callback);
        return () => {
            if (!this.events[event]) return;
            this.events[event] = this.events[event].filter(
                (cb) => cb !== callback
            );
        };
    }

    emit<E extends keyof Events>(event: E, data: Events[E]): void {
        // Snapshot listeners so on/off during dispatch don't affect this iteration.
        const listeners = this.events[event]?.slice();
        if (!listeners) return;
        listeners.forEach((callback) => {
            try {
                callback(data);
            } catch (err) {
                /* eslint-disable no-console */
                console.error(
                    `[EventEmitter] listener for event "${String(event)}" threw`,
                    err
                );
                /* eslint-enable no-console */
            }
        });
    }

    clear(): void {
        this.events = Object.create(null);
    }
}
