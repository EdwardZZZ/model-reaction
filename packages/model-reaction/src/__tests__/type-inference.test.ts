import { createModel } from '../index';
import { createModel as createDevtoolsModel } from '../devtools';

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
});
