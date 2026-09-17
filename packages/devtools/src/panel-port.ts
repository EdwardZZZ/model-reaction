/**
 * Panel transport: the long-lived `chrome.runtime` port that carries messages
 * between this DevTools panel and the page agent (via the background router).
 *
 * The port name embeds the inspected tab id so the background worker can pair
 * this panel with the right content script. Isolated here (thin, side-effecting)
 * so the panel UI and {@link panelReducer} stay pure and testable.
 */
import {
    PANEL_SOURCE,
    isAgentMessage,
    type AgentMessage,
    type PanelMessage,
} from './protocol';

export interface PanelPort {
    /** Send a request to the page agent. */
    send(message: PanelMessage): void;
    /** Tear down the port and its listeners. */
    disconnect(): void;
}

/**
 * Open the panel port for the currently inspected tab and forward incoming
 * {@link AgentMessage}s to `onMessage`. Immediately requests the full init
 * state so a panel opened after the app booted still populates.
 */
export function createPanelPort(onMessage: (msg: AgentMessage) => void): PanelPort {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    const port = chrome.runtime.connect({ name: `model-reaction-panel-${tabId}` });

    port.onMessage.addListener((msg: unknown) => {
        if (isAgentMessage(msg)) onMessage(msg);
    });

    const send = (message: PanelMessage): void => port.postMessage(message);

    // Pull current state on connect (covers models created before the panel
    // opened).
    send({ source: PANEL_SOURCE, kind: 'get-init' });

    return {
        send,
        disconnect: () => port.disconnect(),
    };
}
