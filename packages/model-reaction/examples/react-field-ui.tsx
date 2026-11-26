import { useState } from 'react';
import { createModel } from 'model-reaction';
import { shallow, useModelComputed, useModelFieldState } from 'model-reaction/react';

/** A business function can receive the field's UI state setter. */
export function applyDeliveryRestriction(setRestriction: (message: string) => void): void {
    setRestriction('The courier cannot leave this parcel unattended.');
}

export function createDeliveryModel() {
    return createModel({
        deliveryRequired: { type: 'boolean', default: true },
        readonly: { type: 'boolean', default: false },
        leaveAtDoor: { type: 'boolean', default: false },
    });
}

/** The caller owns and disposes the model; see react-bindings-runner.tsx. */
export function FieldUiExample({
    model,
}: {
    model: ReturnType<typeof createDeliveryModel>;
}) {
    const [deliveryRequired, setDeliveryRequired] = useModelFieldState(model, 'deliveryRequired');
    const [readonly, setReadonly] = useModelFieldState(model, 'readonly');
    const [leaveAtDoor, setLeaveAtDoor] = useModelFieldState(model, 'leaveAtDoor');
    const [restriction, setRestriction] = useState<string | null>(null);
    const ui = useModelComputed(model, (data) => ({
        show: data.deliveryRequired,
        disabled: data.readonly || restriction !== null,
        description: restriction ?? (data.readonly
            ? 'Delivery options are locked.'
            : 'The courier may leave the parcel at your door.'),
    }), shallow);

    return (
        <fieldset>
            <legend>Field UI state</legend>
            <label>
                <input
                    type="checkbox"
                    checked={deliveryRequired}
                    onChange={(event) => void setDeliveryRequired(event.target.checked)}
                />
                Delivery required
            </label>
            <label>
                <input
                    type="checkbox"
                    checked={readonly}
                    onChange={(event) => void setReadonly(event.target.checked)}
                />
                Lock delivery options
            </label>
            <button type="button" onClick={() => applyDeliveryRestriction(setRestriction)}>
                Apply courier restriction
            </button>
            {ui.show && (
                <label>
                    <input
                        data-field="leaveAtDoor"
                        type="checkbox"
                        checked={leaveAtDoor}
                        disabled={ui.disabled}
                        onChange={(event) => void setLeaveAtDoor(event.target.checked)}
                    />
                    Leave at door
                    <small>{ui.description}</small>
                </label>
            )}
        </fieldset>
    );
}
