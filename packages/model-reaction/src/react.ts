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
export {
    shallow,
    useModelSelector,
    useModelComputed,
    useModelFields,
} from './react/selectors';
export {
    useModelField,
    useModelFieldState,
    type FieldMeta,
    type FieldSetter,
} from './react/field-state';
export {
    useDraftField,
    type DraftField,
    type UseDraftFieldOptions,
} from './react/draft-field';
export {
    ModelProvider,
    useModel,
    Field,
    type ModelProviderProps,
    type FieldProps,
    type FieldRenderProps,
} from './react/context';
