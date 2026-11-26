/**
 * Tests for the `model-reaction/devtools` wrapper entry (`src/devtools.ts`):
 * registration through the global hook, snapshots via the public API, and the
 * zero-touch pass-through when no DevTools front-end is present.
 */
import * as devtoolsEntry from '../devtools';
import { createModel as baseCreateModel } from '../index';
import type { FieldSchema, Model, ValidationError } from '../types';
import { ValidationRules } from '../validation';

const { createModel } = devtoolsEntry;
const DEVTOOLS_HOOK_KEY = '__MODEL_REACTION_DEVTOOLS_HOOK__';

/** Test doubles describe the observable global-hook contract. */
interface DevtoolsChange {
    field: string;
    value: unknown;
    timestamp: number;
}

interface DevtoolsModelInstance {
    readonly id: number;
    getFields(): Record<string, {
        type: FieldSchema['type'];
        hasDefault: boolean;
        validatorCount: number;
        reactionDeps: string[];
        actions?: Array<{ reactionIndex: number; actionIndex: number; name: string; functionId: number }>;
    }>;
    getDependencyGraph(): {
        nodes: string[];
        edges: Array<{ from: string; to: string }>;
    };
    getSnapshot(): {
        data: Record<string, unknown>;
        dirtyData: Record<string, unknown>;
        errors: Record<string, ValidationError[]>;
    };
    subscribe(listener: (change: DevtoolsChange) => void): () => void;
    subscribeSnapshot?(listener: () => void): () => void;
}

