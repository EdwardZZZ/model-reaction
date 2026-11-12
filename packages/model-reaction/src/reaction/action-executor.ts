import { PendingTasks } from '../core/pending-tasks';
import type { ReactionJob } from './reaction-job';

interface ActionGroup {
    job: ReactionJob;
    version: number;
    index: number;
    running: boolean;
    endTask: () => void;
}

/** Candidate handoff and per-item barriers; see docs/DESIGN_EFFECT_DEPS_CN.md §4–5. */
export class ActionExecutor {
    private fieldActionVersion = new Map<string, number>();
    private pendingActions = new Map<string, ActionGroup>();
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
        this.unsubscribe = tasks.onComputeIdle(() => this.handoff());
    }

    invalidate(field: string): number {
        const version = (this.fieldActionVersion.get(field) ?? 0) + 1;
        this.fieldActionVersion.set(field, version);
        const pending = this.pendingActions.get(field);
        if (pending) this.finish(pending);
        for (const group of this.groups) {
            if (group.job.field === field && !group.running) this.finish(group);
        }
        return version;
    }

    register(job: ReactionJob, version: number): void {
        if (this.disposed || this.fieldActionVersion.get(job.field) !== version) return;
        if (!job.reaction.action?.length) return;
        const previous = this.pendingActions.get(job.field);
        const group: ActionGroup = {
            job,
            version,
            index: 0,
            running: false,
            endTask: this.tasks.begin('action'),
        };
        if (previous) this.finish(previous);
        this.pendingActions.set(job.field, group);
        if (this.tasks.isComputeIdle) this.handoff();
    }

    private handoff(): void {
        if (this.disposed || !this.tasks.isComputeIdle) return;
        const candidates = this.pendingActions;
        this.pendingActions = new Map();
        for (const group of candidates.values()) this.groups.add(group);
        this.scheduleFlush();
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
            if (!this.isCurrent(group)) {
                this.finish(group);
                continue;
            }
            if (!this.tasks.isComputeIdle) return;
            group.running = true;
            try {
                const action = group.job.reaction.action![group.index]!;
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
        group.index++;
        if (!this.isCurrent(group) || group.index >= group.job.reaction.action!.length) {
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
        if (this.pendingActions.get(group.job.field) === group) {
            this.pendingActions.delete(group.job.field);
        }
        this.groups.delete(group);
        group.endTask();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
        for (const group of this.pendingActions.values()) this.finish(group);
        for (const group of this.groups) this.finish(group);
        this.fieldActionVersion.clear();
    }
}
