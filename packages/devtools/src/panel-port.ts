/**
 * Panel transport: the long-lived `chrome.runtime` port that carries messages
 * between this DevTools panel and the page agent (via the background router).
 *
 * The port name embeds the inspected tab id so the background worker can pair
 * this panel with the right content script. Isolated here (thin, side-effecting)
 * so the panel UI and {@link panelReducer} stay pure and testable.
 */
import {
    isAgentMessage,
    type AgentMessage,
    type PanelMessage,
} from './protocol';

const RECONNECT_DELAY_MS = 250;

export interface PanelPort {
    /** Send a request to the page agent. */
    send(message: PanelMessage): void;
    /** Tear down the port and its listeners. */
    disconnect(): void;
}

/**
 * Open the panel port for the currently inspected tab and forward incoming
 * {@link AgentMessage}s to `onMessage`. The background requests init once both
 * sides connect. Connection lifecycle: model-reaction/docs/DEVTOOLS.md.
 */
export function createPanelPort(onMessage: (msg: AgentMessage) => void): PanelPort {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    let port: ChromeRuntimePort | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const receive = (msg: unknown, source: ChromeRuntimePort): void => {
        if (!closed && source === port && isAgentMessage(msg)) onMessage(msg);
    };

    function scheduleReconnect(): void {
        if (closed || reconnectTimer !== undefined) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            connect();
        }, RECONNECT_DELAY_MS);
    }

    function disconnected(source: ChromeRuntimePort): void {
        void chrome.runtime.lastError;
        if (source !== port) return;
        source.onMessage.removeListener(receive);
        source.onDisconnect.removeListener(disconnected);
        port = undefined;
        scheduleReconnect();
    }

    function connect(): void {
        if (closed) return;
        try {
            port = chrome.runtime.connect({ name: `model-reaction-panel-${tabId}` });
            port.onMessage.addListener(receive);
            port.onDisconnect.addListener(disconnected);
        } catch {
            scheduleReconnect();
        }
    }

    connect();

    return {
        send(message): void {
            const current = port;
            if (!current || closed) return;
            try {
                current.postMessage(message);
            } catch {
                disconnected(current);
            }
        },
        disconnect(): void {
            closed = true;
            clearTimeout(reconnectTimer);
            const current = port;
            port = undefined;
            if (!current) return;
            current.onMessage.removeListener(receive);
            current.onDisconnect.removeListener(disconnected);
            current.disconnect();
        },
    };
}