interface ModelReactionDevtoolsHook {
    register(instance: DevtoolsModelInstance): void;
    unregister(id: number): void;
}

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
        expect(inst.getFields()).toBe(inst.getFields());
        expect(inst.getDependencyGraph()).toBe(graph);
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

    test('snapshot notifications include rejected input, dirty clearing, and reaction errors', async () => {
        const instances = installHook();
        const model = createModel({
            age: {
                type: 'number',
                default: 18,
                validator: [{ type: 'min', message: 'too small', validate: (v: number) => v >= 18 }],
            },
            derived: {
                type: 'number',
                default: 0,
                reaction: {
                    fields: ['age'],
                    computed: () => { throw new Error('compute failed'); },
                },
            },
        });
        await model.settled();
        const inst = instances[0]!;
        const snapshots: ReturnType<typeof inst.getSnapshot>[] = [];
        const changes: DevtoolsChange[] = [];
        const unsub = inst.subscribeSnapshot?.(() => snapshots.push(inst.getSnapshot()));
        const unsubChanges = inst.subscribe((change) => changes.push(change));

        await model.setField('age', 5);
        expect(snapshots.some((s) => s.dirtyData.age === 5 && s.errors.age?.length)).toBe(true);
        expect(changes).toHaveLength(0);
        model.clearDirtyData();
        expect(snapshots.at(-1)?.dirtyData).toEqual({});
        await model.setField('age', 20);
        await model.settled();
        expect(snapshots.at(-1)?.errors.derived?.[0]?.message).toContain('compute failed');

        unsub?.();
        unsubChanges();
        const count = snapshots.length;
        await model.setField('age', 6);
        expect(snapshots).toHaveLength(count);
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

    describe('hook contract', () => {
        test('lists action indices with reactionIndex zero without changing calculation edges', () => {
            function save() {}
            const instances = installHook();
            const model = createModel({
                source: { type: 'number' },
                target: { type: 'number', reaction: {
                    fields: ['source'], computed: () => 1, action: [save, save, () => {}],
                } },
            });
            const instance = instances[0]!;
            const fields = instance.getFields();
            expect(fields.target?.actions).toEqual([
                { reactionIndex: 0, actionIndex: 0, name: 'save', functionId: 0 },
                { reactionIndex: 0, actionIndex: 1, name: 'save', functionId: 0 },
                { reactionIndex: 0, actionIndex: 2, name: '', functionId: 1 },
            ]);
            expect(fields.source?.actions).toBeUndefined();
            expect(instance.getDependencyGraph()).toEqual({
                nodes: ['source', 'target'], edges: [{ from: 'source', to: 'target' }],
            });
            model.dispose();
        });

        test('identifies shared references across fields without merging same-name functions', () => {
            function save() {}
            const anotherSave = { save() {} }.save;
            const instances = installHook();
            const model = createModel({
                source: { type: 'number' },
                first: { type: 'number', reaction: {
                    fields: ['source'], computed: () => 1, action: [save, anotherSave],
                } },
                second: { type: 'number', reaction: {
                    fields: ['first'], computed: () => 2, action: [save],
                } },
            });
            const fields = instances[0]!.getFields();
            const first = fields.first!.actions!;
            const second = fields.second!.actions!;
            expect(first[0]!.name).toBe(first[1]!.name);
            expect(first[0]!.functionId).toBe(second[0]!.functionId);
            expect(first[0]!.functionId).not.toBe(first[1]!.functionId);
            expect(JSON.parse(JSON.stringify(fields))).toEqual(fields);
            model.dispose();
        });

        describe('hook detection', () => {
            test('exports only createModel and works when no hook is installed', () => {
                expect(Object.keys(devtoolsEntry)).toEqual(['createModel']);
                const model = createModel({ value: { type: 'number', default: 1 } });
                expect(model.getField('value')).toBe(1);
                model.dispose();
            });

            test('ignores a malformed hook with missing methods', () => {
                (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = {
                    register: 'not a function',
                };
                const model = createModel({});
                expect(() => model.dispose()).not.toThrow();
            });

            test('does not register when only one hook method is present', () => {
                const register = jest.fn();
                (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = { register };
                const model = createModel({});
                expect(register).not.toHaveBeenCalled();
                model.dispose();
            });

            test('uses the installed hook when it satisfies the contract', () => {
                const register = jest.fn();
                const unregister = jest.fn();
                (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = { register, unregister };
                const model = createModel({});
                expect(register).toHaveBeenCalledTimes(1);
                const instance = register.mock.calls[0]![0] as DevtoolsModelInstance;
                model.dispose();
                expect(unregister).toHaveBeenCalledWith(instance.id);
            });
        });

        describe('defensive registration', () => {
            test.each([0, 1])('keeps independent module copies registered when disposing model %i first', async (disposeFirst) => {
                const loadCopy = (): typeof createModel => {
                    let copy!: typeof createModel;
                    jest.isolateModules(() => {
                        copy = jest.requireActual<typeof devtoolsEntry>('../devtools').createModel;
                    });
                    return copy;
                };
                const registered = new Map<number, DevtoolsModelInstance>();
                const subscriptions = new Map<number, () => void>();
                const changes: Array<{ id: number; change: DevtoolsChange }> = [];
                const hook = Object.freeze({
                    register(instance: DevtoolsModelInstance) {
                        registered.set(instance.id, instance);
                        subscriptions.set(instance.id, instance.subscribe((change) => {
                            changes.push({ id: instance.id, change });
                        }));
                    },
                    unregister(id: number) {
                        subscriptions.get(id)?.();
                        subscriptions.delete(id);
                        registered.delete(id);
                    },
                });
                const descriptors = Object.getOwnPropertyDescriptors(hook);
                (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = hook;
                const firstCopy = loadCopy();
                const secondCopy = loadCopy();
                const models = [
                    firstCopy({ value: { type: 'number', default: 1 } }),
                    secondCopy({ value: { type: 'number', default: 2 } }),
                ];
                try {
                    expect(registered.size).toBe(2);
                    const ids = [...registered.keys()];
                    expect(ids.every(Number.isSafeInteger)).toBe(true);
                    expect(ids[0]).not.toBe(ids[1]);
                    await models[0]!.setField('value', 11);
                    await models[1]!.setField('value', 22);
                    expect(changes.map(({ id, change }) => [id, change.value]))
                        .toEqual([[ids[0], 11], [ids[1], 22]]);
                    models[disposeFirst]!.dispose();
                    const remaining = 1 - disposeFirst;
                    expect([...registered.keys()]).toEqual([ids[remaining]]);
                    await models[remaining]!.setField('value', 33);
                    expect(changes.at(-1)).toEqual({
                        id: ids[remaining],
                        change: { field: 'value', value: 33, timestamp: expect.any(Number) },
                    });
                    expect(registered.get(ids[remaining]!)!.getSnapshot().data.value).toBe(33);
                    models[remaining]!.dispose();
                    expect(registered.size).toBe(0);
                    expect(subscriptions.size).toBe(0);
                    expect(Object.getOwnPropertyDescriptors(hook)).toEqual(descriptors);
                } finally {
                    models.forEach((model) => model.dispose());
                    subscriptions.forEach((unsubscribe) => unsubscribe());
                }
            });

            test('assigns a unique id and forwards each model to register', () => {
                const registered = installHook();
                const first = createModel({});
                const second = createModel({});
                expect(registered).toHaveLength(2);
                expect(registered[0]!.id).not.toBe(registered[1]!.id);
                first.dispose();
                second.dispose();
            });

            test('model disposal calls unregister with the instance id', () => {
                let registeredId = -1;
                let unregisteredId = -1;
                (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = {
                    register: (instance) => { registeredId = instance.id; },
                    unregister: (id) => { unregisteredId = id; },
                } satisfies ModelReactionDevtoolsHook;
                const model = createModel({});
                model.dispose();
                expect(unregisteredId).toBe(registeredId);
            });

            test('swallows a throwing register without attempting unregister', () => {
                const hook: ModelReactionDevtoolsHook = {
                    register: () => { throw new Error('devtools boom'); },
                    unregister: jest.fn(),
                };
                (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = hook;
                const model = createModel({});
                expect(() => model.dispose()).not.toThrow();
                expect(hook.unregister).not.toHaveBeenCalled();
            });

            test('swallows a throwing unregister', () => {
                (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = {
                    register: () => {},
                    unregister: () => { throw new Error('unregister boom'); },
                } satisfies ModelReactionDevtoolsHook;
                const model = createModel({});
                expect(() => model.dispose()).not.toThrow();
            });
        });

        describe('field metadata', () => {
            test('summarises type, default, validator count, and reaction deps', () => {
                const instances = installHook();
                const model = createModel({
                    first: { type: 'string', default: '' },
                    last: {
                        type: 'string',
                        validator: [ValidationRules.required],
                    },
                    full: {
                        type: 'string',
                        reaction: {
                            fields: ['first', 'last'],
                            computed: (v) => `${v.first} ${v.last}`,
                        },
                    },
                });
                const info = instances[0]!.getFields();
                expect(info.first).toEqual({
                    type: 'string',
                    hasDefault: true,
                    validatorCount: 0,
                    reactionDeps: [],
                });
                expect(info.last!.hasDefault).toBe(false);
                expect(info.last!.validatorCount).toBe(1);
                expect(info.full!.reactionDeps).toEqual(['first', 'last']);
                model.dispose();
            });

            test('dedupes repeated reaction dependencies', () => {
                const instances = installHook();
                const model = createModel({
                    a: { type: 'number', default: 0 },
                    b: { type: 'number', default: 0 },
                    c: {
                        type: 'number',
                        reaction: { fields: ['a', 'b', 'a'], computed: (v) => v.a + v.b },
                    },
                });
                expect(instances[0]!.getFields().c!.reactionDeps).toEqual(['a', 'b']);
                model.dispose();
            });
        });

        describe('dependency graph', () => {
            test('nodes cover every field; edges point dependency -> computed', () => {
                const instances = installHook();
                const model = createModel({
                    firstName: { type: 'string', default: '' },
                    lastName: { type: 'string', default: '' },
                    fullName: {
                        type: 'string',
                        reaction: {
                            fields: ['firstName', 'lastName'],
                            computed: (v) => `${v.firstName} ${v.lastName}`,
                        },
                    },
                });
                const graph = instances[0]!.getDependencyGraph();
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

            test('a schema with no reactions has nodes but no edges', () => {
                const instances = installHook();
                const model = createModel({
                    a: { type: 'string', default: '' },
                    b: { type: 'number', default: 0 },
                });
                expect(instances[0]!.getDependencyGraph()).toEqual({
                    nodes: ['a', 'b'], edges: [],
                });
                model.dispose();
            });

            test('dedupes repeated dependencies into a single edge', () => {
                const instances = installHook();
                const model = createModel({
                    a: { type: 'number', default: 0 },
                    b: { type: 'number', default: 0 },
                    sum: {
                        type: 'number',
                        reaction: { fields: ['a', 'b', 'a'], computed: (v) => v.a + v.b },
                    },
                });
                const edges = instances[0]!.getDependencyGraph().edges;
                expect(edges.filter((e) => e.from === 'a' && e.to === 'sum')).toHaveLength(1);
                model.dispose();
            });
        });
    });
});
