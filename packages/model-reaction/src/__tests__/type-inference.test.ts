import { createModel, FieldSchema, Model, Reaction, ReactionAction, SKIP_REACTION } from '../index';
import { createModel as createDevtoolsModel } from '../devtools';
import { ModelManager } from '../core/model-manager';
import { ValidationRules } from '../validation';

// Both directions preserve the complete overload set, including generics.
const devtoolsSignature: typeof createModel = createDevtoolsModel;
const rootSignature: typeof createDevtoolsModel = createModel;
void devtoolsSignature;
void rootSignature;

describe('createModel type inference', () => {
    test('both entries reject removed options and reaction arrays at type level', () => {
        const invalidDeclarations = () => {
            for (const create of [createModel, createDevtoolsModel]) {
                // @ts-expect-error unknown fields always reject; strictMode was removed
                create({ count: { type: 'number' } }, { strictMode: true });
                // @ts-expect-error field validation always stops at the first error
                create({ count: { type: 'number' } }, { failFast: true });
                create({
                    count: {
                        type: 'number',
                        // @ts-expect-error even a single-element reaction array is rejected
                        reaction: [{ fields: [], computed: () => 1 }],
                    },
                });
            }
        };
        void invalidDeclarations;
        expect(devtoolsSignature).toBe(createDevtoolsModel);
    });

    test('preserves Reaction interface extension and no-argument actions alongside typed contexts', async () => {
        interface NamedReaction extends Reaction<number> { label: string }
        const calls: number[] = [];
        const action: ReactionAction<number> = ({ field, value }) => {
            const name: string = field;
            expect(name).toBe('target');
            calls.push(value);
        };
        const reaction: NamedReaction = {
            label: 'double', fields: ['source'], computed: ({ source }) => source * 2,
            action: [action, async () => { await model.setField('note', 'saved'); }],
        };
        const model = createModel({
            source: { type: 'number', default: 1 },
            target: { type: 'number', default: 0, reaction },
            note: { type: 'string', default: '' },
        });
        const invalidDeclarations = () => {
            // @ts-expect-error single action functions are no longer accepted
            const single: Reaction<number> = { fields: [], computed: () => 1, action };
            // @ts-expect-error action receives an object with field and value
            const parameter: ReactionAction<number> = (value: number) => { void value; };
            // @ts-expect-error a number action cannot be used for a string reaction
            const wrongValue: Reaction<string> = { fields: [], computed: () => '', action: [action] };
            // @ts-expect-error boolean write results are not side-effect return values
            const write: ReactionAction = () => model.setField('note', 'saved');
            // @ts-expect-error callers must supply the action context
            action();
            // @ts-expect-error direct calls must match the action value type
            action({ field: 'target', value: '2' });
            // @ts-expect-error computed remains required
            const incomplete: Reaction<number> = { fields: [], action: [] };
            void [single, parameter, wrongValue, write, incomplete];
        };
        void invalidDeclarations;
        await model.settled();
        const value: number = model.data.target;
        expect(value).toBe(2);
        expect(calls).toEqual([2]);
        expect(model.data.note).toBe('saved');
        model.dispose();
    });

    test('infers field values from a schema literal at the root entry', () => {
        const model = createModel({
            name: { type: 'string', default: 'Ada' },
            age: { type: 'number', default: 36 },
            enabled: { type: 'boolean' },
            status: {
                type: 'enum',
                values: ['draft', 'published'] as const,
                default: 'draft',
            },
        });

        const name: string = model.data.name;
        const age: number = model.data.age;
        const enabled: boolean | undefined = model.data.enabled;
        const status: string = model.data.status;

        const invalidWrites = () => {
            // @ts-expect-error age only accepts numbers
            void model.setField('age', '36');
        };
        void invalidWrites;

        expect({ name, age, enabled, status }).toEqual({
            name: 'Ada',
            age: 36,
            enabled: undefined,
            status: 'draft',
        });
        model.dispose();
    });

    test('keeps inference aligned in the DevTools entry', () => {
        const model = createDevtoolsModel({
            count: { type: 'number', default: 1 },
        });

        const count: number = model.data.count;
        const invalidWrite = () => {
            // @ts-expect-error count only accepts numbers
            void model.setField('count', '1');
        };
        void invalidWrite;

        expect(count).toBe(1);
        model.dispose();
    });

    describe.each([
        ['root', createModel],
        ['DevTools', createDevtoolsModel],
    ] as const)('%s entry', (_, factory) => {
        test('infers action context values from the target field type', async () => {
            const contexts: Array<{ field: string; value: number | string }> = [];
            const model = factory({
                source: { type: 'number', default: 2 },
                total: {
                    type: 'number',
                    default: 0,
                    reaction: {
                        fields: ['source'],
                        computed: ({ source }) => source * 2,
                        action: [({ field, value }) => {
                            const count: number = value;
                            // @ts-expect-error value is a number, not an unchecked any
                            const text: string = value;
                            void text;
                            contexts.push({ field, value: count });
                        }],
                    },
                },
                label: {
                    type: 'string',
                    default: '',
                    reaction: {
                        fields: ['total'],
                        computed: ({ total }) => `$${total}`,
                        action: [({ field, value }) => {
                            const text: string = value;
                            // @ts-expect-error value is a string, not an unchecked any
                            const count: number = value;
                            void count;
                            contexts.push({ field, value: text });
                        }],
                    },
                },
            });
            await model.settled();
            expect(contexts).toEqual([
                { field: 'total', value: 4 },
                { field: 'label', value: '$4' },
            ]);
            model.dispose();
        });

        test('preserves object, array, enum and optional field inference', () => {
            const model = factory({
                detail: { type: 'object', default: { name: 'Ada' } },
                tags: { type: 'array', default: ['first'] },
                state: {
                    type: 'enum',
                    values: ['draft', 'published'] as const,
                    default: 'draft' as const,
                },
                note: { type: 'string' },
                nullable: { type: 'string', default: null },
            });
            const detail: { name: string } = model.data.detail;
            const tags: string[] = model.data.tags;
            const state: 'draft' | 'published' = model.data.state;
            const note: string | undefined = model.data.note;
            const nullable: string | null = model.data.nullable;
            const invalidWrites = () => {
                // @ts-expect-error object field retains its property types
                void model.setField('detail', { name: 1 });
                // @ts-expect-error array field retains its item type
                void model.setField('tags', [1]);
                // @ts-expect-error literal enum default retains the value union
                void model.setField('state', 'unknown');
                // @ts-expect-error nullable string does not accept a number
                void model.setField('nullable', 1);
            };
            void invalidWrites;
            expect({ detail, tags, state, note, nullable }).toEqual({
                detail: { name: 'Ada' },
                tags: ['first'],
                state: 'draft',
                note: undefined,
                nullable: null,
            });
            model.dispose();
        });

        test('preserves explicit data types', () => {
            interface Person { name: string; age: number }
            const model = factory<Person>({
                name: { type: 'string', default: 'Ada' },
                age: { type: 'number', default: 36 },
            });
            const person: Readonly<Person> = model.data;
            const invalidWrite = () => {
                // @ts-expect-error the explicit type still rejects wrong values
                void model.setField('age', '36');
            };
            void invalidWrite;
            expect(person).toEqual({ name: 'Ada', age: 36 });
            model.dispose();
        });
    });

    describe('reaction.computed return type', () => {
        test('follows the target field type tag', async () => {
            const doubled: Reaction<number> = {
                fields: ['price'],
                computed: (v) => v.price * 2,
            };
            const textField = (): FieldSchema<'string'> => ({ type: 'string', default: '' });
            const model = createModel({
                price: { type: 'number', default: 2 },
                total: { type: 'number', default: 0, reaction: doubled },
                label: {
                    ...textField(),
                    reaction: {
                        fields: ['price'],
                        computed: (v) => (v.price > 0 ? `$${v.price}` : SKIP_REACTION),
                    },
                },
            });
            const invalidSchemas = () => {
                createModel({
                    price: { type: 'number', default: 2 },
                    // @ts-expect-error a number field rejects a string result
                    total: {
                        type: 'number',
                        reaction: { fields: ['price'], computed: () => '4' },
                    },
                });
                createModel({
                    price: { type: 'number', default: 2 },
                    total: {
                        type: 'number',
                        // @ts-expect-error reaction arrays are no longer supported
                        reaction: [doubled, { fields: ['price'], computed: () => true }],
                    },
                });
                createModel<{ price: number; label: string }>({
                    price: { type: 'number' },
                    // @ts-expect-error explicit data types are checked too
                    label: { type: 'string', reaction: { fields: ['price'], computed: () => 1 } },
                });
                createModel({
                    price: { type: 'number', default: 2 },
                    // @ts-expect-error Reaction<number> does not fit a string field
                    label: { type: 'string', reaction: doubled },
                });
            };
            void invalidSchemas;

            await model.settled();
            expect(model.data).toEqual({ price: 2, total: 4, label: '$2' });
            model.dispose();
        });

        test('rejects nullable results unless the reaction is untyped', async () => {
            interface Priced { price: number; label: string | null }
            const nullableLabel: Reaction = {
                fields: ['price'],
                computed: (v) => (v.price > 0 ? `$${v.price}` : null),
            };
            const model = createModel<Priced>({
                price: { type: 'number', default: 0 },
                label: { type: 'string', default: '', reaction: nullableLabel },
            });
            const invalidSchema = () => {
                createModel<Priced>({
                    price: { type: 'number' },
                    // @ts-expect-error null is not a string result
                    label: {
                        type: 'string',
                        reaction: { fields: ['price'], computed: () => null },
                    },
                });
            };
            void invalidSchema;

            await model.settled();
            expect(model.getField('label')).toBeNull();
            model.dispose();
        });
    });
});

describe('ModelManager - Type checks', () => {
    test('valid Model schema compiles without error', () => {
        interface User {
            id: number;
            name: string;
            email?: string;
        }
        const validSchema: Model<User> = {
            id: { type: 'number' },
            name: {
                type: 'string',
                validator: [ValidationRules.required],
            },
            email: { type: 'string' },
        };
        const manager = new ModelManager<User>(validSchema);
        expect(manager).toBeInstanceOf(ModelManager);
        manager.dispose();
    });
});

describe('createModel - schema type inference', () => {
    test('infers data shape from schema literal without explicit type arg', async () => {
        const m = createModel({
            name: { type: 'string' as const, default: 'a' },
            age: { type: 'number' as const, default: 0 },
            active: { type: 'boolean' as const, default: false },
        });

        // Type is inferred from schema; runtime values verify the data shape.
        expect(m.data.name).toBe('a');
        expect(m.data.age).toBe(0);
        expect(m.data.active).toBe(false);

        await m.setField('age', 42);
        expect(m.getField('age')).toBe(42);
        m.dispose();
    });
});
