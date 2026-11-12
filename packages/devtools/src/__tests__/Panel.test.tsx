/**
 * @jest-environment jsdom
 *
 * Component tests for the DevTools panel. A fake transport drives the panel
 * with scripted AgentMessages, so these exercise the full reducer → render
 * path without any chrome APIs.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { Panel } from '../panel/Panel';
import { DependencyGraphView } from '../panel/DependencyGraphView';
import {
    AGENT_SOURCE,
    type AgentMessage,
    type InstanceState,
} from '../protocol';
import type { PanelPort } from '../panel-port';
import { serializeSnapshot } from '../serialize';

function instance(id: number, overrides: Partial<InstanceState> = {}): InstanceState {
    return {
        id,
        fields: {
            first: { type: 'string', hasDefault: true, validatorCount: 0, reactionDeps: [] },
            last: { type: 'string', hasDefault: true, validatorCount: 0, reactionDeps: [] },
            full: {
                type: 'string',
                hasDefault: true,
                validatorCount: 0,
                reactionDeps: ['first', 'last'],
            },
        },
        graph: {
            nodes: ['first', 'last', 'full'],
            edges: [
                { from: 'first', to: 'full' },
                { from: 'last', to: 'full' },
            ],
        },
        snapshot: {
            data: {
                first: { t: 'primitive', v: 'Ada' },
                last: { t: 'primitive', v: 'Lovelace' },
                full: { t: 'primitive', v: 'Ada Lovelace' },
            },
            dirtyData: {},
            errors: {},
        },
        timeline: [],
        ...overrides,
    };
}

/** A transport we can push messages into on demand. */
function makeFakeConnect() {
    let emit: (msg: AgentMessage) => void = () => {};
    const port: PanelPort = { send: jest.fn(), disconnect: jest.fn() };
    const connect = (onMessage: (msg: AgentMessage) => void): PanelPort => {
        emit = onMessage;
        return port;
    };
    return { connect, emit: (msg: AgentMessage) => emit(msg), port };
}

