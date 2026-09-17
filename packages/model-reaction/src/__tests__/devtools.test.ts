/**
 * Tests for the `model-reaction/devtools` wrapper entry (`src/devtools.ts`):
 * registration through the global hook, snapshots via the public API, and the
 * zero-touch pass-through when no DevTools front-end is present.
 */
import { createModel } from '../devtools';
import { createModel as baseCreateModel } from '../index';
import {
    DEVTOOLS_HOOK_KEY,
    type DevtoolsChange,
    type DevtoolsModelInstance,
    type ModelReactionDevtoolsHook,
} from '../devtools-hook';
import type { Model } from '../types';

interface Person {
    firstName: string;
    lastName: string;
    fullName: string;
}

const schema: Model<Person> = {
    firstName: { type: 'string', default: '' },
    lastName: { type: 'string', default: '' },
    fullName: {
        type: 'string',
        default: '',
        reaction: {
            fields: ['firstName', 'lastName'],
            computed: (v) => `${v.firstName} ${v.lastName}`.trim(),
        },
    },
};

/** Install a capturing hook and return the live registry it fills. */
function installHook(): DevtoolsModelInstance[] {
    const instances: DevtoolsModelInstance[] = [];
    const hook: ModelReactionDevtoolsHook = {
        register: (i) => instances.push(i),
        unregister: (id) => {
            const idx = instances.findIndex((i) => i.id === id);
            if (idx >= 0) instances.splice(idx, 1);
        },
    };
    (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = hook;
    return instances;
}

function clearHook(): void {
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY];
}

describe('model-reaction/devtools createModel', () => {
    afterEach(() => {
        clearHook();
        jest.restoreAllMocks();
    });

    test('behaves like the base createModel when no hook is present', async () => {
        const model = createModel<Person>(schema);
        await model.setField('firstName', 'Ada');
        await model.setField('lastName', 'Lovelace');
        await model.settled();
        expect(model.getField('fullName')).toBe('Ada Lovelace');
        model.dispose();
    });

    test('does not register anything when no hook is present', () => {
        // Nothing to assert against a registry, but construction + dispose must
        // stay clean with no front-end listening.
        const model = createModel<Person>(schema);
        expect(() => model.dispose()).not.toThrow();
    });

    test('registers on creation and unregisters on dispose', () => {
        const instances = installHook();
        const model = createModel<Person>(schema);
        expect(instances).toHaveLength(1);
        model.dispose();
        expect(instances).toHaveLength(0);
    });

    test('exposes fields and dependency graph derived from the schema', () => {
        const instances = installHook();
        const model = createModel<Person>(schema);
        const inst = instances[0]!;

        expect(inst.getFields().fullName!.reactionDeps).toEqual([
            'firstName',
            'lastName',
        ]);
        const graph = inst.getDependencyGraph();
        expect(graph.nodes).toEqual(['firstName', 'lastName', 'fullName']);
        expect(graph.edges).toEqual(
            expect.arrayContaining([
                { from: 'firstName', to: 'fullName' },
                { from: 'lastName', to: 'fullName' },
            ])
        );
        expect(graph.edges).toHaveLength(2);
        model.dispose();
    });

    test('snapshot reflects committed data (via the public getter)', async () => {
        const instances = installHook();
        const model = createModel<Person>(schema);
        const inst = instances[0]!;

        await model.setField('firstName', 'Grace');
        await model.settled();
        expect(inst.getSnapshot().data.firstName).toBe('Grace');
        model.dispose();
    });

    test('snapshot surfaces dirtyData and errors for failed validation', async () => {
        const instances = installHook();
        const withValidator: Model = {
            age: {
                type: 'number',
                default: 0,
                validator: [
                    {
                        type: 'min',
                        message: 'too small',
                        validate: (v: number) => v >= 18,
                    },
                ],
            },
        };
        const model = createModel(withValidator);
        const inst = instances[0]!;

        await model.setField('age', 5);
        const snap = inst.getSnapshot();
        expect(snap.dirtyData.age).toBe(5);
        expect(snap.errors.age!.length).toBeGreaterThan(0);
        model.dispose();
    });

    test('subscribe forwards committed changes, including reaction writes', async () => {
        const instances = installHook();
        const model = createModel<Person>(schema);
        const inst = instances[0]!;

        const changes: DevtoolsChange[] = [];
        const unsub = inst.subscribe((c) => changes.push(c));

        await model.setField('firstName', 'Ada');
        await model.settled();

        const fields = changes.map((c) => c.field);
        expect(fields).toContain('firstName'); // direct write
        expect(fields).toContain('fullName'); // reaction-derived write
        changes.forEach((c) => expect(typeof c.timestamp).toBe('number'));

        unsub();
        model.dispose();
    });

    test('a broken hook never breaks the model', () => {
        (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = {
            register: () => {
                throw new Error('devtools boom');
            },
            unregister: () => {},
        } satisfies ModelReactionDevtoolsHook;

        // Registration throws internally but is swallowed; the model works and
        // dispose stays safe.
        const model = createModel<Person>(schema);
        expect(model.getField('fullName')).toBe('');
        expect(() => model.dispose()).not.toThrow();
    });

    test('the base entry does not register (proves opt-in is required)', () => {
        const instances = installHook();
        const model = baseCreateModel<Person>(schema);
        // Importing from the root must not wire DevTools.
        expect(instances).toHaveLength(0);
        model.dispose();
    });
});
