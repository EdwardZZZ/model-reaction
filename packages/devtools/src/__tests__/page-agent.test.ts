import { installAgent } from '../page-agent';
import {
    AGENT_SOURCE,
    PANEL_SOURCE,
    isAgentMessage,
    isPanelMessage,
    type AgentMessage,
    type PanelMessage,
} from '../protocol';

/** A controllable fake of the library's `DevtoolsModelInstance`. */
function makeFakeInstance(id: number) {
    let listener: ((c: { field: string; value: unknown; timestamp: number }) => void) | null = null;
    const data: Record<string, unknown> = { firstName: '', fullName: '' };
    return {
        id,
        getFields: () => ({
            firstName: { type: 'string', hasDefault: true, validatorCount: 0, reactionDeps: [] },
            fullName: {
                type: 'string',
                hasDefault: true,
                validatorCount: 0,
                reactionDeps: ['firstName'],
            },
        }),
        getDependencyGraph: () => ({
            nodes: ['firstName', 'fullName'],
            edges: [{ from: 'firstName', to: 'fullName' }],
        }),
        getSnapshot: () => ({ data: { ...data }, dirtyData: {}, errors: {} }),
        subscribe: (l: (c: { field: string; value: unknown; timestamp: number }) => void) => {
            listener = l;
            return () => {
                listener = null;
            };
        },
        // test helper
        emitChange(field: string, value: unknown) {
            data[field] = value;
            listener?.({ field, value, timestamp: Date.now() });
        },
    };
}

type Hook = {
    register(instance: unknown): void;
    unregister(id: number): void;
};

/** Collect agent → panel messages posted on the window. */
function collectAgentMessages(): AgentMessage[] {
    const received: AgentMessage[] = [];
    window.addEventListener('message', (e: MessageEvent) => {
        if (isAgentMessage(e.data)) received.push(e.data);
    });
    return received;
}

function getHook(): Hook {
    const hook = (window as unknown as Record<string, Hook | undefined>)
        .__MODEL_REACTION_DEVTOOLS_HOOK__;
    if (!hook) throw new Error('hook not installed');
    return hook;
}

/** Resolve after a macrotask so async `window.postMessage` delivery lands. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('protocol guards', () => {
    test('isAgentMessage / isPanelMessage discriminate by source', () => {
        expect(isAgentMessage({ source: AGENT_SOURCE, kind: 'init', instances: [] })).toBe(true);
        expect(isPanelMessage({ source: PANEL_SOURCE, kind: 'get-init' })).toBe(true);
        expect(isAgentMessage({ source: PANEL_SOURCE })).toBe(false);
        expect(isPanelMessage(null)).toBe(false);
        expect(isAgentMessage(42)).toBe(false);
    });
});

describe('page agent', () => {
    let dispose: () => void = () => {};

    afterEach(() => {
        dispose();
        dispose = () => {};
    });

    test('installs a global hook satisfying the library contract', () => {
        dispose = installAgent(window);
        const hook = getHook();
        expect(typeof hook.register).toBe('function');
        expect(typeof hook.unregister).toBe('function');
    });

    test('does not reinstall over an existing hook', () => {
        dispose = installAgent(window);
        const first = getHook();
        const noop = installAgent(window);
        expect(getHook()).toBe(first);
        noop();
    });

    test('emits instance-added on register and instance-removed on unregister', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const inst = makeFakeInstance(1);
        getHook().register(inst);
        getHook().unregister(1);
        await flush();

        const kinds = received.map((m) => m.kind);
        expect(kinds).toContain('instance-added');
        expect(kinds).toContain('instance-removed');
    });

    test('forwards changes and refreshed snapshots', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const inst = makeFakeInstance(2);
        getHook().register(inst);
        inst.emitChange('firstName', 'Ada');
        await flush();

        const change = received.find(
            (m): m is Extract<AgentMessage, { kind: 'change' }> => m.kind === 'change'
        );
        expect(change?.change.field).toBe('firstName');
        expect(change?.change.value).toEqual({ t: 'primitive', v: 'Ada' });

        const snap = received.find(
            (m): m is Extract<AgentMessage, { kind: 'snapshot' }> => m.kind === 'snapshot'
        );
        expect(snap?.snapshot.data.firstName).toEqual({ t: 'primitive', v: 'Ada' });
    });

    test('timeline ring buffer respects the cap', async () => {
        dispose = installAgent(window, 3);
        const inst = makeFakeInstance(3);
        getHook().register(inst);
        for (let i = 0; i < 10; i++) inst.emitChange('firstName', `v${i}`);

        // Ask for a fresh init and inspect the timeline length. Two async hops:
        // panel→agent (get-init), then agent→panel (init).
        const received = collectAgentMessages();
        window.postMessage({ source: PANEL_SOURCE, kind: 'get-init' } as PanelMessage, '*');
        await flush();
        await flush();

        const init = received.find(
            (m): m is Extract<AgentMessage, { kind: 'init' }> => m.kind === 'init'
        );
        const timeline = init?.instances[0]?.timeline ?? [];
        expect(timeline).toHaveLength(3);
        // Kept the last three (seq 7,8,9).
        expect(timeline.map((c) => c.seq)).toEqual([7, 8, 9]);
    });

    test('answers get-snapshot for a known instance', async () => {
        dispose = installAgent(window);
        const inst = makeFakeInstance(4);
        getHook().register(inst);
        inst.emitChange('firstName', 'Grace');

        const received = collectAgentMessages();
        window.postMessage({ source: PANEL_SOURCE, kind: 'get-snapshot', id: 4 } as PanelMessage, '*');
        await flush();
        await flush();

        const snap = received.find(
            (m): m is Extract<AgentMessage, { kind: 'snapshot' }> => m.kind === 'snapshot'
        );
        expect(snap?.snapshot.data.firstName).toEqual({
            t: 'primitive',
            v: 'Grace',
        });
    });

    test('ignores get-snapshot for an unknown instance', async () => {
        dispose = installAgent(window);
        const received = collectAgentMessages();
        window.postMessage(
            { source: PANEL_SOURCE, kind: 'get-snapshot', id: 999 } as PanelMessage,
            '*'
        );
        await flush();
        await flush();

        expect(received.some((m) => m.kind === 'snapshot')).toBe(false);
    });
});
