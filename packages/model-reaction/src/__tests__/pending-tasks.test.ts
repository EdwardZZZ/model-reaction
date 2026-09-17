import { PendingTasks } from '../pending-tasks';

describe('PendingTasks', () => {
    let tasks: PendingTasks;

    beforeEach(() => {
        tasks = new PendingTasks();
    });

    // -------------------------------------------------------------------------
    // Idle / baseline behaviour
    // -------------------------------------------------------------------------

    describe('idle state', () => {
        test('settled() resolves immediately when no task is pending', async () => {
            await expect(tasks.settled()).resolves.toBeUndefined();
        });

        test('settled() resolves in the same microtask when idle', async () => {
            let resolved = false;
            tasks.settled().then(() => {
                resolved = true;
            });
            // A single microtask flush is enough for an already-resolved promise.
            await Promise.resolve();
            expect(resolved).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Single task lifecycle
    // -------------------------------------------------------------------------

    describe('single task', () => {
        test('settled() stays pending while a task is in flight', async () => {
            const end = tasks.begin();

            let resolved = false;
            const settledPromise = tasks.settled().then(() => {
                resolved = true;
            });

            // Give any accidental early resolution a chance to run.
            await Promise.resolve();
            await Promise.resolve();
            expect(resolved).toBe(false);

            end();
            await settledPromise;
            expect(resolved).toBe(true);
        });

        test('settled() called after the task already ended resolves immediately', async () => {
            const end = tasks.begin();
            end();
            await expect(tasks.settled()).resolves.toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // Concurrent tasks: the core of "settled observes the whole chain"
    // -------------------------------------------------------------------------

    describe('concurrent tasks', () => {
        test('settled() waits for ALL concurrent tasks, not just the first', async () => {
            const endA = tasks.begin();
            const endB = tasks.begin();
            const endC = tasks.begin();

            let resolved = false;
            const settledPromise = tasks.settled().then(() => {
                resolved = true;
            });

            endA();
            await Promise.resolve();
            expect(resolved).toBe(false); // B and C still pending

            endB();
            await Promise.resolve();
            expect(resolved).toBe(false); // C still pending

            endC();
            await settledPromise;
            expect(resolved).toBe(true); // all done
        });

        test('a task started while another is pending keeps settled() waiting', async () => {
            const endA = tasks.begin();

            let resolved = false;
            const settledPromise = tasks.settled().then(() => {
                resolved = true;
            });

            // New work registered before A finishes must extend the settle window.
            const endB = tasks.begin();
            endA();
            await Promise.resolve();
            expect(resolved).toBe(false);

            endB();
            await settledPromise;
            expect(resolved).toBe(true);
        });

        test('order of end callbacks does not matter', async () => {
            const endA = tasks.begin();
            const endB = tasks.begin();

            const settledPromise = tasks.settled();

            endB();
            endA();

            await expect(settledPromise).resolves.toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // end-callback idempotency: guards against double-decrement races
    // -------------------------------------------------------------------------

    describe('end-callback idempotency', () => {
        test('calling the same end callback twice does not double-decrement', async () => {
            const endA = tasks.begin();
            const endB = tasks.begin();

            let resolved = false;
            const settledPromise = tasks.settled().then(() => {
                resolved = true;
            });

            endA();
            endA(); // second call must be a no-op

            await Promise.resolve();
            // B is still pending; a double-decrement would have wrongly hit zero.
            expect(resolved).toBe(false);

            endB();
            await settledPromise;
            expect(resolved).toBe(true);
        });

        test('repeated end calls after settle do not corrupt later cycles', async () => {
            const end = tasks.begin();
            end();
            end();
            end();
            await expect(tasks.settled()).resolves.toBeUndefined();

            // A fresh task cycle must still behave correctly.
            const end2 = tasks.begin();
            let resolved = false;
            const settledPromise = tasks.settled().then(() => {
                resolved = true;
            });
            await Promise.resolve();
            expect(resolved).toBe(false);
            end2();
            await settledPromise;
            expect(resolved).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Debounce-style rescheduling: register replacement before releasing old
    // -------------------------------------------------------------------------

    describe('reschedule without a false idle window', () => {
        test('settled() does not resolve early when a task is replaced back-to-back', async () => {
            // Mirrors ReactionSystem.scheduleReaction: begin the replacement
            // task BEFORE ending the previous one, so count never dips to 0.
            const endOld = tasks.begin();

            let resolved = false;
            const settledPromise = tasks.settled().then(() => {
                resolved = true;
            });

            const endNew = tasks.begin(); // replacement registered first
            endOld(); // old released after

            await Promise.resolve();
            await Promise.resolve();
            expect(resolved).toBe(false); // must still be waiting on endNew

            endNew();
            await settledPromise;
            expect(resolved).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Multiple settled() waiters
    // -------------------------------------------------------------------------

    describe('multiple settled() waiters', () => {
        test('all waiters registered before completion resolve together', async () => {
            const end = tasks.begin();

            const order: string[] = [];
            const p1 = tasks.settled().then(() => order.push('w1'));
            const p2 = tasks.settled().then(() => order.push('w2'));
            const p3 = tasks.settled().then(() => order.push('w3'));

            await Promise.resolve();
            expect(order).toEqual([]);

            end();
            await Promise.all([p1, p2, p3]);
            expect(order).toEqual(['w1', 'w2', 'w3']);
        });

        test('a waiter registered after completion resolves immediately', async () => {
            const end = tasks.begin();
            const early = tasks.settled();
            end();
            await early;

            // Now idle again — new waiter should resolve without new work.
            await expect(tasks.settled()).resolves.toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // dispose()
    // -------------------------------------------------------------------------

    describe('dispose', () => {
        test('dispose() wakes up pending settled() waiters', async () => {
            tasks.begin(); // never ended on purpose

            const settledPromise = tasks.settled();
            tasks.dispose();

            // Without dispose waking waiters, this would hang forever.
            await expect(settledPromise).resolves.toBeUndefined();
        });

        test('settled() resolves immediately after dispose', async () => {
            tasks.begin();
            tasks.dispose();
            await expect(tasks.settled()).resolves.toBeUndefined();
        });

        test('begin() after dispose returns a no-op end and stays settled', async () => {
            tasks.dispose();

            const end = tasks.begin();
            expect(typeof end).toBe('function');
            expect(() => end()).not.toThrow();

            await expect(tasks.settled()).resolves.toBeUndefined();
        });

        test('ending a pre-dispose task after dispose does not throw or go negative', async () => {
            const end = tasks.begin();
            tasks.dispose();

            // Late completion of in-flight work must be safely ignored.
            expect(() => end()).not.toThrow();
            await expect(tasks.settled()).resolves.toBeUndefined();
        });

        test('dispose() is idempotent', () => {
            tasks.begin();
            expect(() => {
                tasks.dispose();
                tasks.dispose();
            }).not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // Real async interleaving (timers / microtasks)
    // -------------------------------------------------------------------------

    describe('real async interleaving', () => {
        test('settled() awaits tasks that finish on different timer ticks', async () => {
            jest.useFakeTimers();
            try {
                const endFast = tasks.begin();
                const endSlow = tasks.begin();

                setTimeout(() => endFast(), 10);
                setTimeout(() => endSlow(), 50);

                let resolved = false;
                const settledPromise = tasks.settled().then(() => {
                    resolved = true;
                });

                jest.advanceTimersByTime(10);
                await Promise.resolve();
                expect(resolved).toBe(false); // slow task still pending

                jest.advanceTimersByTime(40);
                await settledPromise;
                expect(resolved).toBe(true);
            } finally {
                jest.useRealTimers();
            }
        });

        test('sequential begin/end cycles each settle independently', async () => {
            for (let i = 0; i < 3; i++) {
                const end = tasks.begin();
                let resolved = false;
                const settledPromise = tasks.settled().then(() => {
                    resolved = true;
                });
                await Promise.resolve();
                expect(resolved).toBe(false);
                end();
                await settledPromise;
                expect(resolved).toBe(true);
            }
        });

        test('a new task after a fully-settled cycle re-arms settled()', async () => {
            const end1 = tasks.begin();
            end1();
            await tasks.settled(); // cycle 1 done, count back to 0

            const end2 = tasks.begin();
            let resolved = false;
            const settledPromise = tasks.settled().then(() => {
                resolved = true;
            });
            await Promise.resolve();
            expect(resolved).toBe(false);

            end2();
            await settledPromise;
            expect(resolved).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // dispose-time concurrent wakeup — extreme edge cases
    // -------------------------------------------------------------------------

    describe('dispose concurrent wakeup — extreme edges', () => {
        test('dispose() wakes EVERY waiter even while many tasks are still pending', async () => {
            // count is forced to 0 by dispose, so waiters must fire despite
            // three tasks never being ended.
            tasks.begin();
            tasks.begin();
            tasks.begin();

            const order: number[] = [];
            const waiters = [0, 1, 2, 3, 4].map((i) =>
                tasks.settled().then(() => order.push(i))
            );

            await Promise.resolve();
            expect(order).toEqual([]); // nothing resolves before dispose

            tasks.dispose();
            await Promise.all(waiters);
            expect(order).toEqual([0, 1, 2, 3, 4]);
        });

        test('waiters registered both before AND after dispose all resolve', async () => {
            tasks.begin();

            const before = tasks.settled();
            tasks.dispose();
            const after = tasks.settled();

            await expect(Promise.all([before, after])).resolves.toEqual([
                undefined,
                undefined,
            ]);
        });

        test('re-entrant settled() inside a dispose-woken resolver resolves immediately', async () => {
            tasks.begin();

            let innerResolved = false;
            const outer = tasks.settled().then(() =>
                // Called while already disposed — must not hang.
                tasks.settled().then(() => {
                    innerResolved = true;
                })
            );

            tasks.dispose();
            await outer;
            expect(innerResolved).toBe(true);
        });

        test('re-entrant dispose() inside a dispose-woken resolver is safe', async () => {
            tasks.begin();

            let threw = false;
            const p = tasks.settled().then(() => {
                try {
                    tasks.dispose(); // second dispose from within a resolver
                } catch {
                    threw = true;
                }
            });

            tasks.dispose();
            await p;
            expect(threw).toBe(false);
        });

        test('begin() inside a dispose-woken resolver is a no-op and does not re-arm settled()', async () => {
            tasks.begin();

            let endType = '';
            const p = tasks.settled().then(() => {
                const end = tasks.begin();
                endType = typeof end;
                end();
            });

            tasks.dispose();
            await p;

            expect(endType).toBe('function');
            // The resolver's begin() must not leave the tracker pending.
            await expect(tasks.settled()).resolves.toBeUndefined();
        });

        test('staggered pre-dispose task completions after wakeup keep count non-negative', async () => {
            const end1 = tasks.begin();
            const end2 = tasks.begin();

            const woken = tasks.settled();
            tasks.dispose();
            await woken; // resolved by dispose, not by end1/end2

            // Late, out-of-order completions of in-flight work must be ignored.
            expect(() => {
                end2();
                end1();
                end2(); // duplicate late completion too
            }).not.toThrow();

            // If count had gone negative, a fresh waiter could hang; it must not.
            await expect(tasks.settled()).resolves.toBeUndefined();
        });

        test('dispose() wakes a single waiter once under a large concurrent task load', async () => {
            const ends = Array.from({ length: 100 }, () => tasks.begin());

            let resolveCount = 0;
            const waiter = tasks.settled().then(() => {
                resolveCount++;
            });

            tasks.dispose();
            await waiter;
            // Flush extra microtasks to prove no double-resolution side effects.
            await Promise.resolve();
            await Promise.resolve();
            expect(resolveCount).toBe(1);

            // Draining all 100 in-flight tasks post-dispose must stay safe.
            expect(() => ends.forEach((end) => end())).not.toThrow();
            await expect(tasks.settled()).resolves.toBeUndefined();
        });

        test('dispose() with pending tasks but zero waiters does not throw and leaves tracker settled', async () => {
            tasks.begin();
            tasks.begin();

            // notifyIfIdle must early-return on empty resolver list.
            expect(() => tasks.dispose()).not.toThrow();
            await expect(tasks.settled()).resolves.toBeUndefined();
        });
    });
});
