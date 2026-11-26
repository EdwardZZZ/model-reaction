import { createModel } from 'model-reaction';
import { useModelFieldState, type FieldMetaSetter } from 'model-reaction/react';

interface DeliveryMeta {
    show: boolean;
    disabled: boolean;
    description: string;
}

/** A business function outside React can receive the field's metadata setter. */
export function applyDeliveryRestriction(setMeta: FieldMetaSetter<DeliveryMeta>): void {
    setMeta({ disabled: true, description: 'The courier cannot leave this parcel unattended.' });
}

export function createDeliveryModel() {
    return createModel({
        deliveryRequired: { type: 'boolean', default: true },
        readonly: { type: 'boolean', default: false },
        leaveAtDoor: { type: 'boolean', default: false },
    });
}

/** The caller owns and disposes the model; see react-bindings-runner.tsx. */
export function FieldMetaExample({
    model,
}: {
    model: ReturnType<typeof createDeliveryModel>;
}) {
    const [deliveryRequired, setDeliveryRequired] = useModelFieldState(model, 'deliveryRequired');
    const [readonly, setReadonly] = useModelFieldState(model, 'readonly');
    const [leaveAtDoor, setLeaveAtDoor, meta, setMeta] = useModelFieldState(model, 'leaveAtDoor', {
        meta: (data) => ({
            show: data.deliveryRequired,
            disabled: data.readonly,
            description: data.readonly
                ? 'Delivery options are locked.'
                : 'The courier may leave the parcel at your door.',
        }),
    });

    return (
        <fieldset>
            <legend>Optional field metadata</legend>
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
            <button type="button" onClick={() => applyDeliveryRestriction(setMeta)}>
                Apply courier restriction
            </button>
            {meta.show && (
                <label>
                    <input
                        data-field="leaveAtDoor"
                        type="checkbox"
                        checked={leaveAtDoor}
                        disabled={meta.disabled}
                        onChange={(event) => void setLeaveAtDoor(event.target.checked)}
                    />
                    Leave at door
                    <small>{meta.description}</small>
                </label>
            )}
        </fieldset>
    );
}
