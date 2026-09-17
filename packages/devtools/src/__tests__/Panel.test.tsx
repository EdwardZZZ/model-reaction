/**
 * @jest-environment jsdom
 *
 * Component tests for the DevTools panel. A fake transport drives the panel
 * with scripted AgentMessages, so these exercise the full reducer → render
 * path without any chrome APIs.
 */
import { act, render } from '@testing-library/react';
import { Panel } from '../panel/Panel';
import {
    AGENT_SOURCE,
    type AgentMessage,
    type InstanceState,
} from '../protocol';
import type { PanelPort } from '../panel-port';

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
    test('shows the empty state when no model is present', () => {
        const { connect } = makeFakeConnect();
        const { container } = render(<Panel connect={connect} />);
        expect(container.textContent).toContain('No model detected');
    });

    test('renders data-tree values after an init message', () => {
        const { connect, emit } = makeFakeConnect();
        const { container } = render(<Panel connect={connect} />);

        act(() => {
            emit({ source: AGENT_SOURCE, kind: 'init', instances: [instance(1)] });
        });

        // Default tab is the data tree; committed values should be visible.
        expect(container.textContent).toContain('Ada Lovelace');
        expect(container.textContent).toContain('data');
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
