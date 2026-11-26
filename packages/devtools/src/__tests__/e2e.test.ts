/**
 * @jest-environment jsdom
 *
 * True end-to-end test: the *real* library's DevTools entry
 * (`model-reaction/devtools`) registering against the *real* page agent
 * (`devtools/src/page-agent.ts`). The wrapper entry and the agent declare the
 * hook contract independently, so this guards against the two definitions
 * drifting apart — something the isolated unit tests (which use fakes on each
 * side) cannot catch.
 */
import { createModel } from 'model-reaction/devtools';
import { ValidationRules } from 'model-reaction/validation';
import { installAgent } from '../page-agent';
import {
    PANEL_SOURCE,
    isAgentMessage,
    type AgentMessage,
} from '../protocol';

function collect(): AgentMessage[] {
    const received: AgentMessage[] = [];
    window.addEventListener('message', (e: MessageEvent) => {
        if (isAgentMessage(e.data)) received.push(e.data);
    });
    return received;
}

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function getObserver(model: object): unknown {
    return (window as unknown as {
        __MODEL_REACTION_DEVTOOLS_HOOK__: { getDerivedObserver(model: object): unknown };
    }).__MODEL_REACTION_DEVTOOLS_HOOK__.getDerivedObserver(model);
}

async function getInit(received: AgentMessage[]) {
    window.postMessage({ source: PANEL_SOURCE, kind: 'get-init' }, '*');
    await flush();
    await flush();
    const inits = received.filter((message) => message.kind === 'init');
    return inits[inits.length - 1]!;
}

