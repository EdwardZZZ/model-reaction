import { shallow } from './selectors';

interface FieldMetaStore {
    getSnapshot(): Readonly<Record<PropertyKey, unknown>>;
    subscribe(notify: () => void): () => void;
    set(patch: object): void;
}

/** Overrides for one mounted field binding. */
export function createFieldMetaStore(): FieldMetaStore {
    let snapshot: Readonly<Record<PropertyKey, unknown>> = Object.freeze({});
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => snapshot,
        subscribe: (notify) => {
            listeners.add(notify);
            return () => { listeners.delete(notify); };
        },
        set: (patch) => {
            const next = { ...snapshot, ...patch };
            delete next.errors;
            delete next.validating;
            delete next.dirty;
            if (shallow(snapshot, next)) return;
            snapshot = Object.freeze(next);
            listeners.forEach((notify) => notify());
        },
    };
}
