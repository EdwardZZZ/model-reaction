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

describe('library ↔ page-agent end-to-end', () => {
    let dispose: () => void = () => {};

    afterEach(() => {
        dispose();
        dispose = () => {};
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

        // Capture the library-assigned instance id (a module-level counter, so
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
