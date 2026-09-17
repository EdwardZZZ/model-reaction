/**
 * Minimal ambient declarations for the subset of the `chrome.*` extension APIs
 * this DevTools extension uses. Declared locally (rather than depending on the
 * full `@types/chrome`) so the sub-package typechecks offline and stays lean —
 * add to this file only what the extension actually calls.
 */

interface ChromeRuntimePort {
    name: string;
    postMessage(message: unknown): void;
    disconnect(): void;
    onMessage: {
        addListener(cb: (message: unknown, port: ChromeRuntimePort) => void): void;
        removeListener(cb: (message: unknown, port: ChromeRuntimePort) => void): void;
    };
    onDisconnect: {
        addListener(cb: (port: ChromeRuntimePort) => void): void;
        removeListener(cb: (port: ChromeRuntimePort) => void): void;
    };
}

interface ChromeRuntime {
    connect(connectInfo?: { name?: string }): ChromeRuntimePort;
    onConnect: {
        addListener(cb: (port: ChromeRuntimePort) => void): void;
    };
    getURL(path: string): string;
    lastError?: { message?: string };
}

interface ChromeScripting {
    executeScript(injection: {
        target: { tabId: number };
        files?: string[];
        world?: 'ISOLATED' | 'MAIN';
        injectImmediately?: boolean;
    }): Promise<unknown>;
}

interface ChromeTabs {
    query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number }>>;
}

interface ChromeDevtoolsInspectedWindow {
    tabId: number;
}

interface ChromeDevtoolsPanels {
    create(
        title: string,
        iconPath: string,
        pagePath: string,
        callback?: (panel: unknown) => void
    ): void;
}

interface ChromeDevtools {
    inspectedWindow: ChromeDevtoolsInspectedWindow;
    panels: ChromeDevtoolsPanels;
}

interface Chrome {
    runtime: ChromeRuntime;
    scripting: ChromeScripting;
    tabs: ChromeTabs;
    devtools: ChromeDevtools;
}

declare const chrome: Chrome;
