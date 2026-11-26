import { createModel, SKIP_REACTION } from '../index';
import type { FieldSchema, InferFieldType, InferModelData, ModelEventMap, ReactionAction } from '../index';

type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;
type IsAny<T> = 0 extends (1 & T) ? true : false;
function expectType<T extends true>(_value?: T): void {}

/** Also compiled against the published declarations by verify:exports. */
export function verifyPublicTypeContracts(create: typeof createModel): void {
    const annotated = (): FieldSchema<'string'> => ({ type: 'string', default: null });
    const precise = () => ({ type: 'string', default: null } satisfies FieldSchema<'string'>);
    const model = create({
        source: { type: 'number', default: 1 },
        annotated: annotated(),
        precise: precise(),
        optional: { type: 'boolean' },
        detail: {
            type: 'object', default: { name: 'Ada' },
            reaction: { fields: ['source'], computed: () => ({ name: 123 }) },
        },
        tags: {
            type: 'array', default: ['first'],
            reaction: { fields: ['source'], computed: () => [123] },
        },
        skipped: {
            type: 'array', default: ['first'],
            reaction: { fields: ['source'], computed: () => SKIP_REACTION },
        },
        state: { type: 'enum', values: ['draft', 'published'] as const, default: 'draft' as const },
        0: { type: 'number', default: 0 },
    });
    expectType<Equal<typeof model.data.annotated, unknown>>();
    expectType<Equal<typeof model.data.precise, string | null>>();
    expectType<Equal<typeof model.data.optional, boolean | undefined>>();
    expectType<Equal<typeof model.data.detail, { name: string } | { name: number }>>();
    expectType<Equal<typeof model.data.tags, string[] | number[]>>();
    expectType<Equal<typeof model.data.skipped, string[]>>();
    expectType<Equal<typeof model.data.state, 'draft' | 'published'>>();
    expectType<Equal<IsAny<typeof model.data.tags>, false>>();
    const tags = model.getField('tags');
    expectType<Equal<typeof tags, string[] | number[]>>();
    void tags;
    model.subscribe((data) => data.detail, (value) => {
        expectType<Equal<typeof value, { name: string } | { name: number }>>();
        void value;
    });
    model.on('field:change', (event) => {
        if (event.field === '0') expectType<Equal<typeof event.value, number>>();
        if (event.field === 'precise') expectType<Equal<typeof event.value, string | null>>();
        if (event.field === 'tags') expectType<Equal<typeof event.value, string[] | number[]>>();
    });

    type Union = { type: 'string'; default: null } | { type: 'number' };
    expectType<Equal<InferFieldType<Union>, string | number>>();
    expectType<Equal<InferModelData<{ value: Union }>['value'], string | number | null | undefined>>();
    expectType<Equal<InferModelData<{ value: { type: 'string'; default?: null } }>['value'], string | null | undefined>>();
    expectType<Equal<ModelEventMap<{ 0: number }>['field:validation-complete']['field'], '0'>>();
    expectType<Equal<ModelEventMap<{ 0: number }>['dirty-data:cleared']['fields'], '0'[]>>();
    expectType<Equal<ModelEventMap<{ a?: number }>['field:change'], { field: 'a'; value: number | undefined }>>();

    const invalidDeclarations = () => {
        // @ts-expect-error a string value cannot accompany a numeric field
        const event: ModelEventMap<{ count: number; name: string }>['field:change'] = { field: 'count', value: 'wrong' };
        // @ts-expect-error snapshots are getter-only properties
        model.data = { ...model.data };
        // @ts-expect-error error snapshots are getter-only properties
        model.validationErrors = {};
        // @ts-expect-error only string and numeric schema keys are supported
        create({ [Symbol('field')]: { type: 'string' } });
        // @ts-expect-error explicit data types cannot declare symbol fields either
        create<{ [key: symbol]: string }>({ [Symbol('field')]: { type: 'string' } });
        void event;
    };
    void invalidDeclarations;
    model.dispose();

    const actionSchema = create({
        source: { type: 'number', default: 1 },
        nullable: {
            type: 'number', default: null,
            reaction: { fields: ['source'], computed: () => 2, action: [({ value }) => {
                expectType<Equal<typeof value, unknown>>();
                if (typeof value === 'number') value.toFixed();
            }] },
        },
        optional: {
            type: 'number',
            reaction: { fields: ['source'], computed: () => 2, action: [({ value }) => {
                expectType<Equal<typeof value, unknown>>();
                void value;
            }] },
        },
        arbitrary: {
            type: 'number', default: 'pending',
            reaction: { fields: ['source'], computed: () => 2, action: [({ value }) => {
                expectType<Equal<typeof value, unknown>>();
                void value;
            }] },
        },
    });
    expectType<Equal<typeof actionSchema.data.nullable, number | null>>();
    expectType<Equal<typeof actionSchema.data.optional, number | undefined>>();
    expectType<Equal<typeof actionSchema.data.arbitrary, number | string>>();
    actionSchema.dispose();

    const explicit = create<{ source: number; target: number | null | undefined }>({
        source: { type: 'number', default: 1 },
        target: {
            type: 'number', default: null,
            reaction: { fields: ['source'], computed: () => 2, action: [({ value }) => {
                expectType<Equal<typeof value, number | null | undefined>>();
                if (value != null) value.toFixed();
            }] },
        },
    });
    explicit.dispose();

    const invalidActions = () => {
        const onlyNumber: ReactionAction<number> = ({ value }) => { value.toFixed(); };
        // @ts-expect-error a narrow callback cannot infer away a nullable default
        create({ target: { type: 'number', default: null, reaction: {
            fields: [], computed: () => 2, action: [onlyNumber],
        } } });
        create<{ target: number | null }>({
            target: { type: 'number', default: null, reaction: {
                fields: [], computed: () => 2,
                // @ts-expect-error explicit field values include null
                action: [onlyNumber],
            } },
        });
    };
    void invalidActions;
}
