/**
 * DevTools page entry. Loaded by `devtools.html` when Chrome DevTools opens.
 * Its sole job is to register the "Model Reaction" panel; the panel's own
 * document (`panel.html`) hosts the React UI.
 */
chrome.devtools.panels.create(
    'Model Reaction',
    '',
    'panel.html',
    () => {
        // Panel created; nothing else to do here. The panel page connects its
        // own runtime port on load.
    }
);
