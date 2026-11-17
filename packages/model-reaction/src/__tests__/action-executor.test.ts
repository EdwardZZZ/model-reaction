import { createModel, ModelEvents, ReactionAction, SKIP_REACTION } from '../index';
import { ActionExecutor } from '../reaction/action-executor';
import { PendingTasks } from '../core/pending-tasks';

function deferred() {
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('action groups', () => {
    test('defers initialization until the model closure exists and reads transformed values', async () => {
        const observed: number[] = [];
        const model = createModel({
            input: { type: 'number', default: 2 },
            target: { type: 'number', transform: (value) => value + 1, reaction: {
                fields: ['input'], computed: ({ input }) => input * 2,
                action: [() => { observed.push(model.data.target!); }],
            } },
        });
        expect(model.data.target).toBe(5);
        expect(observed).toEqual([]);
        await model.settled();
        expect(observed).toEqual([5]);
        model.dispose();
    });

    test('runs only the final cascading groups', async () => {
        const observed: number[] = [];
        const model = createModel({
            input: { type: 'number' },
            doubled: { type: 'number', reaction: { fields: ['input'], computed: ({ input }) => input * 2 } },
            total: { type: 'number', reaction: {
                fields: ['input', 'doubled'], computed: ({ input, doubled }) => input + doubled,
                action: [() => { observed.push(model.data.total!); }],
            } },
        });
        model.setField('input', 1);
        model.setField('input', 2);
        await model.settled();
        expect(observed).toEqual([6]);
        model.dispose();
    });

    test.each(['skip', 'throw'])('a successor that %s cancels an unstarted group', async (successor) => {
        const action = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: {
                fields: ['input'],
                computed: ({ input }) => {
                    if (input === 2) {
                        if (successor === 'throw') throw new Error('failed');
                        return SKIP_REACTION;
                    }
                    return input;
                },
                action: [action],
            } },
        });
        model.setField('input', 1);
        model.setField('input', 2);
        await model.settled();
        expect(model.data.target).toBe(1);
        expect(action).not.toHaveBeenCalled();
        model.dispose();
    });

    test.each([true, false])('direct changed write invalidates remaining actions; equal write retains them (%s)', async (changed) => {
        const gate = deferred(), later = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: {
                fields: ['input'], computed: ({ input }) => input,
                action: [() => gate.promise, later],
            } },
        });
        model.setField('input', 1);
        await flush();
        model.setField('target', changed ? 2 : 1);
        gate.resolve();
        await model.settled();
        expect(later).toHaveBeenCalledTimes(changed ? 0 : 1);
        model.dispose();
    });

    test('starts a new version while an older item runs and tracks both promises', async () => {
        const old = deferred(), next = deferred(), observed: number[] = [];
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: {
                fields: ['input'], computed: ({ input }) => input,
                action: [(): Promise<void> => {
                    const value = model.data.target!;
                    observed.push(value);
                    return value === 1 ? old.promise : next.promise;
                }, () => { observed.push(model.data.target! * 10); }],
            } },
        });
        model.setField('input', 1);
        await flush();
        model.setField('input', 2);
        await flush();
        expect(observed).toEqual([1, 2]);
        next.resolve();
        await flush();
        expect(observed).toEqual([1, 2, 20]);
        let done = false;
        const settled = model.settled().then(() => { done = true; });
        await flush();
        expect(done).toBe(false);
        old.resolve();
        await settled;
        expect(observed).toEqual([1, 2, 20]);
        model.dispose();
    });

    test('checks the calculation barrier between items after an unrelated write', async () => {
        const observed: number[] = [];
        const model = createModel({
            input: { type: 'number' },
            unrelated: { type: 'number', default: 0 },
            derived: { type: 'number', default: 0, reaction: { fields: ['unrelated'], computed: ({ unrelated }) => unrelated * 2 } },
            target: { type: 'number', reaction: {
                fields: ['input'], computed: ({ input }) => input,
                action: [() => { model.setField('unrelated', 3); }, () => { observed.push(model.data.derived); }],
            } },
        });
        model.setField('input', 1);
        await model.settled();
        expect(observed).toEqual([6]);
        model.dispose();
    });

    test('starts ready groups in schema order and waits for each independently', async () => {
        const gate = deferred(), observed: string[] = [];
        const model = createModel({
            input: { type: 'number' },
            first: { type: 'number', reaction: { fields: ['input'], computed: () => 1, action: [
                () => { observed.push('first'); return gate.promise; },
                () => { observed.push('first done'); },
            ] } },
            second: { type: 'number', reaction: { fields: ['input'], computed: () => 2, action: [() => { observed.push('second'); }] } },
        });
        model.setField('input', 1);
        await flush();
        expect(observed).toEqual(['first', 'second']);
        gate.resolve();
        await model.settled();
        expect(observed).toEqual(['first', 'second', 'first done']);
        model.dispose();
    });

    test.each([false, true])('isolates action failure, stops its group and emits an error before settling (%s)', async (asyncFailure) => {
        const later = jest.fn(), other = jest.fn(), errors: string[] = [];
        const model = createModel({
            input: { type: 'number' },
            first: { type: 'number', reaction: { fields: ['input'], computed: () => 1, action: [
                () => { if (asyncFailure) return Promise.reject('offline'); throw 'offline'; }, later,
            ] } },
            second: { type: 'number', reaction: { fields: ['input'], computed: () => 2, action: [other] } },
        });
        model.on(ModelEvents.REACTION_ERROR, (error) => errors.push(error.message));
        model.setField('input', 1);
        await model.settled();
        expect(errors).toEqual(['offline']);
        expect(later).not.toHaveBeenCalled();
        expect(other).toHaveBeenCalledTimes(1);
        model.dispose();
    });

    test('reports late old failures without cancelling a newer version', async () => {
        const old = deferred(), later = jest.fn(), error = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input'], computed: ({ input }) => input,
                action: [(): Promise<void> | undefined => model.data.target === 1 ? old.promise : undefined, later],
            } },
        });
        model.on(ModelEvents.REACTION_ERROR, error);
        model.setField('input', 1);
        await flush();
        model.setField('input', 2);
        await flush();
        old.reject(new Error('late failure'));
        await model.settled();
        expect(later).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ field: 'target', message: 'late failure' }));
        model.dispose();
    });

    test('disposal releases settled and observes an old rejection without more actions or events', async () => {
        const gate = deferred(), later = jest.fn(), error = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input'], computed: () => 1, action: [() => gate.promise, later] } },
        });
        model.on(ModelEvents.REACTION_ERROR, error);
        model.setField('input', 1);
        await flush();
        const settled = model.settled();
        model.dispose();
        await settled;
        gate.reject(new Error('late'));
        await flush();
        expect(later).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    test('equal computations still run actions and call them without arguments', async () => {
        const action = jest.fn();
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', default: 1, reaction: { fields: ['input'], computed: () => 1, action: [action] } },
        });
        model.setField('input', 1);
        await model.settled();
        model.setField('input', 2);
        await model.settled();
        expect(action.mock.calls).toEqual([[], []]);
        model.dispose();
    });

    test('dedupes shared functions at their last array position and last host registration', async () => {
        const calls: string[] = [];
        const shared = () => { calls.push('shared'); };
        const model = createModel({
            input: { type: 'number' },
            first: { type: 'number', reaction: { fields: ['input'], computed: () => 1, action: [shared] } },
            second: { type: 'number', reaction: { fields: ['input'], computed: () => 2, action: [
                shared, () => { calls.push('middle'); }, shared,
            ] } },
        });
        model.setField('input', 1);
        await model.settled();
        expect(calls).toEqual(['middle', 'shared']);
        model.dispose();
    });

    test('keeps captured snapshots while later items see synchronous writeback', async () => {
        const observed: number[] = [];
        let captured: Readonly<{ input: number; target: number }> | undefined;
        const model = createModel<{ input: number; target: number }>({
            input: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input'], computed: ({ input }) => input, action: [
                () => {
                    if (!captured) {
                        captured = model.data;
                        model.setField('input', 2);
                    }
                },
                () => { observed.push(model.data.target); },
            ] } },
        });
        model.setField('input', 1);
        await model.settled();
        expect(captured!.target).toBe(1);
        expect(observed).toEqual([2]);
        model.dispose();
    });

    test.each([false, true])('awaits custom PromiseLike action values (reject %s)', async (reject) => {
        const later = jest.fn(), error = jest.fn();
        const thenable: PromiseLike<void> = {
            then: (ok, fail) => (reject ? Promise.reject(new Error('thenable')) : Promise.resolve()).then(ok, fail),
        };
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input'], computed: () => 1, action: [() => thenable, later] } },
        });
        model.on(ModelEvents.REACTION_ERROR, error);
        model.setField('input', 1);
        await model.settled();
        expect(later).toHaveBeenCalledTimes(reject ? 0 : 1);
        expect(error).toHaveBeenCalledTimes(reject ? 1 : 0);
        model.dispose();
    });

    test('does not track business work an action does not return', async () => {
        const gate = deferred();
        let finished = false;
        const model = createModel({
            input: { type: 'number' },
            target: { type: 'number', reaction: { fields: ['input'], computed: () => 1, action: [
                () => { void gate.promise.then(() => { finished = true; }); },
            ] } },
        });
        model.setField('input', 1);
        await model.settled();
        expect(finished).toBe(false);
        gate.resolve();
        await flush();
        expect(finished).toBe(true);
        model.dispose();
    });

    test('rechecks compute activity after an idle notification', async () => {
        const tasks = new PendingTasks(), onError = jest.fn(), action = jest.fn();
        const executor = new ActionExecutor(['target'], tasks, onError);
        const job = { field: 'target', reaction: { fields: [], computed: () => 1, action: [action as ReactionAction] } };
        const endFirst = tasks.begin();
        executor.register(job, executor.invalidate('target'));
        endFirst();
        const endNext = tasks.begin();
        await flush();
        expect(action).not.toHaveBeenCalled();
        endNext();
        await tasks.settled();
        expect(action).toHaveBeenCalledTimes(1);
        executor.dispose();
        tasks.dispose();
    });
});
