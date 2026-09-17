import {
    DEVTOOLS_HOOK_KEY,
    attachToDevtools,
    buildDependencyGraph,
    buildFieldInfo,
    getDevtoolsHook,
    type DevtoolsModelInstance,
    type ModelReactionDevtoolsHook,
} from '../devtools-hook';
import { Model, ValidationRules } from '../index';

/** Restore the global hook slot after each test, whatever it was. */
function clearHook(): void {
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY];
}

describe('devtools-hook', () => {
    afterEach(() => {
        clearHook();
        jest.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // getDevtoolsHook — the hot-path guard
    // -------------------------------------------------------------------------

    describe('getDevtoolsHook', () => {
        test('returns undefined when no hook is installed', () => {
            expect(getDevtoolsHook()).toBeUndefined();
        });

        test('returns undefined for a malformed hook (missing methods)', () => {
            (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = {
                register: 'not a function',
            };
            expect(getDevtoolsHook()).toBeUndefined();
        });

        test('returns undefined when only one method is present', () => {
            (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = {
                register: () => {},
            };
            expect(getDevtoolsHook()).toBeUndefined();
        });

        test('returns the hook when it satisfies the contract', () => {
            const hook: ModelReactionDevtoolsHook = {
                register: () => {},
                unregister: () => {},
            };
            (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = hook;
            expect(getDevtoolsHook()).toBe(hook);
        });
    });

    // -------------------------------------------------------------------------
    // attachToDevtools — defensive registration
    // -------------------------------------------------------------------------

    describe('attachToDevtools', () => {
        const instance: Omit<DevtoolsModelInstance, 'id'> = {
            getFields: () => ({}),
            getDependencyGraph: () => ({ nodes: [], edges: [] }),
            getSnapshot: () => ({ data: {}, dirtyData: {}, errors: {} }),
            subscribe: () => () => {},
        };

        test('assigns a unique id and forwards to register', () => {
            const registered: DevtoolsModelInstance[] = [];
            const hook: ModelReactionDevtoolsHook = {
                register: (i) => registered.push(i),
                unregister: () => {},
            };
            attachToDevtools(hook, instance);
            attachToDevtools(hook, instance);
            expect(registered).toHaveLength(2);
            expect(registered[0]!.id).not.toBe(registered[1]!.id);
        });

        test('returned disposer calls unregister with the instance id', () => {
            let registeredId = -1;
            let unregisteredId = -1;
            const hook: ModelReactionDevtoolsHook = {
                register: (i) => (registeredId = i.id),
                unregister: (id) => (unregisteredId = id),
            };
            const detach = attachToDevtools(hook, instance);
            detach();
            expect(unregisteredId).toBe(registeredId);
        });

        test('swallows a throwing register and returns a no-op disposer', () => {
            const hook: ModelReactionDevtoolsHook = {
                register: () => {
                    throw new Error('devtools boom');
                },
                unregister: jest.fn(),
            };
            const detach = attachToDevtools(hook, instance);
            expect(() => detach()).not.toThrow();
            // register failed, so nothing should be unregistered.
            expect(hook.unregister).not.toHaveBeenCalled();
        });

        test('swallows a throwing unregister', () => {
            const hook: ModelReactionDevtoolsHook = {
                register: () => {},
                unregister: () => {
                    throw new Error('unregister boom');
                },
            };
            const detach = attachToDevtools(hook, instance);
            expect(() => detach()).not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // buildFieldInfo — pure schema summary
    // -------------------------------------------------------------------------

    describe('buildFieldInfo', () => {
        test('summarises type, default, validator count, and reaction deps', () => {
            const schema: Model = {
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
            };
            const info = buildFieldInfo(schema);
            expect(info.first).toEqual({
                type: 'string',
                hasDefault: true,
                validatorCount: 0,
                reactionDeps: [],
            });
            expect(info.last!.hasDefault).toBe(false);
            expect(info.last!.validatorCount).toBe(1);
            expect(info.full!.reactionDeps).toEqual(['first', 'last']);
        });

        test('dedupes reaction deps across multiple reactions on one field', () => {
            const schema: Model = {
                a: { type: 'number', default: 0 },
                b: { type: 'number', default: 0 },
                c: {
                    type: 'number',
                    reaction: [
                        { fields: ['a', 'b'], computed: (v) => v.a + v.b },
                        { fields: ['a'], computed: (v) => v.a },
                    ],
                },
            };
            expect(buildFieldInfo(schema).c!.reactionDeps).toEqual(['a', 'b']);
        });
    });

    // -------------------------------------------------------------------------
    // buildDependencyGraph — projection of buildFieldInfo
    // -------------------------------------------------------------------------

    describe('buildDependencyGraph', () => {
        test('nodes cover every field; edges point dependency -> computed', () => {
            const schema: Model = {
                firstName: { type: 'string', default: '' },
                lastName: { type: 'string', default: '' },
                fullName: {
                    type: 'string',
                    reaction: {
                        fields: ['firstName', 'lastName'],
                        computed: (v) => `${v.firstName} ${v.lastName}`,
                    },
                },
            };
            const graph = buildDependencyGraph(schema);
            expect(graph.nodes).toEqual(['firstName', 'lastName', 'fullName']);
            expect(graph.edges).toEqual(
                expect.arrayContaining([
                    { from: 'firstName', to: 'fullName' },
                    { from: 'lastName', to: 'fullName' },
                ])
            );
            expect(graph.edges).toHaveLength(2);
        });

        test('a schema with no reactions has nodes but no edges', () => {
            const schema: Model = {
                a: { type: 'string', default: '' },
                b: { type: 'number', default: 0 },
            };
            const graph = buildDependencyGraph(schema);
            expect(graph.nodes).toEqual(['a', 'b']);
            expect(graph.edges).toEqual([]);
        });

        test('dedupes repeated dependencies into a single edge', () => {
            const schema: Model = {
                a: { type: 'number', default: 0 },
                b: { type: 'number', default: 0 },
                sum: {
                    type: 'number',
                    reaction: [
                        { fields: ['a', 'b'], computed: (v) => v.a + v.b },
                        { fields: ['a'], computed: (v) => v.a },
                    ],
                },
            };
            const edges = buildDependencyGraph(schema).edges;
            expect(edges.filter((e) => e.from === 'a' && e.to === 'sum')).toHaveLength(1);
        });
    });
});
