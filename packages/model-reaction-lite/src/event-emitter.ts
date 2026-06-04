/**
 * Minimal event emitter. Listener exceptions propagate — keep handlers
 * lightweight or wrap them yourself.
 */
export class EventEmitter {
    private events: Record<string, Array<(data: any) => void>> = {};

    on(event: string, callback: (data: any) => void): void {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(callback);
    }

    off(event: string, callback?: (data: any) => void): void {
        if (!this.events[event]) return;
        if (callback) {
            this.events[event] = this.events[event].filter((cb) => cb !== callback);
        } else {
            delete this.events[event];
        }
    }

    emit(event: string, data: any): void {
        const listeners = this.events[event];
        if (!listeners) return;
        // Snapshot so on/off during dispatch doesn't disturb iteration.
        listeners.slice().forEach((cb) => cb(data));
    }

    clear(): void {
        this.events = {};
    }
}
