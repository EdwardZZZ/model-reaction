import { createModel, type ModelReturn } from 'model-reaction';

interface Signup {
    username: string;
    normalized: string;
    availability: string;
}

async function checkAvailable(username: string): Promise<boolean> {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return !['admin', 'root'].includes(username);
}

async function runExample(): Promise<void> {
    let revision = 0;
    let active = true;
    const model: ModelReturn<Signup> = createModel<Signup>({
        username: { type: 'string', default: '' },
        availability: { type: 'string', default: 'idle' },
        normalized: { type: 'string', default: '', reaction: {
            fields: ['username'],
            computed: ({ username }) => username.trim().toLowerCase(),
            action: [async () => {
                const version = revision;
                const username = model.data.normalized;
                if (!username) return;
                model.setField('availability', 'checking');
                const available = await checkAvailable(username);
                // Running requests are not cancelled by the core scheduler.
                if (!active || version !== revision) return;
                model.setField('availability', available ? 'available' : 'taken');
            }],
        } },
    });
    const off = model.subscribe((data) => data.username, () => { revision++; });
    try {
        model.setField('username', 'newuser');
        console.log('立即写入:', model.data.username);
        await model.settled();
        console.log('异步结果:', model.data.availability);
        model.setField('username', 'admin');
        await model.settled();
        console.log('异步结果:', model.data.availability);
    } finally {
        active = false;
        off();
        model.dispose();
    }
}

runExample().catch((error) => { console.error(error); process.exitCode = 1; });
