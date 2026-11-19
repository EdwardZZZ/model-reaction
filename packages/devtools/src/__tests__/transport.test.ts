import { createModel } from 'model-reaction/devtools';
import type { ModelReturn } from 'model-reaction';
import { installAgent } from '../page-agent';
import { createPanelPort, type PanelPort } from '../panel-port';
import { initialPanelState, panelReducer } from '../panel-state';
import { PANEL_SOURCE, type AgentMessage } from '../protocol';

function event<Args extends unknown[]>() {
    const listeners = new Set<(...args: Args) => void>();
    return {
        addListener: (listener: (...args: Args) => void) => { listeners.add(listener); },
        removeListener: (listener: (...args: Args) => void) => { listeners.delete(listener); },
        emit: (...args: Args) => { [...listeners].forEach((listener) => listener(...args)); },
    };
}

interface TestPort extends ChromeRuntimePort {
    sender?: { tab: { id: number } };
    connected: boolean;
    sent: unknown[];
    onMessage: ReturnType<typeof event<[unknown, ChromeRuntimePort]>>;
    onDisconnect: ReturnType<typeof event<[ChromeRuntimePort]>>;
}

function transportHarness() {
    const tasks: Array<() => void> = [];
    const connections: Array<{ client: TestPort; server: TestPort }> = [];
    const windowListeners = new Set<EventListenerOrEventListenerObject>();
    let state = initialPanelState();
    const received: AgentMessage[] = [];
    const panels: PanelPort[] = [];
    const chromeMock = {
        devtools: { inspectedWindow: { tabId: 7 } },
        runtime: {
            id: 'model-reaction-devtools' as string | undefined,
            onConnect: event<[ChromeRuntimePort]>(),
            connect: jest.fn(({ name }: { name: string }) => {
                function endpoint(): TestPort {
                    return {
                        name,
                        connected: true,
                        sent: [],
                        onMessage: event<[unknown, ChromeRuntimePort]>(),
                        onDisconnect: event<[ChromeRuntimePort]>(),
                        postMessage(message): void {
                            const peer = this === client ? server : client;
                            if (!this.connected || !peer.connected) throw new Error('Disconnected port');
                            this.sent.push(message);
                            tasks.push(() => {
                                if (peer.connected) peer.onMessage.emit(message, peer);
                            });
                        },
                        disconnect(): void {
                            if (!client.connected && !server.connected) return;
                            client.connected = server.connected = false;
                            tasks.push(() => {
                                client.onDisconnect.emit(client);
                                server.onDisconnect.emit(server);
                            });
                        },
                    };
                }
                const client = endpoint();
                const server = endpoint();
                server.sender = { tab: { id: 7 } };
                connections.push({ client, server });
                tasks.push(() => chromeMock.runtime.onConnect.emit(server));
                return client;
            }),
        },
    };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chromeMock });
    jest.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
        if (type === 'message') windowListeners.add(listener);
    });
    jest.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
        if (type === 'message') windowListeners.delete(listener);
    });
    jest.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
        tasks.push(() => {
            const messageEvent = { data: message } as MessageEvent;
            windowListeners.forEach((listener) => {
                if (typeof listener === 'function') listener.call(window, messageEvent);
                else listener.handleEvent(messageEvent);
            });
        });
    });

    function startWorker(): void {
        chromeMock.runtime.onConnect = event<[ChromeRuntimePort]>();
        jest.isolateModules(() => { require('../background'); });
    }
    function flush(): void {
        for (;;) {
            jest.runAllTicks();
            const task = tasks.shift();
            if (!task) return;
            task();
        }
    }
    function openPanel(): PanelPort {
        const panel = createPanelPort((message) => {
            received.push(message);
            state = panelReducer(state, message);
        });
        panels.push(panel);
        return panel;
    }
    function openContent(): void {
        jest.isolateModules(() => { require('../content'); });
    }
    function latest(name: string) {
        return connections.filter(({ client }) => client.name === name).slice(-1)[0]!;
    }
    function restartWorker(): void {
        const connected = connections.filter(({ client }) => client.connected);
        startWorker();
        connected.forEach(({ client }) => client.disconnect());
        flush();
    }
    startWorker();
    const disposeAgent = installAgent(window);
    return {
        chromeMock, connections, received, flush, openPanel, openContent, latest, restartWorker,
        get state() { return state; },
        get messageListenerCount() { return windowListeners.size; },
        close(): void {
            panels.forEach((panel) => panel.disconnect());
            disposeAgent();
        },
    };
}

