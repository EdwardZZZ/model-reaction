import { installAgent } from '../page-agent';
import {
    AGENT_SOURCE,
    PANEL_SOURCE,
    isAgentMessage,
    isPanelMessage,
    type AgentMessage,
    type PanelMessage,
    type DerivedValue,
} from '../protocol';

/** A controllable fake of the library's `DevtoolsModelInstance`. */
function makeFakeInstance(id: number) {
    let listener: ((c: { field: string; value: unknown; timestamp: number }) => void) | null = null;
    let snapshotListener: (() => void) | null = null;
    const data: Record<string, unknown> = { firstName: '', fullName: '' };
    let dirtyData: Record<string, unknown> = {};
    let errors: Record<string, Array<{ field: string; message: string }>> = {};
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
        getSnapshot: () => ({ data: { ...data }, dirtyData, errors }),
        subscribeSnapshot: (l: () => void) => {
            snapshotListener = l;
            return () => { snapshotListener = null; };
        },
        rejectInput() {
            dirtyData = { firstName: '' };
            errors = { firstName: [{ field: 'firstName', message: 'required' }] };
            snapshotListener?.();
        },
        clearDirty() {
            dirtyData = {};
            snapshotListener?.();
        },
        subscribe: (l: (c: { field: string; value: unknown; timestamp: number }) => void) => {
            listener = l;
            return () => {
                listener = null;
            };
        },
        emitChange(field: string, value: unknown) {
            data[field] = value;
            listener?.({ field, value, timestamp: Date.now() });
        },
    };
}

