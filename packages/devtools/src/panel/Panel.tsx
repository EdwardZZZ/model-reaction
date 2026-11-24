/**
 * Root DevTools panel component.
 *
 * Wires the transport ({@link createPanelPort}) to the pure reducer
 * ({@link panelReducer}) via `useReducer`, then renders the selected instance
 * through data, dependency graph, and change timeline tabs.
 *
 * The `connect` prop is injected so tests can drive the panel with a fake
 * transport instead of the real `chrome.runtime` port.
 */
import { useEffect, useReducer, useRef, useState, type ReactElement } from 'react';
import {
    initialPanelState,
    panelReducer,
    type PanelAction,
    type PanelState,
} from '../panel-state';
import { PANEL_SOURCE, type AgentMessage } from '../protocol';
import type { PanelPort } from '../panel-port';
import { DataTreeView } from './DataTreeView';
import { DependencyGraphView } from './DependencyGraphView';
import { InstancePicker } from './InstancePicker';
import { TimelineView } from './TimelineView';

type Tab = 'data' | 'graph' | 'timeline';

const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'data', label: 'Data Tree' },
    { id: 'graph', label: 'Dependencies' },
    { id: 'timeline', label: 'Timeline' },
];

export interface PanelProps {
    /** Open the transport and stream messages to the callback. */
    connect: (onMessage: (msg: AgentMessage) => void) => PanelPort;
}

export function Panel({ connect }: PanelProps): ReactElement {
    const [state, dispatch] = useReducer(
        (s: PanelState, m: PanelAction) => panelReducer(s, m),
        undefined,
        initialPanelState
    );
    const [tab, setTab] = useState<Tab>('data');
    const transport = useRef<PanelPort | null>(null);

    useEffect(() => {
        const port = connect((msg) => dispatch(msg));
        transport.current = port;
        return () => {
            transport.current = null;
            port.disconnect();
        };
    }, [connect]);

    const instances = [...state.instances.values()];
    const selectedId = state.selectedId;
    const selected = selectedId !== null ? state.instances.get(selectedId) ?? null : null;

    return (
        <div className="mrd-panel">
            <header className="mrd-header">
                <span className="mrd-title">Model Reaction</span>
                {instances.length > 1 && (
                    <span className="mrd-model-count">{instances.length} models</span>
                )}
            </header>
            <InstancePicker
                instances={instances}
                selectedId={selectedId}
                onSelect={(id) => dispatch({ kind: 'select', id })}
            />

            {selected ? (
                <>
                    <nav className="mrd-tabs">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                className={`mrd-tab${tab === t.id ? ' mrd-tab-active' : ''}`}
                                onClick={() => setTab(t.id)}
                            >
                                {t.label}
                            </button>
                        ))}
                        {tab === 'timeline' && (
                            <button
                                type="button"
                                className="mrd-timeline-clear"
                                disabled={selected.timeline.length === 0}
                                title="Clear this model's recorded changes"
                                onClick={() => transport.current?.send({
                                    source: PANEL_SOURCE,
                                    kind: 'clear-timeline',
                                    id: selected.id,
                                })}
                            >
                                Clear
                            </button>
                        )}
                    </nav>
                    <main className="mrd-content">
                        {tab === 'data' && <DataTreeView instance={selected} />}
                        {tab === 'graph' && <DependencyGraphView key={selected.id} instance={selected} />}
                        {tab === 'timeline' && <TimelineView key={selected.id} instance={selected} />}
                    </main>
                </>
            ) : (
                <div className="mrd-empty mrd-panel-empty">
                    No model detected on this page. Create one with
                    <code> createModel(...) </code>
                    while this panel is open.
                </div>
            )}
        </div>
    );
}