describe('DevTools transport recovery', () => {
    let harness: ReturnType<typeof transportHarness>;
    let model: ModelReturn<{ value: number }>;

    beforeEach(() => {
        jest.useFakeTimers();
        harness = transportHarness();
        model = createModel({ value: { type: 'number', default: 1 } });
        harness.flush();
    });
    afterEach(() => {
        model.dispose();
        harness.close();
        Reflect.deleteProperty(globalThis, 'chrome');
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    const initRequest = { source: PANEL_SOURCE, kind: 'get-init' } as const;
    const panelName = 'model-reaction-panel-7';
    const contentName = 'model-reaction-devtools';
    function pair(): PanelPort {
        harness.openContent();
        const panel = harness.openPanel();
        harness.flush();
        return panel;
    }
    function value() {
        return [...harness.state.instances.values()][0]?.snapshot.data.value;
    }
    function reconnect(): void {
        jest.advanceTimersByTime(250);
        harness.flush();
    }

    test.each(['panel', 'content'])('initializes existing models when %s connects first', (first) => {
        if (first === 'panel') {
            const panel = harness.openPanel();
            harness.flush();
            panel.send(initRequest);
            harness.flush();
            expect(harness.state.instances.size).toBe(0);
            harness.openContent();
        } else {
            harness.openContent();
            harness.flush();
            harness.openPanel();
        }
        harness.flush();
        expect(value()).toEqual({ t: 'primitive', v: 1 });
        expect(harness.received.filter((message) => message.kind === 'init')).toHaveLength(1);
    });

    test('recovers missed writes and instance replacement after the panel disconnects', async () => {
        const panel = pair();
        const old = harness.latest(panelName);
        old.client.disconnect();
        harness.flush();
        expect(() => panel.send(initRequest)).not.toThrow();
        model.dispose();
        model = createModel({ value: { type: 'number', default: 2 } });
        await model.setField('value', 3);
        harness.flush();
        expect(value()).toEqual({ t: 'primitive', v: 1 });
        reconnect();
        expect(harness.state.instances.size).toBe(1);
        expect(value()).toEqual({ t: 'primitive', v: 3 });
        const timeline = [...harness.state.instances.values()][0]!.timeline;
        expect(timeline.map((change) => change.value)).toEqual([{ t: 'primitive', v: 3 }]);
        const current = harness.latest(panelName);
        expect(current).not.toBe(old);
        panel.send(initRequest);
        harness.flush();
        expect(current.client.sent).toContainEqual(initRequest);
        expect(old.client.sent).toEqual([]);
    });

    test('clears only the requested timeline and retains the clear across reconnects', async () => {
        const panel = pair();
        const other = createModel({ value: { type: 'number', default: 10 } });
        try {
            await model.setField('value', 2);
            await other.setField('value', 11);
            harness.flush();
            const [id, otherId] = [...harness.state.instances.keys()];
            expect(harness.state.instances.get(id!)!.timeline).toHaveLength(1);
            panel.send({ source: PANEL_SOURCE, kind: 'clear-timeline', id: id! });
            harness.flush();
            expect(harness.state.instances.get(id!)!.timeline).toEqual([]);
            expect(harness.state.instances.get(otherId!)!.timeline).toHaveLength(1);
            expect(model.getField('value')).toBe(2);
            expect(value()).toEqual({ t: 'primitive', v: 2 });
            harness.restartWorker();
            reconnect();
            expect(harness.state.instances.get(id!)!.timeline).toEqual([]);
            expect(harness.state.instances.get(otherId!)!.timeline).toHaveLength(1);
            await model.setField('value', 3);
            harness.flush();
            expect(harness.state.instances.get(id!)!.timeline).toEqual([
                expect.objectContaining({ seq: 1, value: { t: 'primitive', v: 3 } }),
            ]);
            panel.send(initRequest);
            harness.flush();
            expect(harness.state.instances.get(id!)!.timeline).toHaveLength(1);
        } finally {
            other.dispose();
        }
    });

    test('resynchronizes when only the content relay reconnects', () => {
        pair();
        harness.latest(contentName).client.disconnect();
        harness.flush();
        reconnect();
        expect(harness.received.filter((message) => message.kind === 'init')).toHaveLength(2);
        expect(value()).toEqual({ t: 'primitive', v: 1 });
        expect(harness.connections.filter(({ client }) => client.name === panelName)).toHaveLength(1);
    });

    test('retries a transient failure while connecting the content relay initially', () => {
        harness.chromeMock.runtime.connect
            .mockImplementationOnce(() => { throw new Error('Worker unavailable'); });
        expect(() => harness.openContent()).not.toThrow();
        harness.openPanel();
        harness.flush();
        expect(harness.state.instances.size).toBe(0);
        reconnect();
        expect(value()).toEqual({ t: 'primitive', v: 1 });
        expect(jest.getTimerCount()).toBe(0);
    });

    test('recovers missed writes after a content reconnect attempt fails', async () => {
        pair();
        const old = harness.latest(contentName);
        harness.chromeMock.runtime.connect
            .mockImplementationOnce(() => { throw new Error('Worker unavailable'); });
        old.client.disconnect();
        expect(() => harness.flush()).not.toThrow();
        await model.setField('value', 2);
        harness.flush();
        reconnect();
        reconnect();
        expect(value()).toEqual({ t: 'primitive', v: 2 });
        expect(harness.latest(contentName)).not.toBe(old);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('recovers when content sends before its disconnect callback is delivered', async () => {
        pair();
        const old = harness.latest(contentName);
        old.client.connected = old.server.connected = false;
        await model.setField('value', 2);
        expect(() => harness.flush()).not.toThrow();
        reconnect();
        expect(value()).toEqual({ t: 'primitive', v: 2 });
        expect(harness.latest(contentName)).not.toBe(old);
        expect(jest.getTimerCount()).toBe(0);
    });

    test.each(['panel', 'content'])('recovers when the background forwards to a closed %s port', async (target) => {
        const panel = pair();
        if (target === 'content') {
            panel.send(initRequest);
            harness.latest(contentName).client.disconnect();
        } else {
            await model.setField('value', 2);
            harness.flush();
            harness.latest(panelName).client.disconnect();
            const content = harness.latest(contentName).server;
            expect(() => content.onMessage.emit(
                harness.received[harness.received.length - 1], content,
            )).not.toThrow();
        }
        expect(() => harness.flush()).not.toThrow();
        reconnect();
        expect(value()).toEqual({ t: 'primitive', v: target === 'content' ? 1 : 2 });
    });

    test('recovers when the content port closes before the background requests init', () => {
        harness.openContent();
        harness.flush();
        harness.openPanel();
        harness.latest(contentName).client.disconnect();
        expect(() => harness.flush()).not.toThrow();
        reconnect();
        expect(value()).toEqual({ t: 'primitive', v: 1 });
    });

    test('stops content retries when reloading the extension invalidates its context', async () => {
        const agentListeners = harness.messageListenerCount;
        pair();
        harness.chromeMock.runtime.id = undefined;
        harness.latest(contentName).client.connected = false;
        harness.latest(contentName).server.connected = false;
        harness.chromeMock.runtime.connect.mockImplementation(() => {
            throw new Error('Extension context invalidated');
        });
        await model.setField('value', 2);
        expect(() => harness.flush()).not.toThrow();
        jest.advanceTimersByTime(1000);
        expect(() => harness.flush()).not.toThrow();
        expect(jest.getTimerCount()).toBe(0);
        expect(harness.messageListenerCount).toBe(agentListeners);
        expect(harness.chromeMock.runtime.connect).toHaveBeenCalledTimes(2);
    });

    test('cleans up when the extension context becomes invalid during the retry delay', () => {
        const agentListeners = harness.messageListenerCount;
        pair();
        harness.latest(contentName).client.disconnect();
        harness.flush();
        expect(jest.getTimerCount()).toBe(1);
        harness.chromeMock.runtime.id = undefined;
        reconnect();
        expect(jest.getTimerCount()).toBe(0);
        expect(harness.messageListenerCount).toBe(agentListeners);
        expect(harness.chromeMock.runtime.connect).toHaveBeenCalledTimes(2);
    });

    test('recovers the live snapshot and retained timeline after repeated worker restarts', async () => {
        pair();
        for (const next of [2, 3]) {
            harness.restartWorker();
            await model.setField('value', next);
            harness.flush();
            reconnect();
            expect(value()).toEqual({ t: 'primitive', v: next });
        }
        expect(harness.received.filter((message) => message.kind === 'init')).toHaveLength(3);
        expect([...harness.state.instances.values()][0]!.timeline.map((change) => change.value))
            .toEqual([{ t: 'primitive', v: 2 }, { t: 'primitive', v: 3 }]);
    });

    test.each([false, true])('closing the panel cancels recovery (already disconnected: %s)', (broken) => {
        const panel = pair();
        if (broken) {
            harness.latest(panelName).client.disconnect();
            harness.flush();
        }
        panel.disconnect();
        panel.disconnect();
        harness.flush();
        jest.advanceTimersByTime(1000);
        harness.flush();
        expect(harness.connections.filter(({ client }) => client.name === panelName)).toHaveLength(1);
        expect(harness.latest(panelName).client.connected).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
        expect(() => panel.send(initRequest)).not.toThrow();
    });

    test('retries a transient connection failure and stops retrying once connected', () => {
        harness.openContent();
        harness.flush();
        harness.chromeMock.runtime.connect
            .mockImplementationOnce(() => { throw new Error('Worker unavailable'); })
            .mockImplementationOnce(() => { throw new Error('Worker unavailable'); });
        harness.openPanel();
        expect(harness.state.instances.size).toBe(0);
        reconnect();
        expect(harness.state.instances.size).toBe(0);
        expect(jest.getTimerCount()).toBe(1);
        reconnect();
        expect(value()).toEqual({ t: 'primitive', v: 1 });
        expect(jest.getTimerCount()).toBe(0);
    });

    test('recovers when a send detects disconnection before onDisconnect is delivered', () => {
        const panel = pair();
        harness.latest(panelName).client.disconnect();
        expect(() => panel.send(initRequest)).not.toThrow();
        harness.flush();
        reconnect();
        expect(value()).toEqual({ t: 'primitive', v: 1 });
        expect(harness.connections.filter(({ client }) => client.name === panelName)).toHaveLength(2);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('ignores late messages and disconnects from replaced content ports', () => {
        const panel = pair();
        const old = harness.latest(contentName);
        harness.chromeMock.runtime.connect({ name: contentName });
        harness.flush();
        const current = harness.latest(contentName);
        const before = harness.received.length;
        old.server.onMessage.emit({ source: 'model-reaction-devtools-agent', kind: 'init', instances: [] }, old.server);
        old.server.onDisconnect.emit(old.server);
        panel.send(initRequest);
        harness.flush();
        expect(harness.received).toHaveLength(before);
        expect(harness.state.instances.size).toBe(1);
        expect(current.server.sent).toEqual([initRequest, initRequest]);
    });

    test('ignores requests and disconnects from replaced panel ports', () => {
        pair();
        const old = harness.latest(panelName);
        harness.chromeMock.runtime.connect({ name: panelName });
        harness.flush();
        const current = harness.latest(panelName);
        const content = harness.latest(contentName);
        const before = content.server.sent.length;
        old.server.onMessage.emit(initRequest, old.server);
        old.server.onDisconnect.emit(old.server);
        current.client.postMessage(initRequest);
        harness.flush();
        expect(content.server.sent).toHaveLength(before + 1);
        expect(current.server.sent).toHaveLength(2);
    });
});