type Hook = {
    register(instance: unknown, model?: object): void;
    unregister(id: number): void;
    getDerivedObserver(model: object): unknown;
    updateDerived(model: object, token: object, selection: Omit<DerivedValue, 'id' | 'value'> & { value: unknown } | null): void;
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

    test.each(['subscribe', 'subscribeSnapshot', 'serialization', 'post'] as const)(
        'rolls back registration after a %s failure and allows a healthy retry',
        async (stage) => {
            const received: AgentMessage[] = [];
            const post = jest.spyOn(window, 'postMessage').mockImplementation((message: AgentMessage) => {
                received.push(message);
            });
            dispose = installAgent(window);
            const hook = getHook();
            const model = {};
            const inst = makeFakeInstance(30);
            const unsubscribe = jest.fn();
            const unsubscribeSnapshot = jest.fn();
            let lateChange: Parameters<typeof inst.subscribe>[0] = () => {};
            let lateSnapshot: () => void = () => {};
            const error = new Error(`${stage} failed`);
            const getSnapshot = jest.fn(inst.getSnapshot);
            if (stage === 'serialization') {
                getSnapshot.mockReturnValueOnce(inst.getSnapshot()).mockReturnValue({
                    ...inst.getSnapshot(),
                    dirtyData: new Proxy({}, { ownKeys() { throw error; } }),
                });
            }
            const failed = {
                ...inst,
                getSnapshot,
                observeSelector: jest.fn(),
                subscribe: jest.fn((listener: typeof lateChange) => {
                    lateChange = listener;
                    if (stage === 'subscribe') throw error;
                    return unsubscribe;
                }),
                subscribeSnapshot: jest.fn((listener: () => void) => {
                    lateSnapshot = listener;
                    if (stage === 'subscribeSnapshot') throw error;
                    return unsubscribeSnapshot;
                }),
            };
            if (stage === 'post') {
                post.mockImplementationOnce(() => {
                    lateSnapshot();
                    throw error;
                });
            }
            expect(() => hook.register(failed, model)).toThrow(error);
            expect(unsubscribe).toHaveBeenCalledTimes(stage === 'subscribe' ? 0 : 1);
            expect(unsubscribeSnapshot).toHaveBeenCalledTimes(
                stage === 'serialization' || stage === 'post' ? 1 : 0
            );
            expect(hook.getDerivedObserver(model)).toBeUndefined();
            received.length = 0;
            const healthy = makeFakeInstance(30);
            const healthyModel = {};
            const observer = jest.fn();
            hook.register({ ...healthy, observeSelector: observer }, healthyModel);
            expect(hook.getDerivedObserver(model)).toBeUndefined();
            expect(hook.getDerivedObserver(healthyModel)).toBe(observer);
            lateChange({ field: 'stale', value: 9, timestamp: 0 });
            lateSnapshot();
            healthy.emitChange('firstName', 'healthy');
            window.dispatchEvent(new MessageEvent('message', {
                data: { source: PANEL_SOURCE, kind: 'get-init' },
            }));
            await flush();
            const init = received.find((message) => message.kind === 'init')!;
            expect(init.instances).toHaveLength(1);
            expect(init.instances[0]!.timeline.map((change) => change.field)).toEqual(['firstName']);
            expect(received.filter((message) => message.kind === 'change')).toHaveLength(1);
            expect(received.filter((message) => message.kind === 'snapshot')).toHaveLength(1);
            hook.unregister(30);
            expect(hook.getDerivedObserver(healthyModel)).toBeUndefined();
        }
    );

    test('finishes rollback even if an acquired subscription throws during cleanup', () => {
        dispose = installAgent(window);
        const hook = getHook();
        const model = {};
        const cleanup = jest.fn(() => { throw new Error('cleanup failed'); });
        const snapshotCleanup = jest.fn();
        const post = jest.spyOn(window, 'postMessage').mockImplementationOnce(() => {
            throw new Error('posting failed');
        });
        expect(() => hook.register({
            ...makeFakeInstance(31),
            subscribe: () => cleanup,
            subscribeSnapshot: () => snapshotCleanup,
            observeSelector: jest.fn(),
        }, model)).toThrow('posting failed');
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(snapshotCleanup).toHaveBeenCalledTimes(1);
        expect(hook.getDerivedObserver(model)).toBeUndefined();
        post.mockClear();
        expect(() => hook.unregister(31)).not.toThrow();
        expect(post).not.toHaveBeenCalled();
    });

    test('forwards changes and refreshed snapshots', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const inst = makeFakeInstance(2);
        getHook().register(inst);
        inst.emitChange('firstName', 'Ada');
        await flush();
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

    test('coalesces synchronous changes into one snapshot with the latest state', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const inst = makeFakeInstance(5);
        getHook().register(inst);

        inst.emitChange('firstName', 'Ada');
        inst.emitChange('firstName', 'Grace');
        await flush();
        await flush();

        expect(received.filter((message) => message.kind === 'change')).toHaveLength(2);
        const snapshots = received.filter(
            (message): message is Extract<AgentMessage, { kind: 'snapshot' }> =>
                message.kind === 'snapshot'
        );
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.snapshot.data.firstName).toEqual({
            t: 'primitive',
            v: 'Grace',
        });
    });

    test('serializes the previous object at commit time so historical values remain stable', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const inst = makeFakeInstance(9);
        const before = { count: 1 };
        inst.emitChange('firstName', before);
        getHook().register(inst);
        inst.emitChange('firstName', { count: 2 });
        before.count = 99;
        await flush();
        await flush();

        const change = received.find(
            (m): m is Extract<AgentMessage, { kind: 'change' }> => m.kind === 'change'
        )!;
        expect(JSON.parse(JSON.stringify(change.change)).previous).toEqual({
            t: 'object',
            entries: [['count', { t: 'primitive', v: 1 }]],
        });
    });

    test('refreshes rejected input without adding timeline entries and removes both subscriptions', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const inst = makeFakeInstance(7);
        getHook().register(inst);
        inst.rejectInput();
        inst.rejectInput();
        await flush();
        await flush();
        const snapshots = received.filter(
            (m): m is Extract<AgentMessage, { kind: 'snapshot' }> => m.kind === 'snapshot'
        );
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.snapshot.dirtyData.firstName).toEqual({ t: 'primitive', v: '' });
        expect(snapshots[0]?.snapshot.errors.firstName?.[0]?.message).toBe('required');
        expect(received.filter((m) => m.kind === 'change')).toHaveLength(0);

        inst.clearDirty();
        await flush();
        await flush();
        expect(received.filter((m) => m.kind === 'snapshot')).toHaveLength(2);
        getHook().unregister(7);
        inst.rejectInput();
        inst.emitChange('firstName', 'Ada');
        await flush();
        await flush();
        expect(received.filter((m) => m.kind === 'snapshot')).toHaveLength(2);
        expect(received.filter((m) => m.kind === 'change')).toHaveLength(0);
    });

    test('supports older instances without snapshot subscriptions', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const { subscribeSnapshot: _unused, ...inst } = makeFakeInstance(8);
        getHook().register(inst);
        inst.emitChange('firstName', 'Ada');
        await flush();
        await flush();
        const snapshots = received.filter((m) => m.kind === 'snapshot');
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]!.snapshot.derivedValues).toBeUndefined();
    });

    test('exposes collection only for registered capable models and releases it on disposal', () => {
        dispose = installAgent(window);
        const hook = getHook();
        const model = {};
        const legacyModel = {};
        const observer = jest.fn();
        hook.register({ ...makeFakeInstance(19), observeSelector: observer }, model);
        hook.register(makeFakeInstance(20), legacyModel);
        expect(hook.getDerivedObserver(model)).toBe(observer);
        expect(hook.getDerivedObserver(model)).toBe(observer);
        expect(hook.getDerivedObserver(legacyModel)).toBeUndefined();
        expect(hook.getDerivedObserver({})).toBeUndefined();
        expect(observer).not.toHaveBeenCalled();
        hook.unregister(19);
        expect(hook.getDerivedObserver(model)).toBeUndefined();
    });

    test('owns per-model derived values and refreshes only changed Hook instances', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const first = {};
        const second = {};
        const firstToken = {};
        const secondToken = {};
        const selection = { kind: 'useModelComputed' as const, debugName: 'same name', value: 2 };
        const hook = getHook();
        hook.register(makeFakeInstance(21), first);
        hook.register(makeFakeInstance(22), second);
        hook.updateDerived({}, firstToken, selection);
        hook.updateDerived(first, firstToken, selection);
        hook.updateDerived(first, secondToken, { ...selection, value: 6 });
        hook.updateDerived(first, secondToken, { ...selection, value: 7 });
        hook.updateDerived(second, firstToken, { ...selection, value: 20 });
        await flush();
        await flush();
        const snapshots = () => received.filter(
            (message): message is Extract<AgentMessage, { kind: 'snapshot' }> => message.kind === 'snapshot'
        );
        expect(snapshots()).toHaveLength(2);
        expect(snapshots()[0]!.snapshot.derivedValues).toEqual([
            { ...selection, id: 1, value: { t: 'primitive', v: 2 } },
            { ...selection, id: 2, value: { t: 'primitive', v: 7 } },
        ]);
        expect(snapshots()[1]!.snapshot.derivedValues).toEqual([
            { ...selection, id: 1, value: { t: 'primitive', v: 20 } },
        ]);
        expect(received.filter((message) => message.kind === 'change')).toEqual([]);

        hook.updateDerived(first, secondToken, { ...selection, value: 7 });
        await flush();
        expect(snapshots()).toHaveLength(2);
        hook.updateDerived(first, secondToken, { ...selection, value: 7, debugName: 'renamed' });
        hook.updateDerived(first, firstToken, null);
        hook.updateDerived(first, firstToken, null);
        await flush();
        await flush();
        expect(snapshots()).toHaveLength(3);
        const expected = [{
            ...selection, id: 2, debugName: 'renamed', value: { t: 'primitive', v: 7 },
        }];
        expect(snapshots()[2]!.snapshot.derivedValues).toEqual(expected);
        window.postMessage({ source: PANEL_SOURCE, kind: 'get-snapshot', id: 21 }, '*');
        await flush();
        await flush();
        expect(snapshots()).toHaveLength(4);
        expect(snapshots()[3]!.snapshot.derivedValues).toEqual(expected);
    });

    test('drops queued and late derived reports after unregister or agent disposal', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const model = {};
        const token = {};
        const selection = { kind: 'useModelSelector' as const, value: undefined };
        const hook = getHook();
        hook.register(makeFakeInstance(23), model);
        hook.updateDerived(model, token, selection);
        hook.unregister(23);
        hook.updateDerived(model, token, selection);
        hook.updateDerived(model, token, null);
        await flush();
        await flush();
        expect(received.filter((message) => message.kind === 'snapshot')).toEqual([]);

        hook.register(makeFakeInstance(24), model);
        hook.updateDerived(model, token, selection);
        dispose();
        hook.updateDerived(model, token, selection);
        await flush();
        await flush();
        expect(received.filter((message) => message.kind === 'snapshot')).toEqual([]);
    });

    test('publishes changed dependencies even when the derived value is equal', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const model = {};
        const token = {};
        const hook = getHook();
        hook.register(makeFakeInstance(25), model);
        const selection = { kind: 'useModelSelector' as const, value: 2, fields: ['firstName'] };
        hook.updateDerived(model, token, selection);
        await flush();
        await flush();
        received.length = 0;
        hook.updateDerived(model, token, { ...selection, fields: ['firstName'] });
        await flush();
        expect(received).toEqual([]);
        for (const fields of [['fullName'], [], undefined]) {
            hook.updateDerived(model, token, {
                kind: selection.kind, value: selection.value,
                ...(fields === undefined ? {} : { fields }),
            });
            await flush();
            await flush();
            const message = received[received.length - 1]!;
            expect(message.kind).toBe('snapshot');
            if (message.kind === 'snapshot') {
                expect(message.snapshot.derivedValues![0]).toEqual({
                    id: 1, kind: selection.kind, value: { t: 'primitive', v: 2 },
                    ...(fields === undefined ? {} : { fields }),
                });
            }
        }
        expect(received).toHaveLength(3);
    });

    test('does not send a queued snapshot after the instance is unregistered', async () => {
        const received = collectAgentMessages();
        dispose = installAgent(window);
        const inst = makeFakeInstance(6);
        getHook().register(inst);

        inst.emitChange('firstName', 'Ada');
        getHook().unregister(6);
        await flush();
        await flush();

        expect(received.some((message) => message.kind === 'change')).toBe(true);
        expect(received.some((message) => message.kind === 'instance-removed')).toBe(true);
        expect(received.some((message) => message.kind === 'snapshot')).toBe(false);
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
