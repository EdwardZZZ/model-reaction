import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Wrapped in <StrictMode>. Each scenario owns its model via `useOwnedModel`,
// which is resilient to StrictMode's dev-only mount→unmount→remount: it
// recreates the model if the simulated unmount disposed the previous instance,
// so no "ModelManager has been disposed" error occurs. See useOwnedModel.ts.
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
