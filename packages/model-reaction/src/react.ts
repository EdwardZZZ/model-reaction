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
    useEffect,
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
 * Same shape as {@link useModelSelector}, but with **ref-locked** selector
 * semantics: the `selector` and `isEqual` references are stored in refs
 * that are refreshed on every render, so changing them does **not** tear
 * down and recreate the underlying subscription.
 *
 * Use this variant when:
 *   - The selector is an inline arrow function and you don't want to pay
 *     for `useCallback` ceremony.
 *   - The selector closes over per-render variables (e.g. `id`, `index`)
 *     and you want those updates to be reflected without resubscribing.
 *
 * Trade-offs vs. {@link useModelSelector}:
 *   - The selector is re-run on every render (via `getSnapshot`), so keep
 *     it cheap — heavy selectors should still memoise inputs.
 *   - Notifications fire on any field change; the equality check happens
 *     in `getSnapshot` instead of inside the model subscription, so the
 *     model layer can't dedupe before reaching React.
 *   - Ref writes happen during render. This is the same pattern used by
 *     zustand and is concurrent-safe, but keep selectors pure.
 *
 * ⚠️ If the selector returns a **fresh object/array each call**
 * (`(d) => d.items.map(...)`, `(d) => ({...})`), you MUST pass an `isEqual`
 * (e.g. `shallow`). With the default `Object.is`, every render yields a new
 * reference, the per-render cache never hits, and React aborts with
 * "Maximum update depth exceeded". Selectors returning a primitive or a
 * stable reference are fine.
 *
 * ```tsx
 * function Row({ id }: { id: string }) {
 *     // No useCallback needed; closure variable `id` always reflects the
 *     // latest render.
 *     const item = useModelComputed(cart, (d) => d.items[id]);
 *     return <span>{item?.name}</span>;
 * }
 * ```
 */
export function useModelComputed<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: T) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    // Refresh refs every render so closure-captured variables stay current
    // without forcing a resubscribe.
    const selectorRef = useRef(selector);
    const isEqualRef = useRef(isEqual);
    selectorRef.current = selector;
    isEqualRef.current = isEqual;

    // Cache the last returned reference so `useSyncExternalStore` sees a
    // stable value when the equality check passes. Using a one-slot box
    // lets us distinguish "uninitialized" from `undefined as R`.
    const cacheRef = useRef<{ value: R } | null>(null);

    const getSnapshot = useCallback((): R => {
        const next = selectorRef.current(model.data);
        const cached = cacheRef.current;
        if (cached === null || !isEqualRef.current(cached.value, next)) {
            cacheRef.current = { value: next };
            return next;
        }
        return cached.value;
    }, [model]);

    const subscribe = useCallback(
        (notify: () => void) => model.on(ModelEvents.FIELD_CHANGE, notify),
        [model]
    );

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
    /** True while an async setField is in flight from this hook. */
    validating: boolean;
    /** True if the field currently has unsaved/invalid data in dirtyData. */
    dirty: boolean;
}

/** Setter signature returned by `useModelFieldState`. */
export type FieldSetter<V> = (value: V) => Promise<boolean>;

/**
 * Receive a field value plus a setter and metadata in one hook. Designed
 * to make wiring controlled inputs to a model trivial:
 *
 * ```tsx
 * const [name, setName, meta] = useModelFieldState(model, 'name');
 * <input
 *   value={name}
 *   onChange={(e) => setName(e.target.value)}
 *   disabled={meta.validating}
 * />
 * {meta.error && <span>{meta.error}</span>}
 * ```
 *
 * `touched` / blur-gated error display is intentionally not provided —
 * it is a local UI concern, easily handled with a single `useState(false)`
 * in the consumer component.
 */
export function useModelFieldState<
    T extends Record<string, any>,
    K extends keyof T,
