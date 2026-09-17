/**
 * Content script — runs in the ISOLATED world at `document_start`.
 *
 * Two jobs:
 *   1. Inject the page agent into the page's MAIN world so the global hook is
 *      installed before the app's first `createModel`. MV3 lets us do this
 *      declaratively via `world: 'MAIN'` in the manifest, but injecting from
 *      here as well is a robust fallback and keeps the wiring explicit.
 *   2. Relay messages between the page (`window.postMessage`) and the extension
 *      (a long-lived `chrome.runtime` port to the background worker).
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
