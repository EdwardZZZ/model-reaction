import {
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
    setValue: (field: string, value: any, options?: { reactionStack?: string[] }) => Promise<boolean>;
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as PromiseLike<unknown>).then === 'function'
    );
}

export class ReactionSystem {
    private reactionDeps: Map<string, ReactionJob[]> = new Map();
    private reactionTimeouts: Map<
        ReactionJob,
        { timeoutId: ReturnType<typeof setTimeout>; endTask: () => void }
    > = new Map();
    private reactionQueues: Map<string, Promise<void>> = new Map();
    private schema: Model;
    private options: ModelOptions;
    private callbacks: ReactionCallbacks;
    private pendingTasks: PendingTasks;

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

    public triggerReactions(changedField: string, reactionStack: string[] = []): void {
        this.triggerReactionsForFields([changedField], reactionStack);
    }

    public triggerReactionsForFields(
        changedFields: string[],
        reactionStack: string[] = []
    ): void {
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
            const { field } = job;
            if (reactionStack.includes(field)) {
                this.callbacks.reportError(ModelEvents.REACTION_ERROR, {
                    code: 'circular_dependency',
                    field,
                    message: `Circular dependency detected: ${reactionStack.join(' -> ')} -> ${field}`,
                });
                return;
            }

            this.scheduleReaction(job, debounceTime, [
                ...reactionStack,
                changedField,
            ]);
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
        const scheduled = this.reactionTimeouts.get(job);
        if (scheduled) {
            clearTimeout(scheduled.timeoutId);
            scheduled.endTask();
        }

        if (debounceTime > 0) {
            const timeoutId = setTimeout(() => {
                this.reactionTimeouts.delete(job);
                this.runReaction(job, reactionStack, endTask);
            }, debounceTime);
            this.reactionTimeouts.set(job, { timeoutId, endTask });
        } else {
            this.runReaction(job, reactionStack, endTask);
        }
    }

    private runReaction(
        job: ReactionJob,
        reactionStack: string[],
        endTask: () => void
    ): void {
        const previous = this.reactionQueues.get(job.field);
        const work = previous
            ? previous.then(() => this.processReaction(job, reactionStack))
            : this.processReaction(job, reactionStack);
        const queued = work.finally(endTask);
        this.reactionQueues.set(job.field, queued);

        const cleanup = (): void => {
            if (this.reactionQueues.get(job.field) === queued) {
                this.reactionQueues.delete(job.field);
            }
        };
        void queued.then(cleanup, cleanup);
    }

    private async processReaction(
        job: ReactionJob,
        reactionStack: string[] = []
    ): Promise<void> {
        const { field, reaction } = job;
        try {
            const dependentValues: Record<string, any> = {};
            for (const f of reaction.fields) {
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
            const committed = await this.callbacks.setValue(field, computedValue, { reactionStack });
            if (committed && reaction.action) {
                await reaction.action({
                    ...dependentValues,
                    computed: computedValue,
                });
            }
        } catch (error) {
            this.handleReactionError(field, error as Error);
        }
    }

    private handleReactionError(field: string, error: Error): void {
        const modelError: ModelError = {
            code: 'reaction_error',
            field,
            message: error.message,
            originalError: error,
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
        this.reactionTimeouts.forEach(({ timeoutId, endTask }) => {
            clearTimeout(timeoutId);
            endTask();
        });
        this.reactionTimeouts.clear();
        this.reactionQueues.clear();
        this.reactionDeps.clear();
        // The shared PendingTasks is owned and disposed by ModelManager.
    }
}
