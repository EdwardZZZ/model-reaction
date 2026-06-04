import { createModel, ValidationRules, ERROR } from '..';

describe('model-reaction-lite: synchronous core', () => {
    it('initializes data from schema defaults', () => {
        const m = createModel({
            name: { type: 'string', default: 'Ada' },
            age: { type: 'number', default: 0 },
        });
        expect(m.data.name).toBe('Ada');
        expect(m.data.age).toBe(0);
        m.dispose();
    });

    it('setField returns boolean synchronously and commits valid values', () => {
        const m = createModel({
            name: {
                type: 'string',
                default: '',
                validator: [ValidationRules.required, ValidationRules.minLength(2)],
            },
        });

        const result = m.setField('name', 'Ada');
        // Synchronous: result is a boolean, not a Promise
        expect(typeof result).toBe('boolean');
        expect(result).toBe(true);
        expect(m.data.name).toBe('Ada');
        m.dispose();
    });

    it('failed setField drops the value and surfaces validation errors only', () => {
        const m = createModel({
            name: {
                type: 'string',
                default: '',
                validator: [ValidationRules.minLength(3)],
            },
        });
        const ok = m.setField('name', 'Hi');
        expect(ok).toBe(false);
        // Lite has no dirtyData buffer: data stays at the last valid value.
        expect(m.data.name).toBe('');
        // No leaked dirtyData / getDirtyData on the public surface.
        expect((m as any).getDirtyData).toBeUndefined();
        expect(m.validationErrors.name?.[0]?.rule).toBe('minLength');
        m.dispose();
    });

    it('reactions run synchronously after a successful setField', () => {
        const actionSpy = jest.fn();
        const m = createModel({
            firstName: { type: 'string', default: '' },
            lastName: { type: 'string', default: '' },
            fullName: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['firstName', 'lastName'],
                    computed: ({ firstName, lastName }) =>
                        `${firstName} ${lastName}`.trim(),
                    action: actionSpy,
                },
            },
        });

        m.setField('firstName', 'Ada');
        // No await — reactions are synchronous
        expect(m.data.fullName).toBe('Ada');
        m.setField('lastName', 'Lovelace');
        expect(m.data.fullName).toBe('Ada Lovelace');
        expect(actionSpy).toHaveBeenCalledTimes(2);
        m.dispose();
    });

    it('setFields applies atomically and runs each reaction at most once', () => {
        const computedSpy = jest.fn((values: Record<string, any>) => values.a + values.b);
        const m = createModel({
            a: { type: 'number', default: 0 },
            b: { type: 'number', default: 0 },
            sum: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['a', 'b'],
                    computed: computedSpy,
                },
            },
        });

        const ok = m.setFields({ a: 2, b: 3 });
        expect(ok).toBe(true);
        expect(m.data.sum).toBe(5);
        expect(computedSpy).toHaveBeenCalledTimes(1);
        m.dispose();
    });

    it('validateAll re-runs validators synchronously and returns boolean', () => {
        const m = createModel({
            email: {
                type: 'string',
                default: 'bad',
                validator: [ValidationRules.email],
            },
        });

        const ok = m.validateAll();
        expect(ok).toBe(false);
        expect(m.validationErrors.email?.[0]?.rule).toBe('email');
        m.dispose();
    });

    it('rejects async validators with a clear error (lite is sync-only)', () => {
        const asyncRule = {
            type: 'remote',
            message: 'unused',
            validate: async () => true,
        };
        const m = createModel({
            name: {
                type: 'string',
                default: '',
                // Intentionally pass an async validator to assert lite refuses it.
                validator: [asyncRule as any],
            },
        });

        const ok = m.setField('name', 'x');
        expect(ok).toBe(false);
        expect(m.validationErrors.name?.[0]?.message).toMatch(
            /does not support async validators/i
        );
        m.dispose();
    });

    it('subscribe fires synchronously on commit', () => {
        const m = createModel<{ count: number }>({
            count: { type: 'number', default: 0 },
        });
        const selectorEvents: Array<[number, number]> = [];

        const unsub = m.subscribe(
            (d) => d.count,
            (next, prev) => selectorEvents.push([next, prev])
        );

        m.setField('count', 1);
        m.setField('count', 2);

        expect(selectorEvents).toEqual([
            [1, 0],
            [2, 1],
        ]);

        unsub();
        m.dispose();
    });

    it('dispose makes further setField throw and clears state', () => {
        const m = createModel({
            name: { type: 'string', default: 'a' },
        });
        m.dispose();
        expect(() => m.setField('name', 'b')).toThrow(/disposed/);
    });

    it('detects circular reactions without blowing the stack', () => {
        const errors: any[] = [];
        const m = createModel({
            a: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['b'],
                    computed: (values: Record<string, any>) => (values.b as number) + 1,
                },
            },
            b: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['a'],
                    computed: (values: Record<string, any>) => (values.a as number) + 1,
                },
            },
        });
        m.on(ERROR, (e) => errors.push(e));

        // Triggering one side should surface a circular dependency error rather
        // than recursing forever.
        m.setField('a', 5);

        expect(
            errors.some((e) => e.kind === 'reaction' && /Circular/i.test(e.message))
        ).toBe(true);
        m.dispose();
    });
});