describe('library ↔ page-agent end-to-end', () => {
    let dispose: () => void = () => {};

    afterEach(() => {
        dispose();
        dispose = () => {};
    });

    test('unreadable committed and dirty values do not poison healthy models or survive disposal', async () => {
        class LazyValue {
            constructor() {
                Object.defineProperty(this, 'unloaded', {
                    enumerable: true,
                    get() { throw new Error('value is not loaded'); },
                });
            }
        }
        const unreadable = {
            t: 'object',
            entries: [['unloaded', { t: 'truncated', note: 'value could not be inspected' }]],
        };
        const received = collect();
        dispose = installAgent(window);
        const rejected = new LazyValue();
        const bad = createModel<{ payload: unknown }>({
            payload: {
                type: 'object', default: new LazyValue(),
                validator: [{ type: 'available', message: 'not available', validate: (v) => v !== rejected }],
            },
        });
        const healthy = createModel({ healthy: { type: 'number', default: 7 } });
        try {
            const initial = await getInit(received);
            expect(initial.instances).toHaveLength(2);
            expect(received.filter((message) => message.kind === 'instance-added')).toHaveLength(2);
            const badState = initial.instances.find((instance) => 'payload' in instance.fields)!;
            expect(badState.snapshot.data.payload).toEqual(unreadable);
            expect(badState.snapshot.truncated).toBe(true);
            expect(typeof getObserver(bad)).toBe('function');
            await bad.setField('payload', new LazyValue());
            await bad.setField('payload', { loaded: true });
            expect(await bad.setField('payload', rejected)).toBe(false);
            await healthy.setField('healthy', 8);
            const current = await getInit(received);
            const updated = current.instances.find((instance) => instance.id === badState.id)!;
            expect(updated.timeline).toHaveLength(2);
            expect(updated.timeline[0]).toMatchObject({ value: unreadable, previous: unreadable });
            expect(updated.timeline[1]).toMatchObject({
                previous: unreadable,
                value: { t: 'object', entries: [['loaded', { t: 'primitive', v: true }]] },
            });
            expect(updated.snapshot.dirtyData.payload).toEqual(unreadable);
            expect(updated.snapshot.errors.payload![0]!.message).toBe('not available');
            bad.dispose();
            expect(getObserver(bad)).toBeUndefined();
            const remaining = await getInit(received);
            expect(remaining.instances).toHaveLength(1);
            expect(remaining.instances[0]!.snapshot.data.healthy).toEqual({ t: 'primitive', v: 8 });
        } finally {
            bad.dispose();
            healthy.dispose();
        }
    });

    test('preserves built-in values in initial snapshots and timeline replacements', async () => {
        const received = collect();
        dispose = installAgent(window);
        const model = createModel({
            lookup: { type: 'object', default: new Map([['total', 42]]) },
            tags: { type: 'object', default: new Set(['paid']) },
            pattern: { type: 'object', default: /invoice/i },
        });
        try {
            const initial = (await getInit(received)).instances[0]!;
            expect(initial.snapshot.data).toEqual({
                lookup: { t: 'map', entries: [[{ t: 'primitive', v: 'total' }, { t: 'primitive', v: 42 }]] },
                tags: { t: 'set', items: [{ t: 'primitive', v: 'paid' }] },
                pattern: { t: 'regexp', source: 'invoice', flags: 'i' },
            });
            expect(initial.snapshot.truncated).toBeUndefined();
            await model.setField('lookup', new Map([['total', 99]]));
            await model.setField('tags', new Set(['pending']));
            await model.setField('pattern', /receipt/g);
            const current = (await getInit(received)).instances[0]!;
            expect(current.snapshot.data).toEqual({
                lookup: { t: 'map', entries: [[{ t: 'primitive', v: 'total' }, { t: 'primitive', v: 99 }]] },
                tags: { t: 'set', items: [{ t: 'primitive', v: 'pending' }] },
                pattern: { t: 'regexp', source: 'receipt', flags: 'g' },
            });
            expect(current.timeline.map(({ field, previous, value }) => ({ field, previous, value })))
                .toEqual(['lookup', 'tags', 'pattern'].map((field) => ({
                    field, previous: initial.snapshot.data[field], value: current.snapshot.data[field],
                })));
        } finally {
            model.dispose();
        }
    });

    test.each([0, 1])('retains independent wrapper observers and updates after disposing model %i', async (disposeFirst) => {
        const loadCopy = (): typeof createModel => {
            let copy!: typeof createModel;
            jest.isolateModules(() => {
                copy = jest.requireActual<typeof import('model-reaction/devtools')>('model-reaction/devtools').createModel;
            });
            return copy;
        };
        const firstCopy = loadCopy();
        const secondCopy = loadCopy();
        const received = collect();
        dispose = installAgent(window);
        const first = firstCopy({ value: { type: 'number', default: 1 } });
        const firstObserver = getObserver(first);
        const second = secondCopy({ value: { type: 'number', default: 2 } });
        const models = [first, second];
        try {
            expect(typeof firstObserver).toBe('function');
            expect(getObserver(first)).toBe(firstObserver);
            expect(getObserver(second)).not.toBe(firstObserver);
            const ids = (await getInit(received)).instances.map((instance) => instance.id);
            expect(new Set(ids).size).toBe(2);
            await first.setField('value', 11);
            await second.setField('value', 22);
            const states = (await getInit(received)).instances;
            expect(states.map((instance) => [instance.id, instance.timeline[0]!.value])).toEqual([
                [ids[0], { t: 'primitive', v: 11 }],
                [ids[1], { t: 'primitive', v: 22 }],
            ]);
            models[disposeFirst]!.dispose();
            expect(getObserver(models[disposeFirst]!)).toBeUndefined();
            const remaining = 1 - disposeFirst;
            await models[remaining]!.setField('value', 33);
            const live = (await getInit(received)).instances;
            expect(live).toHaveLength(1);
            expect(live[0]!.id).toBe(ids[remaining]);
            const timeline = live[0]!.timeline;
            expect(timeline[timeline.length - 1]!.value).toEqual({ t: 'primitive', v: 33 });
            expect(typeof getObserver(models[remaining]!)).toBe('function');
        } finally {
            models.forEach((model) => model.dispose());
        }
    });

    test('a real model registers, reports its graph, and streams changes', async () => {
        const received = collect();
        // Agent must be installed BEFORE createModel, exactly as in production.
        dispose = installAgent(window);

        const model = createModel({
            firstName: { type: 'string', default: '' },
            lastName: { type: 'string', default: '' },
            fullName: {
                type: 'string',
                default: '',
                reaction: {
                    fields: ['firstName', 'lastName'],
                    computed: (v) => `${v.firstName} ${v.lastName}`.trim(),
                },
            },
        });

        await flush();

        // 1. The library registered the instance through the global hook.
        const added = received.find(
            (m): m is Extract<AgentMessage, { kind: 'instance-added' }> =>
                m.kind === 'instance-added'
        );
        expect(added).toBeDefined();

        // 2. The dependency graph came through with the reaction edges.
        expect(added!.instance.graph.edges).toEqual(
            expect.arrayContaining([
                { from: 'firstName', to: 'fullName' },
                { from: 'lastName', to: 'fullName' },
            ])
        );
        expect(added!.instance.fields.fullName!.reactionDeps).toEqual([
            'firstName',
            'lastName',
        ]);

        // 3. A committed change is streamed and serialized.
        await model.setField('firstName', 'Ada');
        await model.settled();
        await flush();

        const change = received.find(
            (m): m is Extract<AgentMessage, { kind: 'change' }> =>
                m.kind === 'change' && m.change.field === 'firstName'
        );
        expect(change!.change.value).toEqual({ t: 'primitive', v: 'Ada' });
        expect(change!.change.previous).toEqual({ t: 'primitive', v: '' });

        // 4. The reaction's derived write is observed too (fullName recomputed).
        const reactionChange = received.find(
            (m): m is Extract<AgentMessage, { kind: 'change' }> =>
                m.kind === 'change' && m.change.field === 'fullName'
        );
        expect(reactionChange!.change.value).toEqual({ t: 'primitive', v: 'Ada' });
        expect(reactionChange!.change.previous).toEqual({ t: 'primitive', v: '' });

        model.dispose();
    });

    test('preserves previous values from defaults, after clear, and after earlier entries are evicted', async () => {
        const received = collect();
        dispose = installAgent(window, 1);
        const model = createModel({
            count: { type: 'number', default: 0 },
            label: { type: 'string', default: '' },
        });
        await flush();
        const added = received.find(
            (m): m is Extract<AgentMessage, { kind: 'instance-added' }> =>
                m.kind === 'instance-added'
        )!;
        const id = added.instance.id;

        await model.setField('count', 1);
        await model.settled();
        await flush();
        const first = received.find(
            (m): m is Extract<AgentMessage, { kind: 'change' }> => m.kind === 'change'
        )!;
        expect(first.change.previous).toEqual({ t: 'primitive', v: 0 });

        window.postMessage({ source: PANEL_SOURCE, kind: 'clear-timeline', id }, '*');
        await flush();
        await flush();
        expect(received.some((m) => m.kind === 'timeline-cleared' && m.id === id)).toBe(true);
        await model.setField('count', 2);
        await model.settled();
        await flush();
        const changes = received.filter(
            (m): m is Extract<AgentMessage, { kind: 'change' }> => m.kind === 'change'
        );
        const afterClear = changes[changes.length - 1]!;
        expect(afterClear.change.previous).toEqual({ t: 'primitive', v: 1 });

        await model.setField('label', 'evict count');
        await model.settled();
        await model.setField('count', 3);
        await model.settled();
        window.postMessage({ source: PANEL_SOURCE, kind: 'get-init' }, '*');
        await flush();
        await flush();
        const init = received.find(
            (m): m is Extract<AgentMessage, { kind: 'init' }> => m.kind === 'init'
        )!;
        expect(init.instances[0]!.timeline).toEqual([
            expect.objectContaining({
                field: 'count',
                value: { t: 'primitive', v: 3 },
                previous: { t: 'primitive', v: 2 },
            }),
        ]);
        model.dispose();
    });

    test('failed validation surfaces in the agent snapshot as dirtyData', async () => {
        const received = collect();
        dispose = installAgent(window);
        const model = createModel({
            email: {
                type: 'string',
                default: '',
                validator: [ValidationRules.email.withMessage('bad email')],
            },
        });
        await flush();

        // Capture the library-assigned instance id (a page-wide counter, so
        // it is not guaranteed to be 0 across a multi-test run).
        const added = received.find(
            (m): m is Extract<AgentMessage, { kind: 'instance-added' }> =>
                m.kind === 'instance-added'
        );
        const id = added!.instance.id;

        await model.setField('email', 'nope');
        await model.settled();

        // Rejected input must refresh automatically without a panel request.
        await flush();
        await flush();

        const snap = received.find(
            (m): m is Extract<AgentMessage, { kind: 'snapshot' }> =>
                m.kind === 'snapshot' && m.id === id
        );
        // The bad value lives in dirtyData, not data (verify-then-commit).
        expect(snap!.snapshot.dirtyData.email).toEqual({ t: 'primitive', v: 'nope' });
        expect(snap!.snapshot.errors.email!.length).toBeGreaterThan(0);
        expect(received.filter((m) => m.kind === 'change')).toHaveLength(0);

        model.clearDirtyData();
        await flush();
        await flush();
        const snapshots = received.filter(
            (m): m is Extract<AgentMessage, { kind: 'snapshot' }> => m.kind === 'snapshot'
        );
        expect(snapshots[snapshots.length - 1]?.snapshot.dirtyData).toEqual({});

        model.dispose();
    });

    test('shared function identity survives the real agent and JSON messaging', async () => {
        const received = collect();
        dispose = installAgent(window);
        function captureFullName() {}
        const sameName = { captureFullName() {} }.captureFullName;
        const model = createModel({
            source: { type: 'string', default: 'Ada' },
            fullName: { type: 'string', reaction: {
                fields: ['source'], computed: ({ source }) => source, action: [captureFullName, sameName],
            } },
            greeting: { type: 'string', reaction: {
                fields: ['fullName'], computed: ({ fullName }) => `Hello, ${fullName}!`, action: [captureFullName],
            } },
        });
        await flush();
        const added = received.find(
            (message): message is Extract<AgentMessage, { kind: 'instance-added' }> =>
                message.kind === 'instance-added'
        )!;
        const fields = JSON.parse(JSON.stringify(added.instance)).fields;
        expect(typeof fields.fullName.actions[0].functionId).toBe('number');
        expect(fields.fullName.actions[0].functionId).toBe(fields.greeting.actions[0].functionId);
        expect(fields.fullName.actions[0].functionId).not.toBe(fields.fullName.actions[1].functionId);
        model.dispose();
    });

    test('dispose unregisters the instance', async () => {
        const received = collect();
        dispose = installAgent(window);
        const model = createModel({ a: { type: 'string', default: '' } });
        await flush();
        model.dispose();
        await flush();

        expect(
            received.some((m) => m.kind === 'instance-removed')
        ).toBe(true);
    });
});
