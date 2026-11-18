import { PendingTasks } from '../core/pending-tasks';
import type { ReactionAction } from '../types';
import type { ReactionJob } from './reaction-job';

interface PendingAction {
    field: string;
    endTask: () => void;
}

/** Last-registration action queue; see docs/ARCHITECTURE.md#action-scheduling. */
export class ActionExecutor {
    private pending = new Map<ReactionAction, PendingAction>();
    private unsubscribe: () => void;
    private flushScheduled = false;
    private disposed = false;

    constructor(
        private readonly tasks: PendingTasks,
        private readonly onError: (field: string, error: unknown) => void
    ) {
        this.unsubscribe = tasks.onComputeIdle(() => this.scheduleFlush());
    }

    register(job: ReactionJob): void {
        if (this.disposed) return;
        for (const action of job.reaction.action ?? []) {
            const endTask = this.pending.get(action)?.endTask ?? this.tasks.begin('action');
            this.pending.delete(action);
            this.pending.set(action, { field: job.field, endTask });
        }
        if (this.pending.size && this.tasks.isComputeIdle) this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.disposed || this.flushScheduled || !this.pending.size) return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            this.flushScheduled = false;
            this.flush();
        });
    }

    private flush(): void {
        if (this.disposed || !this.tasks.isComputeIdle) return;
        const ready = [...this.pending];
        this.pending.clear();
        for (const [action, pending] of ready) {
            if (this.disposed) pending.endTask();
            else void this.run(action, pending);
        }
    }

    private async run(action: ReactionAction, pending: PendingAction): Promise<void> {
        try {
            await action();
        } catch (error) {
            if (!this.disposed) this.onError(pending.field, error);
        } finally {
            pending.endTask();
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
        for (const pending of this.pending.values()) pending.endTask();
        this.pending.clear();
    }
}
