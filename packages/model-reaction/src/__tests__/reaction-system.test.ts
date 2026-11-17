import { createModel, ModelEvents, Reaction, SKIP_REACTION } from '../index';

describe('reaction computation', () => {
    test('shares a reaction definition between distinct targets', () => {
        const computed = jest.fn(({ input }) => input * 2);
        const reaction: Reaction<number> = { fields: ['input', 'input'], computed };
        const model = createModel({
            input: { type: 'number' },
            left: { type: 'number', reaction },
            right: { type: 'number', reaction },
        });
        model.setField('input', 3);
        expect(model.data).toEqual({ input: 3, left: 6, right: 6 });
        expect(computed).toHaveBeenCalledTimes(2);
        model.dispose();
    });

    test('does not initialize a target without seeded dependencies', () => {
        const computed = jest.fn(() => 'updated');
        const model = createModel({
            input: { type: 'string' },
            target: { type: 'string', default: 'initial', reaction: { fields: ['input'], computed } },
        });
        expect(computed).not.toHaveBeenCalled();
        expect(model.data.target).toBe('initial');
        model.dispose();
    });

    test('passes legitimate undefined dependencies without an error', () => {
        const model = createModel({
            input: { type: 'number' },
            trigger: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input', 'trigger'], computed: ({ input }) => input ?? 0 } },
        });
        const error = jest.fn();
        model.on(ModelEvents.DEPENDENCY_ERROR, error);
        model.setField('trigger', 1);
        expect(model.data.target).toBe(0);
        expect(error).not.toHaveBeenCalled();
        model.dispose();
    });

    test('reports a missing dependency and supplies undefined', () => {
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input', 'missing'], computed: ({ missing }) => missing ?? 7 } },
        });
        const error = jest.fn();
        model.on(ModelEvents.DEPENDENCY_ERROR, error);
        model.setField('input', 1);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'dependency_error', field: 'target' }));
        expect(model.data.target).toBe(7);
        model.dispose();
    });

    test('detects runtime cycles without claiming cycles in independent batch paths', () => {
        const model = createModel({
            a: { type: 'number', reaction: { fields: ['b'], computed: ({ b }) => b + 1 } },
            b: { type: 'number', reaction: { fields: ['a'], computed: ({ a }) => a + 1 } },
        });
        const error = jest.fn();
        model.on(ModelEvents.REACTION_ERROR, error);
        model.setField('a', 1);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'circular_dependency' }));
        model.dispose();

        const independent = createModel({
            a: { type: 'number' },
            b: { type: 'number' },
            c: { type: 'number', reaction: { fields: ['a'], computed: ({ a }) => a + 1 } },
            d: { type: 'number', reaction: { fields: ['b', 'c'], computed: ({ b, c }) => b + c } },
        });
        const onError = jest.fn();
        independent.on(ModelEvents.REACTION_ERROR, onError);
        independent.setFields({ a: 1, b: 2 });
        expect(independent.data.d).toBe(4);
        expect(onError).not.toHaveBeenCalled();
        independent.dispose();
    });

    test.each([[[]], [[{ fields: [], computed: () => 1 }]]])('rejects reaction arrays before initialization (%p)', (reaction) => {
        expect(() => createModel({ target: { type: 'number', reaction } } as any)).toThrow('single reaction');
    });

    test('SKIP_REACTION skips transforms, writes, actions and downstream work', async () => {
        const transform = jest.fn(Number), action = jest.fn(), downstream = jest.fn(() => 3);
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', default: 1, transform, reaction: { fields: ['input'], computed: () => SKIP_REACTION, action: [action] } },
            downstream: { type: 'number', reaction: { fields: ['target'], computed: downstream } },
        });
        const listener = jest.fn();
        model.subscribe((data) => data.target, listener);
        model.setField('input', 2);
        await model.settled();
        expect(model.data.target).toBe(1);
        for (const callback of [transform, action, downstream, listener]) expect(callback).not.toHaveBeenCalled();
        model.dispose();
    });

    test('a later skip preserves the earlier synchronous computation and cancels its action', async () => {
        const action = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input'], computed: ({ input }) => input === 2 ? SKIP_REACTION : input, action: [action] } },
        });
        model.setField('input', 1);
        model.setField('input', 2);
        await model.settled();
        expect(model.data.target).toBe(1);
        expect(action).not.toHaveBeenCalled();
        model.dispose();
    });

    test.each([false, true])('reports Promise computed values without unhandled rejections (reject %s)', async (reject) => {
        const action = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: {
                type: 'number', default: 0,
                reaction: { fields: ['input'], computed: () => reject ? Promise.reject(new Error('bad')) : Promise.resolve(2), action: [action] },
            },
        } as any);
        const error = jest.fn();
        model.on(ModelEvents.REACTION_ERROR, error);
        model.setField('input', 1);
        await model.settled();
        expect(model.data.target).toBe(0);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('must return synchronously') }));
        expect(action).not.toHaveBeenCalled();
        model.dispose();
    });

    test.each([null, undefined, 'offline', new Error('failed')])('normalizes computation failure %p and recovers', async (reason) => {
        const action = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', default: 0, reaction: {
                fields: ['input'],
                computed: ({ input }) => { if (input === 1) throw reason; return input; },
                action: [action],
            } },
        });
        const error = jest.fn();
        model.on(ModelEvents.REACTION_ERROR, error);
        model.setField('input', 1);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({
            code: 'reaction_error', field: 'target',
            message: reason instanceof Error ? reason.message : String(reason), originalError: expect.any(Error),
        }));
        expect(model.data.target).toBe(0);
        model.setField('input', 2);
        await model.settled();
        expect(model.data.target).toBe(2);
        expect(action).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test('reports a computed transform failure and keeps the target unchanged', () => {
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', default: 0, transform: () => { throw new Error('bad transform'); }, reaction: { fields: ['input'], computed: () => 2 } },
        });
        const error = jest.fn();
        model.on(ModelEvents.REACTION_ERROR, error);
        model.setField('input', 1);
        expect(model.data.target).toBe(0);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'bad transform' }));
        model.dispose();
    });

    test.each(['computed', 'transform', 'listener'])('does not continue after disposal from %s', async (stage) => {
        const action = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: {
                type: 'number', default: 0,
                transform: (value) => { if (stage === 'transform') model.dispose(); return value; },
                reaction: { fields: ['input'], computed: () => { if (stage === 'computed') model.dispose(); return 2; }, action: [action] },
            },
        });
        if (stage === 'listener') model.subscribe((data) => data.target, () => model.dispose());
        model.setField('input', 1);
        await model.settled();
        expect(model.data).toEqual({});
        expect(action).not.toHaveBeenCalled();
    });

    test('computes every changed input synchronously before returning', () => {
        const computed = jest.fn(({ input }) => input * 2);
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', default: 0, reaction: { fields: ['input'], computed } },
        });
        try {
            model.setField('input', 1);
            expect(model.data.target).toBe(2);
            expect(computed).toHaveBeenCalledTimes(1);
            model.setField('input', 2);
            expect(model.data.target).toBe(4);
            expect(computed).toHaveBeenCalledTimes(2);
        } finally {
            model.dispose();
        }
    });
});
