import { createModel, ModelEvents } from 'model-reaction';

const model = createModel({
    name: { type: 'string', default: '' },
    greeting: { type: 'string', reaction: {
        fields: ['name'], computed: ({ name }) => `Hello ${name}`,
    } },
});
const off = model.on(ModelEvents.FIELD_CHANGE, ({ field, value }) => {
    console.log(`${field}: ${value}`);
});
model.on(ModelEvents.FIELD_NOT_FOUND, (error) => console.error(error.message));
model.on(ModelEvents.REACTION_ERROR, (error) => console.error(error.message));
try {
    model.setField('name', 'Ada');
    off();
    model.setField('name', 'Grace');
} finally {
    model.dispose();
}
