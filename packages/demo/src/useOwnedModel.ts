import { useEffect, useRef, useState } from 'react';
import type { ModelReturn } from 'model-reaction';

/** Create the model after commit and dispose the same instance on cleanup. */
export function useOwnedModel<T extends Record<string, any>>(
    factory: () => ModelReturn<T>
): ModelReturn<T> | null {
    // Capture the initial factory; later renders do not replace the owned model.
    const factoryRef = useRef(factory);
    const [model, setModel] = useState<ModelReturn<T> | null>(null);

    useEffect(() => {
        const owned = factoryRef.current();
        setModel(owned);
        return () => owned.dispose();
    }, []);

    return model;
}
