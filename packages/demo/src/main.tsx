import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { nameModel } from './scenarios/reaction-chain-model';
import './styles.css';

// Shared and component-owned model lifecycles are described in ../README.md.
const root = createRoot(document.getElementById('root')!);
root.render(
    <StrictMode>
        <App />
    </StrictMode>
);

function handlePageHide(event: PageTransitionEvent) {
    if (event.persisted) return;
    root.unmount();
    nameModel.dispose();
}

window.addEventListener('pagehide', handlePageHide);

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        window.removeEventListener('pagehide', handlePageHide);
        root.unmount();
    });
}
