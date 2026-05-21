import { createModel, Model, Rule, ValidationRules, ErrorHandler, ErrorType } from '../index';

// =============================================================================
// Tests for H1–H8 high-severity fixes
// =============================================================================

describe('H1: settled() waits for in-flight async reactions when debounceReactions=0', () => {
    test('settled() should not resolve until all chained async reactions finish', async () => {
        interface S { a: number; b: number; c: number; }
        const schema: Model<S> = {
            a: { type: 'number', default: 0 },
            b: {
                type: 'number',
                default: 0,
                reaction: { fields: ['a'], computed: deps => deps.a + 1 }
            },
            c: {
                type: 'number',
                default: 0,
                reaction: { fields: ['b'], computed: deps => deps.b + 1 }
            }
        };

        // No debounce -> previously settled() returned immediately while
        // chained reactions were still in flight.
        const model = createModel<S>(schema, { debounceReactions: 0 });

        await model.setField('a', 10);
        await model.settled();

        expect(model.getField('b')).toBe(11);
        expect(model.getField('c')).toBe(12);
        model.dispose();
    });

    test('settled() resolves only after async reaction.action microtasks finish', async () => {
        const trace: string[] = [];
        interface S { a: number; b: number; }
        const schema: Model<S> = {
            a: { type: 'number', default: 0 },
            b: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['a'],
                    computed: deps => deps.a * 2,
                    action: vals => { trace.push(`b=${vals.computed}`); }
                }
            }
        };
        const model = createModel<S>(schema);
        await model.setField('a', 5);
        await model.settled();
        expect(trace).toContain('b=10');
        model.dispose();
    });
});

describe('H2: processReaction uses schema (not value) to detect missing deps', () => {
    test('legitimate undefined value in dep should NOT trigger DEPENDENCY_ERROR', async () => {
        const errorHandler = new ErrorHandler();
        const depErrors: string[] = [];
        errorHandler.onError(ErrorType.DEPENDENCY_ERROR, e => {
            depErrors.push(e.message);
        });

        interface S { source: any; mirror: any; }
        const schema: Model<S> = {
            // intentionally no default, so source is undefined initially
            source: { type: 'string' },
            mirror: {
                type: 'string',
                reaction: {
                    fields: ['source'],
                    computed: deps => deps.source ?? 'fallback'
                }
            }
        };
        const model = createModel<S>(schema, { errorHandler });

        // Trigger reaction by setting source to undefined explicitly
        await model.setField('source', undefined);
        await model.settled();

        expect(depErrors).toHaveLength(0);
        model.dispose();
    });

    test('truly missing schema field DOES trigger DEPENDENCY_ERROR', async () => {
        const errorHandler = new ErrorHandler();
        const depErrors: string[] = [];
        errorHandler.onError(ErrorType.DEPENDENCY_ERROR, e => {
            depErrors.push(e.message);
        });

        interface S { existing: number; derived: number; }
        const schema: Model<S> = {
            existing: { type: 'number', default: 1 },
            derived: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['existing', 'ghost'],
                    computed: deps => (deps.existing || 0) + (deps.ghost || 0)
                }
            }
        };
        const model = createModel<S>(schema, { errorHandler });
        await model.setField('existing', 2);
        await model.settled();

        expect(depErrors.length).toBeGreaterThan(0);
        expect(depErrors[0]).toMatch(/ghost/);
        model.dispose();
    });
});

describe('H3: validator.condition guard semantics', () => {
    test('condition returning false skips the validator', async () => {
        interface S { hasDiscount: boolean; code: string; }
        const schema: Model<S> = {
            hasDiscount: { type: 'boolean', default: false },
            code: {
                type: 'string',
                default: '',
                validator: [
                    {
                        type: 'required',
                        message: 'Code is required when discount enabled',
                        validate: v => v !== '',
                        condition: data => data.hasDiscount === true
                    }
                ]
            }
        };
        const model = createModel<S>(schema);

        // hasDiscount=false -> condition returns false -> skip -> empty code is OK
        const ok = await model.validateAll();
        expect(ok).toBe(true);

        // turn on discount, empty code should now fail
        await model.setField('hasDiscount', true);
        const ok2 = await model.validateAll();
        expect(ok2).toBe(false);
        model.dispose();
    });

    test('condition returning true runs the validator (no falsy-data skip)', async () => {
        // Direct check: when data is empty object, condition still fully drives the decision
        interface S { x: string; }
        const schema: Model<S> = {
            x: {
                type: 'string',
                default: '',
                validator: [
                    {
                        type: 'always',
                        message: 'always fail',
                        validate: () => false,
                        condition: () => true
                    }
                ]
            }
        };
        const model = createModel<S>(schema);
        const ok = await model.validateAll();
        expect(ok).toBe(false);
        model.dispose();
    });
});

describe('H4: Rule.validate signature accepts data parameter', () => {
    test('Rule callback receives cross-field data', async () => {
        let receivedData: any = null;
        const rule = new Rule(
            'crossField',
            'mismatch',
            (value, data) => {
                receivedData = data;
                return value === data?.expected;
            }
        );

        interface S { expected: string; actual: string; }
        const schema: Model<S> = {
            expected: { type: 'string', default: 'hello' },
            actual: {
                type: 'string',
                default: 'hello',
                validator: [rule]
            }
        };
        const model = createModel<S>(schema);
        await model.setField('actual', 'hello');
        expect(receivedData).toBeDefined();
        expect(receivedData.expected).toBe('hello');

        const fail = await model.setField('actual', 'world');
        expect(fail).toBe(false);
        model.dispose();
    });
});