describe('Panel', () => {
    test('falls back after a user-selected instance disappears or init replaces it', () => {
        const { connect, emit, port } = makeFakeConnect();
        const { container, getByRole } = render(<Panel connect={connect} />);
        act(() => {
            emit({ source: AGENT_SOURCE, kind: 'init', instances: [instance(1), instance(2), instance(3)] });
        });
        fireEvent.change(getByRole('combobox'), { target: { value: '2' } });
        expect((getByRole('combobox') as HTMLSelectElement).value).toBe('2');
        expect(port.send).not.toHaveBeenCalled();
        act(() => { emit({ source: AGENT_SOURCE, kind: 'instance-removed', id: 2 }); });
        expect((getByRole('combobox') as HTMLSelectElement).value).toBe('1');
        expect(container.textContent).toContain('Ada Lovelace');
        fireEvent.change(getByRole('combobox'), { target: { value: '3' } });
        act(() => { emit({ source: AGENT_SOURCE, kind: 'init', instances: [instance(4)] }); });
        expect(container.textContent).toContain('Ada Lovelace');
        expect(container.textContent).not.toContain('No model detected');
        act(() => { emit({ source: AGENT_SOURCE, kind: 'instance-removed', id: 4 }); });
        expect(container.textContent).toContain('No model detected');
    });

    test('renders exceptional numbers after JSON transport without turning them into null or zero', () => {
        const { connect, emit } = makeFakeConnect();
        const { container } = render(<Panel connect={connect} />);
        const snapshot = serializeSnapshot({
            data: { nan: NaN, positive: Infinity, negative: -Infinity, zero: -0 },
            dirtyData: {}, errors: {},
        });
        act(() => {
            emit(JSON.parse(JSON.stringify({
                source: AGENT_SOURCE, kind: 'init', instances: [instance(1, { snapshot })],
            })));
        });
        expect(Array.from(container.querySelectorAll('.mrd-val-number'), (node) => node.textContent))
            .toEqual(['NaN', 'Infinity', '-Infinity', '-0']);
    });

    test('renders action nodes and dashed edges inside their field without adding calculation nodes', () => {
        const state = instance(1);
        state.fields.full!.actions = [
            { reactionIndex: 0, actionIndex: 0, name: 'save' },
            { reactionIndex: 0, actionIndex: 1, name: 'save' },
        ];
        const { container } = render(<DependencyGraphView instance={state} />);
        const actions = container.querySelectorAll('.mrd-action');
        expect(actions).toHaveLength(2);
        expect(Array.from(actions).map((node) => node.getAttribute('data-action-id'))).toEqual([
            '["full",0,0]', '["full",0,1]',
        ]);
        expect(container.querySelectorAll('.mrd-field-module')).toHaveLength(1);
        expect(container.querySelectorAll('.mrd-action-edge')).toHaveLength(2);
        expect(container.querySelectorAll('.mrd-node')).toHaveLength(3);
        expect(container.querySelectorAll('svg > .mrd-edge')).toHaveLength(2);
        expect(container.textContent).toContain('action[0]');
        expect(container.textContent).toContain('action[1]');
    });

    test('shows the empty state when no model is present', () => {
        const { connect } = makeFakeConnect();
        const { container } = render(<Panel connect={connect} />);
        expect(container.textContent).toContain('No model detected');
    });

    test('renders data-tree values after an init message', () => {
        const { connect, emit } = makeFakeConnect();
        const { container, getByRole, queryByRole } = render(<Panel connect={connect} />);

        act(() => {
            emit({ source: AGENT_SOURCE, kind: 'init', instances: [instance(1)] });
        });

        // Default tab is the data tree; committed values should be visible.
        expect(container.textContent).toContain('Ada Lovelace');
        expect(container.textContent).toContain('data');
        act(() => {
            emit({
                source: AGENT_SOURCE, kind: 'snapshot', id: 1,
                snapshot: { ...instance(1).snapshot, truncated: true },
            });
        });
        expect(getByRole('status').textContent).toContain('errors may be omitted');
        act(() => {
            emit({ source: AGENT_SOURCE, kind: 'snapshot', id: 1, snapshot: instance(1).snapshot });
        });
        expect(queryByRole('status')).toBeNull();
    });

    test('switches to the dependency graph tab and renders nodes', () => {
        const { connect, emit } = makeFakeConnect();
        const { container, getByText } = render(<Panel connect={connect} />);
        act(() => {
            emit({ source: AGENT_SOURCE, kind: 'init', instances: [instance(1)] });
        });

        act(() => {
            getByText('Dependencies').click();
        });

        // SVG node labels for each field.
        const labels = Array.from(container.querySelectorAll('.mrd-node-label')).map(
            (n) => n.textContent
        );
        expect(labels).toEqual(expect.arrayContaining(['first', 'last', 'full']));
    });

    test('timeline tab lists changes pushed after init', () => {
        const { connect, emit } = makeFakeConnect();
        const { container, getByText } = render(<Panel connect={connect} />);
        act(() => {
            emit({ source: AGENT_SOURCE, kind: 'init', instances: [instance(1)] });
        });
        act(() => {
            emit({
                source: AGENT_SOURCE,
                kind: 'change',
                id: 1,
                change: {
                    seq: 0,
                    field: 'first',
                    value: { t: 'primitive', v: 'Grace' },
                    timestamp: Date.now(),
                },
            });
        });

        act(() => {
            getByText('Timeline').click();
        });
        expect(container.textContent).toContain('#0');
        expect(container.textContent).toContain('first');
    });

    test('disconnects the transport on unmount', () => {
        const { connect, port } = makeFakeConnect();
        const { unmount } = render(<Panel connect={connect} />);
        unmount();
        expect(port.disconnect).toHaveBeenCalledTimes(1);
    });

    test('shows an instance picker when multiple models exist', () => {
        const { connect, emit } = makeFakeConnect();
        const { container } = render(<Panel connect={connect} />);
        act(() => {
            emit({
                source: AGENT_SOURCE,
                kind: 'init',
                instances: [instance(1), instance(2)],
            });
        });
        expect(container.querySelector('.mrd-instance-picker')).not.toBeNull();
    });
});
