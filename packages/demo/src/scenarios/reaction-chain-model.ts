import { createModel } from 'model-reaction/devtools';
import type { ModelReturn } from 'model-reaction';
import { ValidationRules } from 'model-reaction/validation';

export interface NameForm {
    firstName: string;
    lastName: string;
    fullName: string;
    greeting: string;
    nameActionRuns: number;
    capturedFullName: string;
    capturedGreeting: string;
}

async function captureFullName(): Promise<void> {
    await nameModel.setField('capturedFullName', nameModel.getField('fullName'));
}

export const nameModel: ModelReturn<NameForm> = createModel<NameForm>({
    firstName: {
        type: 'string',
        default: 'Ada',
        validator: [ValidationRules.required.withMessage('First name required')],
    },
    lastName: {
        type: 'string',
        default: 'Lovelace',
        validator: [ValidationRules.required.withMessage('Last name required')],
    },
    fullName: {
        type: 'string',
        default: '',
        reaction: {
            fields: ['firstName', 'lastName'],
            computed: ({ firstName, lastName }) =>
                `${firstName} ${lastName}`.trim(),
            action: [
                async function countNameAction() {
                    await nameModel.setField('nameActionRuns', nameModel.getField('nameActionRuns') + 1);
                },
                captureFullName,
            ],
        },
    },
    greeting: {
        type: 'string',
        default: '',
        reaction: {
            fields: ['fullName'],
            computed: ({ fullName }) =>
                fullName ? `Hello, ${fullName}!` : 'Hello, stranger!',
            action: [
                captureFullName,
                async function captureGreeting({ value }) {
                    await nameModel.setField('capturedGreeting', value);
                },
            ],
        },
    },
    nameActionRuns: { type: 'number', default: 0 },
    capturedFullName: { type: 'string', default: '' },
    capturedGreeting: { type: 'string', default: '' },
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => nameModel.dispose());
}
