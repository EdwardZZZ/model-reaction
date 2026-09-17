import { useState } from 'react';
import { ReactionChain } from './scenarios/ReactionChain';
import { AsyncValidation } from './scenarios/AsyncValidation';
import { MultiInstance } from './scenarios/MultiInstance';

type TabId = 'chain' | 'async' | 'multi';

const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'chain', label: 'Reaction chain' },
    { id: 'async', label: 'Async validation' },
    { id: 'multi', label: 'Multiple instances' },
];

export function App() {
    const [tab, setTab] = useState<TabId>('chain');

    return (
        <div className="app">
            <header className="app-header">
                <h1>model-reaction demo</h1>
                <p className="hint">
                    Install the <strong>Model Reaction</strong> DevTools
                    extension, open your browser DevTools, and select its panel
                    to inspect the data tree, dependency graph, and change
                    timeline for the models below. Each scenario opts in via{' '}
                    <code>import {'{'} createModel {'}'} from 'model-reaction/devtools'</code>.
                </p>
            </header>

            <nav className="tabs">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        className={`tab${tab === t.id ? ' tab-active' : ''}`}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            <main>
                {tab === 'chain' && <ReactionChain />}
                {tab === 'async' && <AsyncValidation />}
                {tab === 'multi' && <MultiInstance />}
            </main>
        </div>
    );
}
