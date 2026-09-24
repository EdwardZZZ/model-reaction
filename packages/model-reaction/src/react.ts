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
 * Build a render-local snapshot getter while retaining the last committed
 * selection for equality checks when selector references change.
 */
function useSelectionSnapshot<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean
): () => R {
    const committedSelectionRef = useRef<{ value: R } | null>(null);
    const getSnapshot = useMemo(() => {
        let previous: { data: Readonly<T>; value: R } | null = null;

        return (): R => {
            const data = model.data;
            if (previous !== null && Object.is(previous.data, data)) {
                return previous.value;
            }

            const nextSelection = selector(data);
            const committed = committedSelectionRef.current;
            const selection =
                committed !== null && isEqual(committed.value, nextSelection)
                    ? committed.value
                    : nextSelection;

            previous = { data, value: selection };
            return selection;
        };
    }, [model, selector, isEqual]);

    // Only committed renders may update the cross-render equality baseline.
    // The memoized getter above keeps speculative render state local.
    useEffect(() => {
        committedSelectionRef.current = { value: getSnapshot() };
    });

    return getSnapshot;
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
 * A new selector reference is evaluated immediately against the current
 * snapshot. Wrap expensive selectors in `useCallback`; use `useModelComputed`
 * when you want to pass an inline selector that closes over render values.
 */
export function useModelSelector<T extends Record<string, any>, R>(
    model: ModelReturn<T>,
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    const getSnapshot = useSelectionSnapshot(model, selector, isEqual);

    const subscribe = useCallback(
        (notify: () => void) =>
            model.subscribe(
                selector,
                () => notify(),
                isEqual
            ),
        [model, selector, isEqual]
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Same shape as {@link useModelSelector}, but the subscription stays stable
 * while the selector is read from the latest render snapshot.
 *
 * Use this variant when:
 *   - The selector is an inline arrow function and you don't want to pay
 *     for `useCallback` ceremony.
 *   - The selector closes over per-render variables (e.g. `id`, `index`)
 *     and you want those updates to be reflected without resubscribing.
 *
 * Trade-offs vs. {@link useModelSelector}:
 *   - The selector is re-run when the model snapshot or selector changes, so
 *     keep it cheap — heavy selectors should still memoise inputs.
 *   - Notifications fire on any field change; the equality check happens
 *     in `getSnapshot` instead of inside the model subscription, so the
 *     model layer can't dedupe before reaching React.
 *
 * If the selector returns a **fresh object/array** (`(d) => d.items.map(...)`,
 * `(d) => ({...})`), pass an `isEqual` (e.g. `shallow`) when equivalent
 * selections should keep the same reference across model updates. With the
 * default `Object.is`, each changed snapshot produces a new selection.
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
    selector: (data: Readonly<T>) => R,
    isEqual: (a: R, b: R) => boolean = Object.is
): R {
    const getSnapshot = useSelectionSnapshot(model, selector, isEqual);

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
    // JSON encoding handles arbitrary string field names without delimiter
    // collisions and keeps inline field arrays stable when their contents match.
    const key = JSON.stringify(fields);
    const pick = useCallback((data: Readonly<T>): Pick<T, K> => {
        const out = {} as Pick<T, K>;
        for (const f of fields) out[f] = data[f];
        return out;
        // `key` covers `fields` content; intentional dep list.
    }, [key]);

    return useModelSelector(model, pick, shallow);
}

/** Metadata returned alongside a field value by `useModelFieldState`. */
export interface FieldMeta {
    /** Validation errors for this field (empty array if none). */
    errors: readonly ValidationError[];
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

    const metaSubscribe = useCallback(
        (notify: () => void) => {
            const validationHandler = (e: { field: string }): void => {
                if (e.field === field) notify();
            };
            const unsubscribeError = model.on(
                ModelEvents.VALIDATION_ERROR,
                validationHandler
            );
            const unsubscribeFieldValidation = model.on(
                ModelEvents.FIELD_VALIDATION_COMPLETE,
                validationHandler
            );
            const unsubscribeDirty = model.on(
                ModelEvents.DIRTY_DATA_CLEARED,
                (e) => {
                    if (e.fields.includes(field as keyof T & string)) notify();
                }
            );
            return () => {
                unsubscribeError();
                unsubscribeFieldValidation();
                unsubscribeDirty();
            };
        },
        [model, field]
    );
    const metaSnapshot = useMemo(() => {
        let previous: {
            errors: readonly ValidationError[];
            dirty: boolean;
        } | null = null;

        return () => {
            const errors = model.validationErrors[field as string] ?? EMPTY_ERRORS;
            const dirty = Object.prototype.hasOwnProperty.call(
                model.getDirtyData(),
                field
            );
            if (
                previous !== null &&
                previous.errors === errors &&
                previous.dirty === dirty
            ) {
                return previous;
            }
            previous = { errors, dirty };
            return previous;
        };
    }, [model, field]);
    const { errors, dirty } = useSyncExternalStore(
        metaSubscribe,
        metaSnapshot,
        metaSnapshot
    );

    const [validating, setValidating] = useState(false);
    const validatingCount = useRef(0);

    const setter = useCallback<FieldSetter<T[K]>>(
        async (next) => {
            validatingCount.current++;
            setValidating(true);
            try {
                return await model.setField(field, next);
            } finally {
                validatingCount.current--;
                setValidating(validatingCount.current > 0);
            }
        },
        [model, field]
    );

    const meta: FieldMeta = {
        errors,
        error: errors[0]?.message ?? null,
        validating,
        dirty,
    };

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
        const pending = (model.getDirtyData() as Partial<T>)[field];
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
