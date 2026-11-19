import type { ReactElement } from 'react';
import type { InstanceState } from '../protocol';

interface InstancePickerProps {
    instances: InstanceState[];
    selectedId: number | null;
    onSelect: (id: number) => void;
}

export function InstancePicker({
    instances,
    selectedId,
    onSelect,
}: InstancePickerProps): ReactElement | null {
    if (instances.length <= 1) return null;

    return (
        <div className="mrd-instance-picker" role="group" aria-label="Models">
            {instances.map((instance) => {
                const fields = Object.keys(instance.fields);
                const preview = fields.slice(0, 3).join(', ') || 'No fields';
                const remaining = fields.length - 3;
                return (
                    <button
                        key={instance.id}
                        type="button"
                        className="mrd-instance-button"
                        aria-label={`Model #${instance.id}`}
                        aria-pressed={instance.id === selectedId}
                        title={`Model #${instance.id}\n${fields.join(', ') || 'No fields'}`}
                        onClick={() => onSelect(instance.id)}
                    >
                        <span className="mrd-instance-label">
                            Model #{instance.id}
                            <span className="mrd-instance-count">
                                {fields.length} {fields.length === 1 ? 'field' : 'fields'}
                            </span>
                        </span>
                        <span className="mrd-instance-summary">
                            {preview}{remaining > 0 ? `, +${remaining}` : ''}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
