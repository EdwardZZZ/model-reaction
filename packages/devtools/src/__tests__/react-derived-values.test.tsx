import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createModel } from 'model-reaction/devtools';
import { useModelComputed, useModelSelector } from 'model-reaction/react';
import { installAgent } from '../page-agent';
import { Panel } from '../panel/Panel';
import { isAgentMessage } from '../protocol';
import type { PanelPort } from '../panel-port';
import type { AgentMessage } from '../protocol';

const connect = (receive: (message: AgentMessage) => void): PanelPort => {
    const onMessage = (event: MessageEvent) => {
        if (isAgentMessage(event.data)) receive(JSON.parse(JSON.stringify(event.data)));
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'model-reaction-devtools-panel', kind: 'get-init' }, '*');
    return {
        send: (message) => window.postMessage(message, '*'),
        disconnect: () => window.removeEventListener('message', onMessage),
    };
};

test('real React observations connect to fields in Dependencies, update, reconnect, and unmount', async () => {
    const disposeAgent = installAgent(window);
    const first = createModel({ count: { type: 'number', default: 2 } });
    const second = createModel({ count: { type: 'number', default: 20 } });
    const selector = (data: { count: number }) => data.count;
    function Reader({ offset }: { offset: number }) {
        useModelSelector(first, selector);
        useModelComputed(first, (data) => data.count + offset);
        useModelComputed(second, selector);
        return null;
    }
    const reader = render(<StrictMode><Reader offset={1} /></StrictMode>);
    let panel = render(<Panel connect={connect} />);
    const values = () => Array.from(
        panel.container.querySelectorAll('.mrd-derived-entry .mrd-val-number'),
        (node) => node.textContent
    );
    try {
        await waitFor(() => expect(panel.getByRole('button', { name: 'Dependencies' })).toBeTruthy());
        fireEvent.click(panel.getByRole('button', { name: 'Dependencies' }));
        await waitFor(() => expect(values()).toEqual(['2', '3']));
        expect(panel.container.querySelectorAll('[data-derived-id]')).toHaveLength(2);
        expect(Array.from(panel.container.querySelectorAll('.mrd-derived-edge'), (edge) =>
            edge.getAttribute('data-from-field'))).toEqual(['count', 'count']);
        const region = panel.getByRole('region', { name: 'React derived values' });
        expect(within(region).getByText('selector:')).toBeTruthy();
        expect(region.textContent).toContain('(data) => data.count + offset:');
        expect(region.querySelectorAll('.mrd-derived-entry')[1]!.getAttribute('title'))
            .toBe('(data) => data.count + offset');
        const ids = Array.from(region.querySelectorAll('.mrd-derived-meta'), (node) => node.textContent);
        expect(ids[0]).toMatch(/^useModelSelector · #\d+$/);
        expect(ids[1]).toMatch(/^useModelComputed · #\d+$/);

        reader.rerender(<StrictMode><Reader offset={5} /></StrictMode>);
        await waitFor(() => expect(values()).toEqual(['2', '7']));
        expect(Array.from(region.querySelectorAll('.mrd-derived-meta'), (node) => node.textContent)).toEqual(ids);
        fireEvent.click(panel.getByRole('button', { name: 'Timeline' }));
        expect(panel.getByRole('button', { name: 'Clear' }).hasAttribute('disabled')).toBe(true);
        fireEvent.click(panel.getByRole('button', { name: 'Dependencies' }));

        await act(async () => { await first.setField('count', 4); });
        await waitFor(() => expect(values()).toEqual(['4', '9']));
        const models = panel.getAllByRole('button', { name: /^Model #/ });
        fireEvent.click(models[1]!);
        expect(values()).toEqual(['20']);
        expect(panel.container.querySelectorAll('[data-derived-id]')).toHaveLength(1);
        expect(panel.container.querySelectorAll('.mrd-derived-edge')).toHaveLength(1);
        expect(panel.container.querySelector('.mrd-derived-entry')!.textContent).toContain('selector:');

        panel.unmount();
        panel = render(<Panel connect={connect} />);
        await waitFor(() => expect(panel.getByRole('button', { name: 'Dependencies' })).toBeTruthy());
        fireEvent.click(panel.getByRole('button', { name: 'Dependencies' }));
        await waitFor(() => expect(values()).toEqual(['4', '9']));
        act(() => first.dispose());
        await waitFor(() => expect(values()).toEqual(['20']));
        reader.rerender(<StrictMode><Reader offset={6} /></StrictMode>);
        expect(panel.queryAllByRole('button', { name: /^Model #/ })).toHaveLength(0);
        expect(values()).toEqual(['20']);
        reader.unmount();
        await waitFor(() => expect(panel.getByText('no mounted selector hooks')).toBeTruthy());
        expect(panel.container.querySelectorAll('[data-derived-id]')).toHaveLength(0);
        expect(values()).toEqual([]);
    } finally {
        reader.unmount();
        panel.unmount();
        first.dispose();
        second.dispose();
        disposeAgent();
    }
});

test.each([useModelSelector, useModelComputed])(
    '%p updates real graph arrows when a conditional selection stays equal',
    async (useSelection) => {
        const disposeAgent = installAgent(window);
        const model = createModel({
            right: { type: 'boolean', default: false },
            a: { type: 'number', default: 2 },
            b: { type: 'number', default: 2 },
        });
        const selector = (data: typeof model.data) => data.right ? data.b : data.a;
        const renders = jest.fn();
        function Reader() { renders(); useSelection(model, selector); return null; }
        const reader = render(<Reader />);
        const panel = render(<Panel connect={connect} />);
        const sources = () => Array.from(panel.container.querySelectorAll('.mrd-derived-edge'),
            (edge) => edge.getAttribute('data-from-field')).sort();
        try {
            await waitFor(() => expect(panel.getByRole('button', { name: 'Dependencies' })).toBeTruthy());
            fireEvent.click(panel.getByRole('button', { name: 'Dependencies' }));
            await waitFor(() => expect(sources()).toEqual(['a', 'right']));
            const id = panel.container.querySelector('[data-derived-id]')!.getAttribute('data-derived-id');
            const count = renders.mock.calls.length;
            await act(async () => { await model.setField('right', true); });
            await waitFor(() => expect(sources()).toEqual(['b', 'right']));
            expect(renders).toHaveBeenCalledTimes(count);
            expect(panel.container.querySelector('[data-derived-id]')!.getAttribute('data-derived-id')).toBe(id);
            expect(panel.container.querySelector('.mrd-derived-entry .mrd-val-number')!.textContent).toBe('2');
        } finally {
            reader.unmount();
            panel.unmount();
            model.dispose();
            disposeAgent();
        }
    }
);
