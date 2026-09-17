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
import { ValidationRules } from 'model-reaction';
import { installAgent } from '../page-agent';
import {
    AGENT_SOURCE,
    PANEL_SOURCE,
    isAgentMessage,
    type AgentMessage,
    type PanelMessage,
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

        // 4. The reaction's derived write is observed too (fullName recomputed).
        const reactionChange = received.find(
            (m): m is Extract<AgentMessage, { kind: 'change' }> =>
                m.kind === 'change' && m.change.field === 'fullName'
        );
        expect(reactionChange!.change.value).toEqual({ t: 'primitive', v: 'Ada' });

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

        // Ask the agent for a fresh snapshot and read it back.
        window.postMessage(
            { source: PANEL_SOURCE, kind: 'get-snapshot', id } as PanelMessage,
            '*'
        );
        await flush();
        await flush();

        const snap = received.find(
            (m): m is Extract<AgentMessage, { kind: 'snapshot' }> =>
                m.kind === 'snapshot' && m.id === id
        );
        // The bad value lives in dirtyData, not data (verify-then-commit).
        expect(snap!.snapshot.dirtyData.email).toEqual({ t: 'primitive', v: 'nope' });
        expect(snap!.snapshot.errors.email!.length).toBeGreaterThan(0);

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
