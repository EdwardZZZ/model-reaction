/**
 * Root DevTools panel component.
 *
 * Wires the transport ({@link createPanelPort}) to the pure reducer
 * ({@link panelReducer}) via `useReducer`, then renders the selected instance
 * through one of three tabs: data tree, dependency graph, change timeline.
 *
 * The `connect` prop is injected so tests can drive the panel with a fake
 * transport instead of the real `chrome.runtime` port.
 */
import { useEffect, useReducer, useState, type ReactElement } from 'react';
import {
    initialPanelState,
    panelReducer,
    type PanelState,
} from '../panel-state';
import type { AgentMessage } from '../protocol';
import type { PanelPort } from '../panel-port';
import { DataTreeView } from './DataTreeView';
import { DependencyGraphView } from './DependencyGraphView';
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
        (s: PanelState, m: AgentMessage) => panelReducer(s, m),
        undefined,
        initialPanelState
    );
    const [tab, setTab] = useState<Tab>('data');
    // The reducer owns selection, but the user can override it here.
    const [selectedOverride, setSelectedOverride] = useState<number | null>(null);

    useEffect(() => {
        const port = connect((msg) => dispatch(msg));
        return () => port.disconnect();
    }, [connect]);

    const instances = [...state.instances.values()];
    const selectedId = selectedOverride ?? state.selectedId;
    const selected = selectedId !== null ? state.instances.get(selectedId) ?? null : null;

    return (
        <div className="mrd-panel">
            <header className="mrd-header">
                <span className="mrd-title">Model Reaction</span>
                <InstancePicker
                    instances={instances.map((i) => i.id)}
                    selectedId={selectedId}
                    onSelect={setSelectedOverride}
                />
            </header>

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
                    </nav>
                    <main className="mrd-content">
                        {tab === 'data' && <DataTreeView instance={selected} />}
                        {tab === 'graph' && <DependencyGraphView instance={selected} />}
                        {tab === 'timeline' && <TimelineView instance={selected} />}
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

function InstancePicker({
    instances,
    selectedId,
    onSelect,
}: {
    instances: number[];
    selectedId: number | null;
    onSelect: (id: number) => void;
}): ReactElement | null {
    if (instances.length <= 1) return null;
    return (
        <label className="mrd-instance-picker">
            model
            <select
                value={selectedId ?? ''}
                onChange={(e) => onSelect(Number(e.target.value))}
            >
                {instances.map((id) => (
                    <option key={id} value={id}>
                        #{id}
                    </option>
                ))}
            </select>
        </label>
    );
}
