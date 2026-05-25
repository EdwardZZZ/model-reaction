/**
 * React adapter for model-reaction.
 *
 * Provides hooks and components that subscribe React trees to a model with
 * field-level granularity, leveraging `useSyncExternalStore` for tear-free
 * reads.
 *
 * `react` is declared as a peer dependency. This module is published as a
 * separate entry point (`model-reaction/react`) so consumers without React
 * never pay for it.
 */
import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode,
} from 'react';
import { ModelEvents, ValidationError } from './types';
import type { ModelReturn } from './types';

/**
 * Shallow equality for plain objects / arrays. Useful as the `isEqual`
 * argument of `useModelSelector` / `useModelFields` when the selector
 * returns a fresh container each call.
 */
export function shallow<T>(a: T, b: T): boolean {
    if (Object.is(a, b)) return true;
    if (
        typeof a !== 'object' ||
        a === null ||
        typeof b !== 'object' ||
        b === null
    ) {
        return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!Object.is(a[i], b[i])) return false;
        }
        return true;
    }
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!Object.is(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k]
        )) {
            return false;
        }
    }
    return true;
}

/**
 * Subscribe a component to a single field. The component re-renders only
 * when that field's committed value changes.
 */
export function useModelField<T extends Record<string, any>, K extends keyof T>(
    model: ModelReturn<T>,
    field: K
): T[K] {
    const subscribe = useCallback(
        (notify: () => void) => model.subscribeField(field, notify),
        [model, field]
    );
    const getSnapshot = useCallback(
        () => model.getField(field),
        [model, field]
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe a component to a derived value. The component re-renders only
 * when `selector(data)` changes (compared via `isEqual`, default Object.is).
 *
 * The selector and isEqual references are captured on first call; if you
 * pass new functions each render, wrap them in `useCallback`.
 */
export function useModelSelector<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: T) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    const cacheRef = useRef<R | undefined>(undefined);
    const initialized = useRef(false);
    if (!initialized.current) {
        cacheRef.current = selector(model.data);
        initialized.current = true;
    }

    const subscribe = useCallback(
        (notify: () => void) =>
            model.subscribe(
                selector,
                (next) => {
                    cacheRef.current = next;
                    notify();
                },
                isEqual
            ),
        [model, selector, isEqual]
    );
    const getSnapshot = useCallback(() => cacheRef.current as R, []);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe a component to a set of fields and receive them as an object.
 * Re-renders only when any of the listed fields shallowly changes.
 *
 * Equivalent to `useModelSelector(model, d => pick(d, fields), shallow)`
 * but with stable selector / equality references.
 */
export function useModelFields<
    T extends Record<string, any>,
    K extends keyof T,
>(model: ModelReturn<T>, fields: readonly K[]): Pick<T, K> {
    // Stable key so we can rebuild the cache when the list of fields changes.
    const key = (fields as readonly (string | number | symbol)[]).join('\u0000');

    const pick = useCallback((data: T): Pick<T, K> => {
        const out = {} as Pick<T, K>;
        for (const f of fields) out[f] = data[f];
        return out;
        // `key` covers `fields` content; intentional dep list.
    }, [model, key]);

    const cacheRef = useRef<Pick<T, K> | undefined>(undefined);
    const lastKeyRef = useRef<string | undefined>(undefined);
    if (lastKeyRef.current !== key) {
        cacheRef.current = pick(model.data);
        lastKeyRef.current = key;
    }

    const subscribe = useCallback(
        (notify: () => void) =>
            model.subscribe(
                pick,
                (next) => {
                    cacheRef.current = next;
                    notify();
                },
                shallow
            ),
        [model, pick]
    );
    const getSnapshot = useCallback(
        () => cacheRef.current as Pick<T, K>,
        []
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Metadata returned alongside a field value by `useModelFieldState`. */
export interface FieldMeta {
    /** Validation errors for this field (empty array if none). */
    errors: ValidationError[];
    /** First error message, or null. Convenient for inline UI. */
    error: string | null;
    /** Whether the user has interacted with the field (touched -> blurred). */
    touched: boolean;
    /** True while an async setField is in flight from this hook. */
    validating: boolean;
    /** True if the field currently has unsaved/invalid data in dirtyData. */
    dirty: boolean;
}

/** Setter signature returned by `useModelFieldState`. */
export type FieldSetter<V> = (value: V) => Promise<boolean>;

/** Helper bag returned by `useModelFieldState` (3rd tuple slot). */
export interface FieldHelpers {
    /** Mark the field as touched (typically wired to `onBlur`). */
    setTouched: (touched?: boolean) => void;
    /** Reset touched state and clear any local validating flag. */
    reset: () => void;
}

/**
 * Receive a field value plus a setter and metadata in one hook. Designed
 * to make wiring controlled inputs to a model trivial:
 *
 * ```tsx
 * const [name, setName, meta, helpers] = useModelFieldState(model, 'name');
 * <input
 *   value={name}
 *   onChange={(e) => setName(e.target.value)}
 *   onBlur={() => helpers.setTouched()}
 * />
 * {meta.touched && meta.error && <span>{meta.error}</span>}
 * ```
 */
export function useModelFieldState<
    T extends Record<string, any>,
    K extends keyof T,
>(
    model: ModelReturn<T>,
    field: K
): [T[K], FieldSetter<T[K]>, FieldMeta, FieldHelpers] {
    const value = useModelField(model, field);

    // Errors: subscribed via the same field-change channel. We bump a counter
    // whenever this field changes so the snapshot read sees the latest array.
    const errorsSubscribe = useCallback(
        (notify: () => void) => {
            const handler = (e: { field: string }): void => {
                if (e.field === field) notify();
            };
            model.on(ModelEvents.FIELD_CHANGE, handler);
            const validationHandler = (e: { field?: string }): void => {
                if (e.field === field) notify();
            };
            model.on(ModelEvents.VALIDATION_ERROR, validationHandler);
            model.on(ModelEvents.VALIDATION_COMPLETE, notify);
            return () => {
                model.off(ModelEvents.FIELD_CHANGE, handler);
                model.off(ModelEvents.VALIDATION_ERROR, validationHandler);
                model.off(ModelEvents.VALIDATION_COMPLETE, notify);
            };
        },
        [model, field]
    );
    const errorsSnapshot = useCallback(
        () => model.validationErrors[field as string] ?? EMPTY_ERRORS,
        [model, field]
    );
    const errors = useSyncExternalStore(
        errorsSubscribe,
        errorsSnapshot,
        errorsSnapshot
    );

    const dirtySnapshot = useCallback(
        () => Object.prototype.hasOwnProperty.call(model.getDirtyData(), field),
        [model, field]
    );
    const dirty = useSyncExternalStore(
        errorsSubscribe,
        dirtySnapshot,
        dirtySnapshot
    );

    const [touched, setTouchedState] = useState(false);
    const [validating, setValidating] = useState(false);

    const setter = useCallback<FieldSetter<T[K]>>(
        async (next) => {
            setValidating(true);
            try {
                return await model.setField(field, next);
            } finally {
                setValidating(false);
            }
        },
        [model, field]
    );

    const helpers = useMemo<FieldHelpers>(
        () => ({
            setTouched: (next: boolean = true) => setTouchedState(next),
            reset: () => {
                setTouchedState(false);
                setValidating(false);
            },
        }),
        []
    );

    const meta = useMemo<FieldMeta>(
        () => ({
            errors,
            error: errors.length > 0 && errors[0] ? errors[0].message : null,
            touched,
            validating,
            dirty,
        }),
        [errors, touched, validating, dirty]
    );

    return [value, setter, meta, helpers];
}

const EMPTY_ERRORS: ValidationError[] = [];

// -----------------------------------------------------------------------------
// Provider + Field
// -----------------------------------------------------------------------------

/**
 * Internal context. Stored as `unknown` because a single Provider may host
 * any model shape; consumers narrow via `useModel<T>()`.
 */
const ModelContext = createContext<ModelReturn<any> | null>(null);

/** Props for `<ModelProvider>`. */
export interface ModelProviderProps<T extends Record<string, any>> {
    model: ModelReturn<T>;
    children?: ReactNode;
}

/**
 * Provide a model to descendant components. Use `useModel()` / `<Field>`
 * to consume it without prop-drilling.
 *
 * Multiple providers can be nested; the nearest one wins.
 */
export function ModelProvider<T extends Record<string, any>>(
    props: ModelProviderProps<T>
): ReactElement {
    return createElement(
        ModelContext.Provider,
        { value: props.model as ModelReturn<any> },
        props.children
    );
}

/**
 * Read the model from the nearest `<ModelProvider>`. Throws if none is
 * mounted, which is almost always a usage bug.
 */
export function useModel<T extends Record<string, any>>(): ModelReturn<T> {
    const model = useContext(ModelContext);
    if (!model) {
        throw new Error(
            '[model-reaction] useModel must be used inside a <ModelProvider>.'
        );
    }
    return model as ModelReturn<T>;
}

/** Render-prop arguments passed to `<Field>`'s children. */
export interface FieldRenderProps<V> {
    value: V;
    setValue: FieldSetter<V>;
    meta: FieldMeta;
    helpers: FieldHelpers;
}

/** Props for `<Field>`. */
export interface FieldProps<
    T extends Record<string, any>,
    K extends keyof T,
> {
    name: K;
    /** Optional override; defaults to the model from `<ModelProvider>`. */
    model?: ModelReturn<T>;
    children: (props: FieldRenderProps<T[K]>) => ReactNode;
}

/**
 * Bind a child render-prop to a single field of the surrounding model.
 *
 * ```tsx
 * <ModelProvider model={userModel}>
 *   <Field name="name">
 *     {({ value, setValue, meta }) => (
 *       <input value={value} onChange={e => setValue(e.target.value)} />
 *     )}
 *   </Field>
 * </ModelProvider>
 * ```
 */
export function Field<
    T extends Record<string, any>,
    K extends keyof T,
>(props: FieldProps<T, K>): ReactElement {
    const ctxModel = useContext(ModelContext) as ModelReturn<T> | null;
    const model = props.model ?? ctxModel;
    if (!model) {
        throw new Error(
            '[model-reaction] <Field> requires either a `model` prop or a surrounding <ModelProvider>.'
        );
    }
    const [value, setValue, meta, helpers] = useModelFieldState(
        model,
        props.name
    );
    // Render the children render-prop directly. Returning ReactNode is fine
    // here — React accepts any node where ReactElement is expected.
    return props.children({ value, setValue, meta, helpers }) as ReactElement;
}
