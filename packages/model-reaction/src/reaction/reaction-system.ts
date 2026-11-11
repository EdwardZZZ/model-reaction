import {
    CommitOptions,
    Model,
    ModelError,
    ModelErrorEvent,
    ModelEvents,
    ModelOptions,
    Reaction,
    SKIP_REACTION,
    ValidationError,
} from '../types';
import { eachReactionEdge } from './reaction-graph';
import { PendingTasks } from '../core/pending-tasks';

/** Internal contract between {@link ReactionSystem} and its owning model. */
interface ReactionCallbacks {
    getValue: (field: string) => any;
    setValue: (field: string, value: any, options?: CommitOptions) => Promise<boolean>;
    setError: (field: string, error: ValidationError) => void;
    reportError: (
        event: Exclude<ModelErrorEvent, 'field:not-found'>,
        error: ModelError
    ) => void;
}

interface ReactionJob {
    field: string;
    reaction: Reaction;
}

interface ScheduledReaction {
    reactionStack: string[];
    endTask: () => void;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as PromiseLike<unknown>).then === 'function'
    );
}

export class ReactionSystem {
    private reactionDeps: Map<string, ReactionJob[]> = new Map();
    private initializingFields = new Set<string>();
    private reactionTimeouts: Map<
        string,
        {
            timeoutId: ReturnType<typeof setTimeout>;
            jobs: Map<ReactionJob, ScheduledReaction>;
        }
    > = new Map();
    private schema: Model;
    private options: ModelOptions;
    private callbacks: ReactionCallbacks;
    private pendingTasks: PendingTasks;
    private disposed = false;

    constructor(
        schema: Model,
        options: ModelOptions,
        callbacks: ReactionCallbacks,
        pendingTasks: PendingTasks
    ) {
        this.schema = schema;
        this.options = options;
        this.callbacks = callbacks;
        this.pendingTasks = pendingTasks;
        this.collectReactions();
    }

    private collectReactions(): void {
        // The "reaction.fields → edge" reading lives in eachReactionEdge, so
        // this index and the DevTools graph never diverge on how dependencies
        // are interpreted.
        const jobsByField = new Map<string, Map<Reaction, ReactionJob>>();
        eachReactionEdge(this.schema, (field, depField, reaction) => {
            let fieldJobs = jobsByField.get(field);
            if (!fieldJobs) {
                fieldJobs = new Map();
                jobsByField.set(field, fieldJobs);
            }
            let job = fieldJobs.get(reaction);
            if (!job) {
                job = { field, reaction };
                fieldJobs.set(reaction, job);
            }
            if (!this.reactionDeps.has(depField)) {
                this.reactionDeps.set(depField, []);
            }
            this.reactionDeps.get(depField)!.push(job);
        });
    }

    public triggerReactionsForFields(
        changedFields: string[],
        reactionStack: string[] = [],
        initializeReactions = false
    ): void {
        if (this.disposed) return;
        const debounceTime = this.options.debounceReactions ?? 0;
        const jobsToTrigger = new Map<ReactionJob, string>();

        changedFields.forEach((changedField) => {
            const deps = this.reactionDeps.get(changedField);
            if (deps) {
                deps.forEach((job) => {
                    if (!jobsToTrigger.has(job)) {
                        jobsToTrigger.set(job, changedField);
                    }
                });
            }
        });

        if (jobsToTrigger.size === 0) return;

        jobsToTrigger.forEach((changedField, job) => {
            if (this.disposed) return;
            const { field } = job;
            if (reactionStack.includes(field)) {
                this.callbacks.reportError(ModelEvents.REACTION_ERROR, {
                    code: 'circular_dependency',
                    field,
                    message: `Circular dependency detected: ${reactionStack.join(' -> ')} -> ${field}`,
                });
                return;
            }

            if (initializeReactions) this.initializingFields.add(field);
            this.scheduleReaction(job, debounceTime, [...reactionStack, changedField]);
        });
    }

