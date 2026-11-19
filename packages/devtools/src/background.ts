/**
 * Background service worker (MV3) — the message router.
 *
 * Two kinds of ports connect here:
 *   - content scripts, one per inspected tab (port name `model-reaction-devtools`)
 *   - DevTools panels, one per open panel (port name `model-reaction-panel-<tabId>`)
 *
 * The worker pairs a panel with the content script for the same tab and pipes
 * messages between them. It holds no domain state — everything is forwarded —
 * so it can be torn down and respawned by the browser at will (both sides
 * reconnect).
 */
import { PANEL_SOURCE } from './protocol';

const CONTENT_PORT = 'model-reaction-devtools';
const PANEL_PORT_PREFIX = 'model-reaction-panel-';

interface Port {
    name: string;
    postMessage(message: unknown): void;
    disconnect(): void;
    onMessage: { addListener(cb: (message: unknown) => void): void };
    onDisconnect: { addListener(cb: () => void): void };
    sender?: { tab?: { id?: number } };
}

/** tabId → content-script port. */
const contentPorts = new Map<number, Port>();
/** tabId → panel port. */
const panelPorts = new Map<number, Port>();

chrome.runtime.onConnect.addListener((rawPort) => {
    const port = rawPort as unknown as Port;

    if (port.name === CONTENT_PORT) {
        registerContentPort(port);
    } else if (port.name.startsWith(PANEL_PORT_PREFIX)) {
        const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
        registerPanelPort(tabId, port);
    }
});

function registerContentPort(port: Port): void {
    const tabId = port.sender?.tab?.id;
    if (typeof tabId !== 'number') return;

    contentPorts.set(tabId, port);

    port.onMessage.addListener((msg) => {
        // Agent → panel.
        if (contentPorts.get(tabId) === port) send(panelPorts, tabId, msg);
    });
    port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (contentPorts.get(tabId) === port) contentPorts.delete(tabId);
    });
    requestInit(tabId);
}

function registerPanelPort(tabId: number, port: Port): void {
    panelPorts.set(tabId, port);

    port.onMessage.addListener((msg) => {
        // Panel → agent.
        if (panelPorts.get(tabId) === port) send(contentPorts, tabId, msg);
    });
    port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (panelPorts.get(tabId) === port) panelPorts.delete(tabId);
    });
    requestInit(tabId);
}

function requestInit(tabId: number): void {
    if (panelPorts.has(tabId)) {
        send(contentPorts, tabId, { source: PANEL_SOURCE, kind: 'get-init' });
    }
}

function send(ports: Map<number, Port>, tabId: number, message: unknown): void {
    const port = ports.get(tabId);
    if (!port) return;
    try {
        port.postMessage(message);
    } catch {
        if (ports.get(tabId) === port) ports.delete(tabId);
        try {
            port.disconnect();
        } catch {
            // The browser may have already released the port.
        }
    }
}
