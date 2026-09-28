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

function connect(): void {
    const port = chrome.runtime.connect({ name: PORT_NAME });

    // Page (agent) → background/panel.
    const onWindowMessage = (event: MessageEvent): void => {
        const msg: unknown = event.data;
        if (isAgentMessage(msg)) {
            port.postMessage(msg);
        }
    };
    window.addEventListener('message', onWindowMessage);

    // Background/panel → page (agent).
    port.onMessage.addListener((msg: unknown) => {
        if (isPanelMessage(msg)) {
            window.postMessage(msg, '*');
        }
    });

    // If the background worker is torn down (MV3 idle), reconnect so the panel
    // keeps receiving updates.
    port.onDisconnect.addListener(() => {
        window.removeEventListener('message', onWindowMessage);
        connect();
    });
}

connect();