>(
    model: ModelReturn<T>,
    field: K
): [T[K], FieldSetter<T[K]>, FieldMeta] {
    const value = useModelField(model, field);

    // Errors: subscribed via the same field-change channel. We bump a counter
    // whenever this field changes so the snapshot read sees the latest array.
    const errorsSubscribe = useCallback(
        (notify: () => void) => {
            const handler = (e: { field: string }): void => {
                if (e.field === field) notify();
            };
            const unsubscribeChange = model.on(
                ModelEvents.FIELD_CHANGE,
                handler
            );
            const validationHandler = (e: { field?: string }): void => {
                if (e.field === field) notify();
            };
            const unsubscribeError = model.on(
                ModelEvents.VALIDATION_ERROR,
                validationHandler
            );
            const unsubscribeComplete = model.on(
                ModelEvents.VALIDATION_COMPLETE,
                notify
            );
            return () => {
                unsubscribeChange();
                unsubscribeError();
                unsubscribeComplete();
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

    const meta = useMemo<FieldMeta>(
        () => ({
            errors,
            error: errors.length > 0 && errors[0] ? errors[0].message : null,
            validating,
            dirty,
        }),
        [errors, validating, dirty]
    );

    return [value, setter, meta];
}

const EMPTY_ERRORS: ValidationError[] = [];

// -----------------------------------------------------------------------------
// useDraftField — controlled-input binding with a local draft
// -----------------------------------------------------------------------------

/**
 * Render a committed/pending value as input text (hydration path only, never
 * live keystrokes). `format` defaults to `String`; nullish and non-finite
 * numbers collapse to `''` first, so an unset field or an unparseable `NaN`
 * (e.g. "12a" via `transform: Number`) shows blank rather than "null"/"NaN".
 */
function toDisplay<V>(value: V, format: (value: V) => string): string {
    if (value == null) return '';
    if (typeof value === 'number' && !Number.isFinite(value)) return '';
    return format(value);
}

/** What {@link useDraftField} hands back to a controlled input. */
export interface DraftField<V> {
    /** Text shown in the input; updates on every keystroke regardless of validity. */
    draft: string;
    /** Reflect an edit locally, then validate-then-commit it. Wire to `onChange`. */
    setDraft: (next: string) => void;
    /** Model-side metadata for this field (errors, validating, dirty). */
    meta: FieldMeta;
    /** True once the input has been blurred at least once. */
    touched: boolean;
    /** Flips `touched` on. Wire to `onBlur`. */
    onBlur: () => void;
    /** `touched && meta.error`; the message itself is `meta.error`. */
    showError: boolean;
    /** The last value the model committed to `data`. Rarely needed directly. */
    committed: V;
}

/** Options for {@link useDraftField}. */
export interface UseDraftFieldOptions<V> {
    /**
     * How a committed/pending value becomes input text on reseed. Defaults to
     * `String`. Override to keep a format the model doesn't store — e.g. a cents
     * field can show `(c) => (c / 100).toFixed(2)`. Nullish/non-finite values
     * still collapse to `''` first; the text→value direction stays with the
     * schema's `transform`.
     */
    format?: (value: V) => string;
}

/**
 * Bind a model field to a controlled text input, owning the edit-lifecycle
 * UI state (draft text, `touched`, error gating) so the rendering component
 * stays presentational. An **optional** convenience built on
 * {@link useModelFieldState}; import it only if you want it.
 *
 * The draft — "the text being edited" — lives in local state, not the model:
 * under verify-then-commit an invalid or still-in-flight keystroke never reaches
 * `data`, so binding an input straight to the model makes it feel un-typeable.
 * Full rationale in docs/REACT.md.
 *
 * On mount the draft seeds from `dirtyData` (the last failed input), then the
 * committed value, so a model that outlives the input restores a not-yet-valid
 * entry across remount. Live editing never reads back from the model.
 *
 * Field-type contract (string-only; non-string needs a schema `transform`) and
 * the `format` option: see docs/REACT.md "Field-type contract".
 */
export function useDraftField<
    T extends Record<string, any>,
    K extends keyof T,
>(
    model: ModelReturn<T>,
    field: K,
    options: UseDraftFieldOptions<T[K]> = {}
): DraftField<T[K]> {
    const [committed, setValue, meta] = useModelFieldState(model, field);

    // Ref-lock `format` so an inline arrow needs no useCallback and doesn't
    // retrigger the reseed effect. `toDisplay` handles nullish / non-finite.
    const formatRef = useRef<(value: T[K]) => string>(options.format ?? String);
    formatRef.current = options.format ?? String;
    const display = useCallback(
        (value: T[K]) => toDisplay(value, formatRef.current),
        []
    );

    // Seed once on mount: pending dirty value if any, else committed value.
    const [draft, setDraft] = useState(() => {
        const pending = model.getDirtyData()[field];
        return display((pending ?? committed) as T[K]);
    });
    const [touched, setTouched] = useState(false);

    // Reflect outside-driven commits (a reaction, a setField elsewhere). Keyed
    // off the previous committed value, not a "first render" flag: on mount it
    // matches so the seeded draft survives, and this stays correct under
    // StrictMode's setup→cleanup→setup double-invoke (a mount flag would not).
    const lastCommitted = useRef(committed);
    useEffect(() => {
        if (Object.is(lastCommitted.current, committed)) return;
        lastCommitted.current = committed;
        setDraft(display(committed));
    }, [committed, display]);

    const edit = useCallback(
        (next: string) => {
            setDraft(next); // show what was typed, valid or not
            // Draft is always a string; non-string fields rely on schema `transform`.
            void setValue(next as unknown as T[K]);
        },
        [setValue]
    );

    const onBlur = useCallback(() => setTouched(true), []);
    const showError = Boolean(touched && meta.error);

    return { draft, setDraft: edit, meta, touched, onBlur, showError, committed };
}

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
    const [value, setValue, meta] = useModelFieldState(
        model,
        props.name
    );
    // Render the children render-prop directly. Returning ReactNode is fine
    // here — React accepts any node where ReactElement is expected.
    return props.children({ value, setValue, meta }) as ReactElement;
}
