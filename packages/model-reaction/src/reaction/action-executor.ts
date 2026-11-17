import { PendingTasks } from '../core/pending-tasks';
import type { ReactionAction } from '../types';
import type { ReactionJob } from './reaction-job';

interface ActionGroup {
    job: ReactionJob;
    version: number;
    actions: ReactionAction[];
    running: boolean;
    endTask: () => void;
}

/** Action group lifecycle and per-item barriers; see docs/ARCHITECTURE.md#action-scheduling. */
export class ActionExecutor {
    private fieldActionVersion = new Map<string, number>();
    private groups = new Set<ActionGroup>();
    private fieldOrder: Map<string, number>;
    private unsubscribe: () => void;
    private flushScheduled = false;
    private disposed = false;

    constructor(
        fields: string[],
        private readonly tasks: PendingTasks,
        private readonly onError: (field: string, error: unknown) => void
    ) {
        this.fieldOrder = new Map(fields.map((field, index) => [field, index]));
        this.unsubscribe = tasks.onComputeIdle(() => this.scheduleFlush());
    }

    invalidate(field: string): number {
        const version = (this.fieldActionVersion.get(field) ?? 0) + 1;
        this.fieldActionVersion.set(field, version);
        for (const group of this.groups) {
            if (group.job.field === field && !group.running) this.finish(group);
        }
        return version;
    }

    register(job: ReactionJob, version: number): void {
        if (this.disposed || this.fieldActionVersion.get(job.field) !== version) return;
        if (!job.reaction.action?.length) return;
        const actions = job.reaction.action.filter((action, index, all) => all.lastIndexOf(action) === index);
        for (const group of this.groups) {
            group.actions = group.actions.filter((action) => !actions.includes(action));
        }
        const group: ActionGroup = {
            job,
            version,
            actions,
            running: false,
            endTask: this.tasks.begin('action'),
        };
        this.groups.add(group);
        if (this.tasks.isComputeIdle) this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.disposed || this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            this.flushScheduled = false;
            this.flush();
        });
    }

    private isCurrent(group: ActionGroup): boolean {
        return !this.disposed && this.fieldActionVersion.get(group.job.field) === group.version;
    }

    private flush(): void {
        if (this.disposed || !this.tasks.isComputeIdle) return;
        const ready = [...this.groups]
            .filter((group) => !group.running)
            .sort((a, b) => this.fieldOrder.get(a.job.field)! - this.fieldOrder.get(b.job.field)!);
        for (const group of ready) {
            if (!this.isCurrent(group) || !group.actions.length) {
                this.finish(group);
                continue;
            }
            if (!this.tasks.isComputeIdle) return;
            group.running = true;
            try {
                const action = group.actions.shift()!;
                const result = action();
                void Promise.resolve(result).then(
                    () => this.completeItem(group),
                    (error) => this.fail(group, error)
                );
            } catch (error) {
                this.fail(group, error);
            }
        }
    }

    private completeItem(group: ActionGroup): void {
        group.running = false;
        if (!this.isCurrent(group) || !group.actions.length) {
            this.finish(group);
        } else {
            this.scheduleFlush();
        }
    }

    private fail(group: ActionGroup, error: unknown): void {
        try {
            this.onError(group.job.field, error);
        } finally {
            this.finish(group);
        }
    }

    private finish(group: ActionGroup): void {
        this.groups.delete(group);
        group.endTask();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
        for (const group of this.groups) this.finish(group);
        this.fieldActionVersion.clear();
    }
}
