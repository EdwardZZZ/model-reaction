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
    PANEL_SOURCE,
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
        fireEvent.click(getByRole('button', { name: 'Model #2' }));
        expect(getByRole('button', { name: 'Model #2' }).getAttribute('aria-pressed')).toBe('true');
        expect(port.send).not.toHaveBeenCalled();
        act(() => { emit({ source: AGENT_SOURCE, kind: 'instance-removed', id: 2 }); });
        expect(getByRole('button', { name: 'Model #1' }).getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Ada Lovelace');
        fireEvent.click(getByRole('button', { name: 'Model #3' }));
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
            { reactionIndex: 0, actionIndex: 1, name: '' },
            { reactionIndex: 0, actionIndex: 2, name: 'save' },
        ];
        const { container } = render(<DependencyGraphView instance={state} />);
        const actions = container.querySelectorAll('.mrd-action');
        expect(actions).toHaveLength(3);
        expect(Array.from(actions).map((node) => node.getAttribute('data-action-id'))).toEqual([
            '["full",0,0]', '["full",0,1]', '["full",0,2]',
        ]);
        expect(container.querySelectorAll('.mrd-field-module')).toHaveLength(1);
        expect(container.querySelectorAll('.mrd-action-edge')).toHaveLength(3);
        expect(container.querySelectorAll('.mrd-node')).toHaveLength(3);
        expect(container.querySelectorAll('svg > .mrd-edge')).toHaveLength(2);
        expect(Array.from(actions, (node) => node.querySelector('text')!.textContent))
            .toEqual(['save', 'r0 · action[1]', 'save']);
        const positions = Array.from(container.querySelectorAll('svg > .mrd-node'), (node) =>
            node.getAttribute('transform')!.match(/[\d.]+/g)!.map(Number)
        );
        expect(positions[0]![0]).toBe(positions[1]![0]);
        expect(positions[2]![0]).toBeGreaterThan(positions[0]![0]!);
        expect(positions[0]![1]).toBeLessThan(positions[1]![1]!);
        expect(positions[1]![1]).toBeLessThan(positions[2]![1]!);
        const edges = Array.from(container.querySelectorAll('svg > .mrd-edge'));
        edges.forEach((edge, index) => {
            const [x1, y1, bendX, y2, x2] =
                edge.getAttribute('d')!.match(/[\d.]+/g)!.map(Number);
            expect(x1).toBe(positions[index]![0]! + 240);
            expect(y1).toBe(positions[index]![1]! + 18);
            expect(x2).toBe(positions[2]![0]);
            expect(bendX).toBeGreaterThan(x1!);
            expect(bendX).toBeLessThan(x2!);
            expect(y1).toBeLessThan(y2!);
            expect(y2).toBe(positions[2]![1]! + 18);
            expect(edge.getAttribute('marker-end')).toBe('url(#mrd-arrow)');
        });
    });

    test('shows one shared action after JSON transport and highlights both declaring fields', () => {
        const state = instance(1);
        state.fields.full!.actions = [
            { reactionIndex: 0, actionIndex: 0, name: 'countNameAction', functionId: 0 },
            { reactionIndex: 0, actionIndex: 1, name: 'captureFullName', functionId: 1 },
        ];
        state.fields.greeting = {
            type: 'string', hasDefault: true, validatorCount: 0, reactionDeps: ['full'],
            actions: [
                { reactionIndex: 0, actionIndex: 0, name: 'captureFullName', functionId: 1 },
                { reactionIndex: 0, actionIndex: 1, name: 'captureGreeting', functionId: 2 },
            ],
        };
        state.graph.nodes.push('greeting');
        state.graph.edges.push({ from: 'full', to: 'greeting' });
        const { container } = render(<DependencyGraphView instance={JSON.parse(JSON.stringify(state))} />);
        expect(container.querySelectorAll('.mrd-action')).toHaveLength(3);
        expect(container.querySelectorAll('.mrd-field-module')).toHaveLength(2);
        expect(container.querySelectorAll('.mrd-action-edge')).toHaveLength(4);
        const shared = container.querySelector('.mrd-shared-action')!;
        expect(shared.querySelector('.mrd-node-label')!.textContent).toBe('captureFullName');
        expect(shared.textContent).toContain('shared · 2 fields');
        expect(shared.querySelector('title')!.textContent).toContain('full · r0 · action[1]');
        expect(shared.querySelector('title')!.textContent).toContain('greeting · r0 · action[0]');
        const incoming = container.querySelectorAll(`[data-to-action="${shared.getAttribute('data-action-id')}"]`);
        expect(Array.from(incoming, (edge) => edge.getAttribute('data-from-field'))).toEqual(['full', 'greeting']);
        expect(container.querySelectorAll('svg > .mrd-edge:not(.mrd-action-edge)')).toHaveLength(3);

        fireEvent.mouseEnter(shared);
        expect(container.querySelectorAll('.mrd-action-edge.mrd-edge-active')).toHaveLength(2);
        expect(container.querySelector('[data-field-id="full"]')!.classList.contains('mrd-node-active')).toBe(true);
        expect(container.querySelector('[data-field-id="greeting"]')!.classList.contains('mrd-node-active')).toBe(true);
        fireEvent.mouseLeave(shared);
        expect(container.querySelectorAll('.mrd-edge-active')).toHaveLength(0);
        fireEvent.mouseEnter(container.querySelector('[data-field-id="full"]')!);
        expect(container.querySelectorAll('svg > .mrd-action-edge.mrd-edge-active')).toHaveLength(1);
        expect(shared.classList.contains('mrd-node-active')).toBe(true);
    });

    test('keeps same-name functions distinct and shows a repeated local reference once', () => {
        const state = instance(1);
        state.fields.full!.actions = [
            { reactionIndex: 0, actionIndex: 0, name: 'save', functionId: 0 },
            { reactionIndex: 0, actionIndex: 1, name: 'save', functionId: 1 },
            { reactionIndex: 0, actionIndex: 2, name: 'save', functionId: 0 },
        ];
        const { container } = render(<DependencyGraphView instance={state} />);
        expect(container.querySelectorAll('.mrd-action')).toHaveLength(2);
        expect(container.querySelectorAll('.mrd-shared-action')).toHaveLength(0);
        expect(container.querySelectorAll('.mrd-action-edge')).toHaveLength(2);
        expect(container.querySelector('[data-action-id="function:0"] title')!.textContent)
            .toContain('full · r0 · action[2]');
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

    test('clears the selected timeline and keeps recording with no stale detail selection', () => {
        const { connect, emit, port } = makeFakeConnect();
        const { container, getByRole } = render(<Panel connect={connect} />);
        const change = { seq: 0, field: 'first', value: { t: 'primitive' as const, v: 'Grace' }, timestamp: 1 };
        act(() => {
            emit({
                source: AGENT_SOURCE, kind: 'init',
                instances: [instance(1, { timeline: [change] }), instance(2, { timeline: [change] })],
            });
        });
        fireEvent.click(getByRole('button', { name: 'Timeline' }));
        fireEvent.click(container.querySelector('.mrd-timeline-item')!);
        expect(container.querySelector('.mrd-timeline-detail h4')).not.toBeNull();
        fireEvent.click(getByRole('button', { name: 'Model #2' }));
        expect(container.querySelector('.mrd-timeline-detail h4')).toBeNull();
        fireEvent.click(container.querySelector('.mrd-timeline-item')!);
        fireEvent.click(getByRole('button', { name: 'Clear' }));
        expect(port.send).toHaveBeenCalledWith({ source: PANEL_SOURCE, kind: 'clear-timeline', id: 2 });
        act(() => { emit({ source: AGENT_SOURCE, kind: 'timeline-cleared', id: 2 }); });
        expect(container.querySelector('.mrd-timeline-item')).toBeNull();
        expect(container.querySelector('.mrd-timeline-detail')).toBeNull();
        expect((getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(getByRole('button', { name: 'Model #1' }));
        expect(container.querySelectorAll('.mrd-timeline-item')).toHaveLength(1);
        fireEvent.click(getByRole('button', { name: 'Model #2' }));
        act(() => {
            emit({ source: AGENT_SOURCE, kind: 'change', id: 2, change: { ...change, seq: 1 } });
        });
        expect(container.querySelectorAll('.mrd-timeline-item')).toHaveLength(1);
        expect(container.querySelector('.mrd-timeline-detail h4')).toBeNull();
        expect((getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false);
    });

    test('disconnects the transport on unmount', () => {
        const { connect, port } = makeFakeConnect();
        const { unmount } = render(<Panel connect={connect} />);
        unmount();
        expect(port.disconnect).toHaveBeenCalledTimes(1);
    });

    test('switches models directly while keeping the selected view', () => {
        const { connect, emit } = makeFakeConnect();
        const { container, getByRole } = render(<Panel connect={connect} />);
        const second = instance(2, {
            fields: {
                qty: { type: 'number', hasDefault: true, validatorCount: 0, reactionDeps: [] },
                price: { type: 'number', hasDefault: true, validatorCount: 0, reactionDeps: [] },
                total: { type: 'number', hasDefault: true, validatorCount: 0, reactionDeps: ['qty', 'price'] },
                currency: { type: 'string', hasDefault: true, validatorCount: 0, reactionDeps: [] },
            },
            graph: {
                nodes: ['qty', 'price', 'total', 'currency'],
                edges: [{ from: 'qty', to: 'total' }, { from: 'price', to: 'total' }],
            },
        });
        act(() => {
            emit({
                source: AGENT_SOURCE,
                kind: 'init',
                instances: [instance(1), second],
            });
        });
        const secondButton = getByRole('button', { name: 'Model #2' });
        expect(secondButton.textContent).toContain('qty, price, total, +1');
        expect(secondButton.title).toContain('currency');
        fireEvent.click(getByRole('button', { name: 'Dependencies' }));
        fireEvent.click(secondButton);
        expect(Array.from(container.querySelectorAll('.mrd-node-label'), (node) => node.textContent))
            .toEqual(['qty', 'price', 'currency', 'total']);
        expect(secondButton.getAttribute('aria-pressed')).toBe('true');
        expect(getByRole('button', { name: 'Model #1' }).getAttribute('aria-pressed')).toBe('false');
        act(() => { emit({ source: AGENT_SOURCE, kind: 'instance-removed', id: 1 }); });
        expect(container.querySelector('.mrd-instance-picker')).toBeNull();
        expect(container.querySelector('svg')).not.toBeNull();
    });
});
