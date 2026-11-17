import { createModel } from 'model-reaction';

const model = createModel({
    name: { type: 'string', default: '', transform: (value) => value.trim() },
    age: { type: 'number', default: 18 },
    summary: {
        type: 'string',
        reaction: {
            fields: ['name', 'age'],
            computed: ({ name, age }) => `${name} (${age})`,
        },
    },
});

try {
    model.setFields({ name: ' John Doe ', age: 30 });
    console.log('同步派生结果:', model.data.summary);
    const off = model.subscribe((data) => data.age, (age, previous) => {
        console.log(`年龄: ${previous} → ${age}`);
    });
    model.setField('age', 31);
    off();
    console.log('只读快照:', model.data);
} finally {
    model.dispose();
}