    private scheduleReaction(
        job: ReactionJob,
        debounceTime: number,
        reactionStack: string[] = []
    ): void {
        // Register the replacement before releasing the old task so settled()
        // never observes a false idle state during debounce rescheduling.
        const endTask = this.pendingTasks.begin();
        if (debounceTime > 0) {
            const scheduled = this.reactionTimeouts.get(job.field);
            const jobs = scheduled?.jobs ?? new Map<ReactionJob, ScheduledReaction>();
            if (scheduled) {
                clearTimeout(scheduled.timeoutId);
                jobs.get(job)?.endTask();
                jobs.delete(job);
            }
            jobs.set(job, { reactionStack, endTask });
            const timeoutId = setTimeout(() => {
                this.reactionTimeouts.delete(job.field);
                for (const [pendingJob, pending] of jobs) {
                    this.runReaction(
                        pendingJob,
                        pending.reactionStack,
                        pending.endTask
                    );
                }
            }, debounceTime);
            this.reactionTimeouts.set(job.field, { timeoutId, jobs });
        } else {
            this.runReaction(job, reactionStack, endTask);
        }
    }

    private runReaction(
        job: ReactionJob,
        reactionStack: string[],
        endTask: () => void
    ): void {
        void this.processReaction(job, reactionStack).finally(endTask);
    }

    private async processReaction(
        job: ReactionJob,
        reactionStack: string[] = []
    ): Promise<void> {
        if (this.disposed) return;
        const { field, reaction } = job;
        try {
            const dependentValues: Record<string, any> = {};
            for (const f of reaction.fields) {
                if (this.disposed) return;
                if (!(f in this.schema)) {
                    this.callbacks.reportError(ModelEvents.DEPENDENCY_ERROR, {
                        code: 'dependency_error',
                        field,
                        message: `Dependency field ${f} is not defined`,
                    });
                    dependentValues[f] = undefined;
                    continue;
                }
                dependentValues[f] = this.callbacks.getValue(f);
            }

            if (this.disposed) return;
            const computedValue = reaction.computed(dependentValues);
            if (computedValue === SKIP_REACTION) return;
            if (isPromiseLike(computedValue)) {
                // Observe a rejected promise to avoid an unhandled rejection
                // after reporting the synchronous-contract violation.
                void Promise.resolve(computedValue).catch(() => undefined);
                throw new TypeError(
                    'reaction.computed must return synchronously; move async work to reaction.action'
                );
            }
            if (this.disposed) return;
            const committed = await this.callbacks.setValue(field, computedValue, {
                reactionStack,
                initializeReactions: this.initializingFields.has(field),
            });
            if (this.disposed) return;
            if (committed) this.initializingFields.delete(field);
            if (committed && reaction.action) {
                await reaction.action({
                    ...dependentValues,
                    computed: computedValue,
                });
            }
        } catch (error) {
            this.handleReactionError(field, error);
        }
    }

    private handleReactionError(field: string, error: unknown): void {
        if (this.disposed) return;
        const originalError = error instanceof Error ? error : new Error(String(error));
        const modelError: ModelError = {
            code: 'reaction_error',
            field,
            message: originalError.message,
            originalError,
        };
        // Record the failure under the field the reaction computes, so it is
        // visible before subscribers receive the reaction error event.
        this.callbacks.setError(field, {
            field,
            rule: 'reaction_error',
            message: modelError.message,
        });
        this.callbacks.reportError(ModelEvents.REACTION_ERROR, modelError);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.reactionTimeouts.forEach(({ timeoutId, jobs }) => {
            clearTimeout(timeoutId);
            jobs.forEach(({ endTask }) => endTask());
        });
        this.reactionTimeouts.clear();
        this.reactionDeps.clear();
        this.initializingFields.clear();
        // The shared PendingTasks is owned and disposed by ModelManager.
    }
}
