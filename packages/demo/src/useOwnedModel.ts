import { useEffect, useRef, useState } from 'react';
import type { ModelReturn } from 'model-reaction';

/**
 * Own a model's lifetime in a StrictMode-safe way.
 *
 * The naive pattern —
 *   `const m = useMemo(() => createModel(...), [])` +
 *   `useEffect(() => () => m.dispose(), [m])`
 * — breaks under React 18/19 StrictMode dev double-invoke: the simulated
 * mount→unmount→remount disposes the memoized model on the fake unmount, then
 * the remount reuses that *same* disposed instance (useMemo does not re-run),
 * so the next `setField` throws "ModelManager has been disposed".
 *
 * This hook fixes that by recreating the model whenever the previously held
 * instance was torn down. It keeps the instance in a ref, (re)creates it during
 * render when the slot is empty, and on cleanup disposes it and clears the slot
 * so the next mount builds a fresh one. In production (no double-invoke) the
 * factory runs once and dispose runs once at real unmount — identical to the
 * naive pattern, just resilient to the extra dev cycle.
 *
 * `factory` is captured on first use (like `useMemo(fn, [])`); pass a closure
 * that builds the model. It is not re-run on factory identity changes.
 */
export function useOwnedModel<T extends Record<string, any>>(
    factory: () => ModelReturn<T>
): ModelReturn<T> {
    const ref = useRef<ModelReturn<T> | null>(null);
    // Keep the latest factory without forcing recreation when its identity
    // changes across renders.
    const factoryRef = useRef(factory);
    factoryRef.current = factory;

    if (ref.current === null) {
        ref.current = factoryRef.current();
    }

    // Force a re-render after a cleanup-triggered recreation so consumers read
    // the new instance. The counter value itself is unused.
    const [, bump] = useState(0);

    useEffect(() => {
        // If the slot was cleared by a previous cleanup (StrictMode remount),
        // rebuild before subscribers read it.
        if (ref.current === null) {
            ref.current = factoryRef.current();
            bump((n) => n + 1);
        }
        return () => {
            ref.current?.dispose();
            ref.current = null;
        };
    }, []);

    // ref.current is always populated by the render-time guard above.
    return ref.current as ModelReturn<T>;
}
