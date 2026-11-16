import { createModel, Model, ModelEvents } from '../index';
import { ValidationRules } from '../validation';

describe('ModelManager - Dirty Data Management', () => {
    interface User {
        name: string;
        age: number;
        email: string;
    }
    const schema: Model<User> = {
        name: {
            type: 'string',
            validator: [ValidationRules.required],
            default: '',
        },
        age: {
            type: 'number',
            validator: [
                ValidationRules.required,
                ValidationRules.number,
                ValidationRules.min(18),
            ],
            default: 18,
        },
        email: {
            type: 'string',
            validator: [ValidationRules.required, ValidationRules.email],
            default: '',
        },
    };

    let model: ModelReturn<User>;

    beforeEach(() => {
        model = createModel<User>(schema);
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        model.dispose();
    });

    test('manages dirty data correctly through invalid → clear → valid → invalid → fix', async () => {
        expect(model.getDirtyData()).toEqual({});

        // @ts-expect-error - runtime type check
        await model.setField('age', 'invalid-age');
        expect(model.getDirtyData()).toHaveProperty('age');
        expect(model.getDirtyData().age).toBe('invalid-age');

        model.clearDirtyData();
        expect(model.getDirtyData()).toEqual({});

        await model.setField('name', 'Valid Name');
        expect(model.getDirtyData()).not.toHaveProperty('name');

        await model.setField('email', 'invalid-email');
        expect(model.getDirtyData()).toHaveProperty('email');

        await model.setField('email', 'valid@example.com');
        expect(model.getDirtyData()).not.toHaveProperty('email');
    });
});


describe('ModelManager - commitValid: dirty cleanup with deepEqual early-return', () => {
    test('setField with same valid value clears stale dirty', async () => {
        const m = createModel<{ age: number }>({
            age: {
                type: 'number',
                default: 25,
                validator: [ValidationRules.number],
            },
        });

        // @ts-expect-error - runtime type check
        await m.setField('age', 'abc');
        expect(m.getDirtyData()).toEqual({ age: 'abc' });

        // Re-typing the original valid value must drop the stale dirty entry,
        // even though `data.age` itself does not change (deepEqual early-return).
        await m.setField('age', 25);
        expect(m.getDirtyData()).toEqual({});
        expect(m.getField('age')).toBe(25);

        m.dispose();
    });

    test('clearing stale dirty alone does NOT emit field:change', async () => {
        const m = createModel<{ age: number }>({
            age: {
                type: 'number',
                default: 25,
                validator: [ValidationRules.number],
            },
        });
        const handler = jest.fn();
        m.on(ModelEvents.FIELD_CHANGE, handler);

        // Failed write: dirtyData written, no field:change.
        // @ts-expect-error - runtime type check
        await m.setField('age', 'abc');
        // Recovery write equal to current data: dirty cleared, no field:change.
        await m.setField('age', 25);

        expect(handler).not.toHaveBeenCalled();
        expect(m.getDirtyData()).toEqual({});

        m.dispose();
    });

    test('full no-op when value unchanged and no dirty', async () => {
        const m = createModel<{ age: number }>({
            age: {
                type: 'number',
                default: 25,
                validator: [ValidationRules.number],
            },
        });
        const handler = jest.fn();
        m.on(ModelEvents.FIELD_CHANGE, handler);

        await m.setField('age', 25);
        expect(m.getDirtyData()).toEqual({});
        expect(handler).not.toHaveBeenCalled();

        m.dispose();
    });
});

