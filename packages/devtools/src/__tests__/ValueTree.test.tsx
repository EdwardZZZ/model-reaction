import { fireEvent, render } from '@testing-library/react';
import { ValueTree } from '../panel/ValueTree';
import { DEFAULT_SERIALIZE_OPTIONS, serializeValue } from '../serialize';

describe('ValueTree', () => {
    test('renders symbol labels even when their descriptions match another key', () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const value = serializeValue({
            'Symbol(tag)': 1,
            [Symbol('tag')]: 2,
            [Symbol('tag')]: 3,
        });
        const { container, getAllByText } = render(<ValueTree value={value} />);
        expect(getAllByText('Symbol(tag):')).toHaveLength(3);
        expect(Array.from(container.querySelectorAll('.mrd-val-number'), (node) => node.textContent))
            .toEqual(['1', '2', '3']);
        expect(error).not.toHaveBeenCalled();
    });

    test('renders Map keys, Set members, and RegExp types after JSON transport', () => {
        const value = JSON.parse(JSON.stringify(serializeValue(new Map<unknown, unknown>([
            [{ id: 42 }, new Set(['paid'])],
            ['pattern', /invoice/gi],
        ]))));
        const { container, getByRole } = render(<ValueTree value={value} />);
        expect(container.textContent).toContain('Map(2)');
        expect(container.textContent).toContain('RegExp /invoice/gi');
        fireEvent.click(getByRole('button', { name: /0 key:.*Object/ }));
        expect(container.textContent).toContain('id: 42');
        fireEvent.keyDown(getByRole('button', { name: /0 value:.*Set/ }), { key: 'Enter' });
        expect(container.textContent).toContain('"paid"');
        fireEvent.click(getByRole('button', { name: /Map\(2\)/ }));
        expect(container.textContent).not.toContain('invoice');
    });

    test.each([
        ['map', new Map([[1, 2], [3, 4]])],
        ['set', new Set([1, 2])],
    ])('renders %s truncation without claiming the collection is empty', (_kind, value) => {
        const serialized = serializeValue(value, { ...DEFAULT_SERIALIZE_OPTIONS, maxItems: 1 });
        const { container } = render(<ValueTree value={serialized} />);
        expect(container.textContent).toContain('1 more item(s)');
        expect(container.textContent).toContain('1');
    });
});
