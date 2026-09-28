import {
    createContext,
    createElement,
    useContext,
    type ReactElement,
    type ReactNode,
} from 'react';
import type { ModelReturn } from '../types';
import {
    useModelFieldState,
    type FieldMeta,
    type FieldSetter,
} from './field-state';

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
    const [value, setValue, meta] = useModelFieldState(model, props.name);
    return props.children({ value, setValue, meta }) as ReactElement;
}