describe('H5: Rule exposes condition and .when() chaining', () => {
    test('Rule constructor accepts condition', async () => {
        const rule = new Rule(
            'required',
            'required when active',
            v => v !== '',
            data => data.active === true
        );

        interface S { active: boolean; field: string; }
        const schema: Model<S> = {
            active: { type: 'boolean', default: false },
            field: { type: 'string', default: '', validator: [rule] }
        };
        const model = createModel<S>(schema);

        // active=false -> rule skipped
        expect(await model.validateAll()).toBe(true);

        await model.setField('active', true);
        expect(await model.validateAll()).toBe(false);
        model.dispose();
    });

    test('.when() builds a new conditional Rule preserving validate', async () => {
        const baseRule = ValidationRules.required.withMessage('needs value');
        const conditional = baseRule.when(data => data.toggle === true);

        expect(conditional).toBeInstanceOf(Rule);
        expect(conditional.condition).toBeDefined();
        expect(conditional.message).toBe('needs value');

        interface S { toggle: boolean; v: string; }
        const model = createModel<S>({
            toggle: { type: 'boolean', default: false },
            v: { type: 'string', default: '', validator: [conditional] }
        });

        expect(await model.validateAll()).toBe(true);
        await model.setField('toggle', true);
        expect(await model.validateAll()).toBe(false);
        model.dispose();
    });
});

describe('H6: built-in rules type-guard against unexpected types', () => {
    test('min rejects string/array even if JS coercion would pass', async () => {
        const rule = ValidationRules.min(3);
        // Numeric path: passes
        expect(await rule.validate(5)).toBe(true);
        expect(await rule.validate(2)).toBe(false);
        // Non-numeric: must NOT pass via coercion
        expect(await rule.validate('5' as any)).toBe(false);
        expect(await rule.validate([5] as any)).toBe(false);
        expect(await rule.validate(null as any)).toBe(false);
        expect(await rule.validate(undefined as any)).toBe(false);
        expect(await rule.validate(NaN as any)).toBe(false);
    });

    test('number rejects NaN and non-number', async () => {
        expect(await ValidationRules.number.validate(1)).toBe(true);
        expect(await ValidationRules.number.validate(NaN)).toBe(false);
        expect(await ValidationRules.number.validate('1' as any)).toBe(false);
    });

    test('integer / max / minLength / maxLength / pattern / boolean / string work', async () => {
        expect(await ValidationRules.integer.validate(3)).toBe(true);
        expect(await ValidationRules.integer.validate(3.5)).toBe(false);

        const max = ValidationRules.max(10);
        expect(await max.validate(10)).toBe(true);
        expect(await max.validate(11)).toBe(false);
        expect(await max.validate('5' as any)).toBe(false);

        const minLen = ValidationRules.minLength(2);
        expect(await minLen.validate('ab')).toBe(true);
        expect(await minLen.validate('a')).toBe(false);
        expect(await minLen.validate([1, 2])).toBe(true);
        expect(await minLen.validate(123 as any)).toBe(false);

        const maxLen = ValidationRules.maxLength(2);
        expect(await maxLen.validate('ab')).toBe(true);
        expect(await maxLen.validate('abc')).toBe(false);

        const pat = ValidationRules.pattern(/^\d+$/, 'digits only');
        expect(await pat.validate('123')).toBe(true);
        expect(await pat.validate('12a')).toBe(false);
        expect(pat.message).toBe('digits only');

        expect(await ValidationRules.boolean.validate(true)).toBe(true);
        expect(await ValidationRules.boolean.validate('true' as any)).toBe(false);

        expect(await ValidationRules.string.validate('hi')).toBe(true);
        expect(await ValidationRules.string.validate(1 as any)).toBe(false);
    });
});

describe('H8: stale async validator errors are guarded by request id', () => {
    test('slow stale validator should NOT push errors after a newer request resolves', async () => {
        let firstResolve: ((v: boolean) => void) | null = null;
        let secondResolve: ((v: boolean) => void) | null = null;
        let call = 0;

        interface S { f: string; }
        const schema: Model<S> = {
            f: {
                type: 'string',
                default: '',
                validator: [
                    {
                        type: 'asyncCheck',
                        message: 'async failed',
                        validate: () => new Promise<boolean>(resolve => {
                            call++;
                            if (call === 1) {
                                firstResolve = resolve;
                            } else {
                                secondResolve = resolve;
                            }
                        })
                    }
                ]
            }
        };
        const model = createModel<S>(schema);

        // Fire two overlapping setField calls
        const p1 = model.setField('f', 'old');
        const p2 = model.setField('f', 'new');

        // Resolve #2 first as success -> commits 'new'
        await Promise.resolve();
        await Promise.resolve();
        expect(secondResolve).toBeTruthy();
        secondResolve!(true);
        expect(await p2).toBe(true);

        // Now stale #1 resolves as failure -> must NOT pollute current errors
        expect(firstResolve).toBeTruthy();
        firstResolve!(false);
        expect(await p1).toBe(false);

        // current errors should still be clean for f
        expect(model.validationErrors.f || []).toEqual([]);
        expect(model.getField('f')).toBe('new');
        model.dispose();
    });
});
