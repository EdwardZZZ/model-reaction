/** Public API scenarios shared by README, API, Advanced, and React recipes. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModel, ModelEvents, SKIP_REACTION } from '../index';

describe('Public documentation scenarios', () => {
    test('synchronous batch writes derive a complete cart before returning', () => {
        const model = createModel({
            price: { type: 'number', default: 10 },
            qty: { type: 'number', default: 1, transform: Number },
            total: { type: 'number', reaction: {
                fields: ['price', 'qty'], computed: ({ price, qty }) => price * qty,
            } },
        });
        expect(model.data.total).toBe(10);
        expect(model.setFields({ price: 20, qty: 3 })).toBeUndefined();
        expect(model.data).toEqual({ price: 20, qty: 3, total: 60 });
        model.dispose();
    });

    test('a subscription can select a summary independently from unrelated fields', () => {
        const model = createModel({
            price: { type: 'number', default: 10 },
            qty: { type: 'number', default: 1 },
            note: { type: 'string', default: '' },
        });
        const changed = jest.fn();
        const off = model.subscribe((data) => data.qty * data.price, changed);
        model.setField('note', 'hello');
        model.setField('qty', 2);
        expect(changed).toHaveBeenCalledTimes(1);
        expect(changed).toHaveBeenCalledWith(20, 10);
        off();
        model.setField('qty', 3);
        expect(changed).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test('business preflight keeps rejected candidates outside the model', () => {
        const model = createModel({ budget: { type: 'number', default: 100 } });
        const updateBudget = (budget: number): string | null => {
            if (!Number.isFinite(budget) || budget < 100) return 'Budget must be at least 100';
            model.setField('budget', budget);
            return null;
        };
        expect(updateBudget(20)).toBe('Budget must be at least 100');
        expect(model.data.budget).toBe(100);
        expect(updateBudget(200)).toBeNull();
        expect(model.data.budget).toBe(200);
        model.dispose();
    });

    test('submission validates the settled business snapshot', async () => {
        const model = createModel({
            email: { type: 'string', default: '' },
            normalized: { type: 'string', reaction: {
                fields: ['email'], computed: ({ email }) => email.trim().toLowerCase(),
            } },
        });
        model.setField('email', ' USER@example.com ');
        await model.settled();
        const snapshot = model.data;
        const error = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.normalized ?? '')
            ? null : 'Invalid email';
        expect(error).toBeNull();
        expect(snapshot.normalized).toBe('user@example.com');
        model.dispose();
    });

    test('actions read the completed chain and their returned work is tracked', async () => {
        const seen: number[] = [];
        const model = createModel({
            source: { type: 'number', default: 2 },
            doubled: { type: 'number', reaction: {
                fields: ['source'], computed: ({ source }) => source * 2,
                action: [
                    async () => { await Promise.resolve(); seen.push(model.data.total!); },
                    () => { seen.push(model.data.total!); },
                ],
            } },
            total: { type: 'number', reaction: {
                fields: ['doubled'], computed: ({ doubled }) => doubled + 1,
            } },
        });
        expect(model.data.total).toBe(5);
        expect(seen).toEqual([]);
        await model.settled();
        expect(seen).toEqual([5, 5]);
        model.setField('source', 3);
        expect(model.data.total).toBe(7);
        await model.settled();
        expect(seen).toEqual([5, 5, 7, 7]);
        model.dispose();
    });

    test('action writeback recomputes dependencies before the next item', async () => {
        const seen: number[] = [];
        const model = createModel({
            source: { type: 'number' },
            input: { type: 'number', default: 0 },
            derived: { type: 'number', reaction: {
                fields: ['input'], computed: ({ input }) => input * 3,
            } },
            host: { type: 'number', reaction: {
                fields: ['source'], computed: ({ source }) => source,
                action: [
                    () => { model.setField('input', 4); },
                    () => { seen.push(model.data.derived!); },
                ],
            } },
        });
        await model.settled();
        model.setField('source', 1);
        await model.settled();
        expect(seen).toEqual([12]);
        model.dispose();
    });

    test('skip retains the last value and prevents action execution', async () => {
        const action = jest.fn();
        const model = createModel({
            source: { type: 'number' },
            target: { type: 'number', default: 10, reaction: {
                fields: ['source'],
                computed: ({ source }) => source < 0 ? SKIP_REACTION : source * 2,
                action: [action],
            } },
        });
        model.setField('source', -1);
        await model.settled();
        expect(model.data.target).toBe(10);
        expect(action).not.toHaveBeenCalled();
        model.setField('source', 2);
        await model.settled();
        expect(model.data.target).toBe(4);
        expect(action).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test('unknown batch keys are detected before transforms or commits', () => {
        const transform = jest.fn((value) => value);
        const model = createModel({ name: { type: 'string', default: '', transform } });
        const missing = jest.fn();
        model.on(ModelEvents.FIELD_NOT_FOUND, missing);
        expect(() => model.setFields({ name: 'Ada', unknown: 1 } as any)).toThrow('unknown');
        expect(transform).not.toHaveBeenCalled();
        expect(model.data.name).toBe('');
        expect(missing).toHaveBeenCalledWith(expect.objectContaining({ field: 'unknown' }));
        model.dispose();
    });

    test('computed transform failures emit reaction errors and leave the host unchanged', async () => {
        const action = jest.fn();
        const model = createModel({
            source: { type: 'number' },
            target: { type: 'number', default: 0,
                transform: () => { throw new Error('Cannot convert'); },
                reaction: { fields: ['source'], computed: ({ source }) => source, action: [action] },
            },
        });
        const errors = jest.fn();
        model.on(ModelEvents.REACTION_ERROR, errors);
        model.setField('source', 5);
        await model.settled();
        expect(model.data.source).toBe(5);
        expect(model.data.target).toBe(0);
        expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cannot convert' }));
        expect(action).not.toHaveBeenCalled();
        model.dispose();
    });

    test('public event constants contain only field and reaction diagnostics', () => {
        expect(Object.values(ModelEvents).sort()).toEqual([
            'dependency:error', 'field:change', 'field:not-found', 'reaction:error',
        ]);
    });

    test('published package includes guidance, documentation, and runnable recipes', () => {
        const root = resolve(__dirname, '../..');
        const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
        expect(pkg.files).toEqual(expect.arrayContaining(['AGENTS.md', 'docs', 'examples']));
        for (const file of ['README.md', 'README_CN.md']) {
            expect(readFileSync(resolve(root, file), 'utf8')).toContain('AGENTS.md');
        }
    });
});
