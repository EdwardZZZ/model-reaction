import { createModel } from '../index';
import { createModel as createDevtoolsModel } from '../devtools';

// Both directions preserve the complete overload set, including generics.
const devtoolsSignature: typeof createModel = createDevtoolsModel;
const rootSignature: typeof createDevtoolsModel = createModel;
void devtoolsSignature;
void rootSignature;

describe('createModel type inference', () => {
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
});
