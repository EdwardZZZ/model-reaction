import { ModelManager } from '../core/model-manager';
import { createModel, Model } from '../index';

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
