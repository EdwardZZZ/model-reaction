import { createModel } from '../index';
import {
    Field,
    useDraftField,
    useModelFieldState,
    type FieldMetaSetter,
    type FieldProps,
    type UseModelFieldStateOptions,
} from '../react';

type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_value?: T): void {}

type Data = { name: string };
type Description = { description: string };
type Status = { kind: 'text'; payload: string } | { kind: 'count'; payload: number };

/** Compile only, including against published declarations in verify:exports. */
function verifyFieldMetaContracts(enabled: boolean) {
    const model = createModel<Data>({ name: { type: 'string', default: 'Home' } });
    const options = enabled ? { meta: (data: Readonly<Data>) => ({ description: data.name }) } : {};
    const conditional = useModelFieldState(model, 'name', options);
    expectType<Equal<typeof conditional[2]['description'], string | undefined>>();
    // @ts-expect-error a conditional selector may not initialize the extension
    conditional[2].description.toUpperCase();
    const absent = useModelFieldState<Data, 'name', Description>(model, 'name');
    expectType<Equal<typeof absent[2]['description'], string | undefined>>();
    const complete = useModelFieldState(model, 'name', {
        meta: (data) => ({ description: data.name }),
    });
    expectType<Equal<typeof complete[2]['description'], string>>();
    const reusable = {
        meta: (data) => ({ description: data.name }),
    } satisfies UseModelFieldStateOptions<Data, Description>;
    expectType<Equal<ReturnType<typeof reusable.meta>, Description>>();
    const completeDraft = useDraftField(model, 'name', reusable);
    expectType<Equal<typeof completeDraft.meta.description, string>>();
    const conditionalDraft = useDraftField(model, 'name', options);
    expectType<Equal<typeof conditionalDraft.meta.description, string | undefined>>();
    void [absent, complete, completeDraft, conditionalDraft];
    const absentDraft = useDraftField<Data, 'name', Description>(model, 'name');
    // @ts-expect-error explicit M does not guarantee initialization
    absentDraft.meta.description.toUpperCase();
    Field<Data, 'name', Description>({
        model, name: 'name',
        children: ({ meta }) => {
            expectType<Equal<typeof meta.description, string | undefined>>();
            // @ts-expect-error absent selector means potentially missing properties
            return meta.description.toUpperCase();
        },
    });
    Field({
        model, name: 'name', ...options,
        children: ({ meta }) => {
            expectType<Equal<typeof meta.description, string | undefined>>();
            return meta.description?.toUpperCase();
        },
    });
    Field({
        model, name: 'name', ...reusable,
        children: ({ meta }) => {
            expectType<Equal<typeof meta.description, string>>();
            return meta.description.toUpperCase();
        },
    });
    const props: FieldProps<Data, 'name', Description> = {
        model, name: 'name',
        children: ({ meta }) => {
            // @ts-expect-error reusable optional props preserve missing extension values
            return meta.description.toUpperCase();
        },
    };
    void props;

    const selectStatus = (data: Readonly<Data>): Status =>
        data.name ? { kind: 'text', payload: data.name } : { kind: 'count', payload: 0 };
    const union = useModelFieldState(model, 'name', { meta: selectStatus });
    // @ts-expect-error top-level union metadata cannot be partially patched
    union[3]({ kind: 'count' });
    // @ts-expect-error complete branches also require moving the union to a nested property
    union[3]({ kind: 'count', payload: 1 });
    const unionSetter: FieldMetaSetter<Status> = union[3];
    // @ts-expect-error a non-writable union setter cannot be widened into a writable object setter
    const widenedSetter: FieldMetaSetter<{ kind: 'text' | 'count'; payload: string | number }> = unionSetter;
    void widenedSetter;
    const nested = useModelFieldState(model, 'name', { meta: (data) => ({ status: selectStatus(data) }) });
    nested[3]({ status: { kind: 'count', payload: 1 } });
    // @ts-expect-error nested replacements must supply the complete discriminated branch
    nested[3]({ status: { kind: 'count' } });
    if (nested[2].status.kind === 'count') nested[2].status.payload.toFixed(2);

    complete[3]({ description: 'Text' });
    // @ts-expect-error patches must match the selector's property types
    complete[3]({ description: 123 });

    const key = Symbol('description');
    const symbol = useModelFieldState(model, 'name', { meta: () => ({ [key]: 'before' }) });
    symbol[3]({ [key]: 'after' });
    expectType<Equal<typeof symbol[2][typeof key], string>>();
}

void verifyFieldMetaContracts;
