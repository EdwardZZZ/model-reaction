/**
 * Content script — runs in the ISOLATED world at `document_start`.
 *
 * Relays messages between the page (`window.postMessage`) and the extension
 * (a long-lived `chrome.runtime` port to the background worker). The page agent
 * is injected separately into the MAIN world by the manifest.
 *
 * The content script is the only layer that can see both the page's `window`
 * and the extension's messaging APIs, so all cross-boundary traffic funnels
 * through here.
 */
import { isAgentMessage, isPanelMessage } from './protocol';

const PORT_NAME = 'model-reaction-devtools';
const RECONNECT_DELAY_MS = 250;

let port: ChromeRuntimePort | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function releasePort(current: ChromeRuntimePort): void {
    current.onMessage.removeListener(receive);
    current.onDisconnect.removeListener(disconnected);
    try {
        current.disconnect();
    } catch {
        // The extension context may already be invalid.
    }
}

function stop(): void {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    window.removeEventListener('message', onWindowMessage);
    const current = port;
    port = undefined;
    if (current) releasePort(current);
}

function scheduleReconnect(): void {
    if (!chrome.runtime.id) {
        stop();
        return;
    }
    if (reconnectTimer !== undefined) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
    }, RECONNECT_DELAY_MS);
}

function disconnected(source: ChromeRuntimePort): void {
    void chrome.runtime.lastError;
    if (source !== port) return;
    port = undefined;
    releasePort(source);
    scheduleReconnect();
}

function receive(msg: unknown, source: ChromeRuntimePort): void {
    if (source === port && isPanelMessage(msg)) window.postMessage(msg, '*');
}

function onWindowMessage(event: MessageEvent): void {
    const msg: unknown = event.data;
    const current = port;
    if (!current || !isAgentMessage(msg)) return;
    try {
        current.postMessage(msg);
    } catch {
        disconnected(current);
    }
}

// Connection lifecycle: model-reaction/docs/DEVTOOLS.md.
function connect(): void {
    if (!chrome.runtime.id) {
        stop();
        return;
    }
    try {
        port = chrome.runtime.connect({ name: PORT_NAME });
        port.onMessage.addListener(receive);
        port.onDisconnect.addListener(disconnected);
    } catch {
        const current = port;
        port = undefined;
        if (current) releasePort(current);
        scheduleReconnect();
    }
}

window.addEventListener('message', onWindowMessage);
connect();
