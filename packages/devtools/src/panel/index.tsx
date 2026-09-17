/**
 * Panel React entry point. Mounts {@link Panel} with the real chrome transport.
 */
import { createRoot } from 'react-dom/client';
import { Panel } from './Panel';
import { createPanelPort } from '../panel-port';

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<Panel connect={createPanelPort} />);
}
