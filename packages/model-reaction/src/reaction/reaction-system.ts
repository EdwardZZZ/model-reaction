import {
    Model,
    ModelError,
    ModelEvents,
    ModelOptions,
    SKIP_REACTION,
    ValidationError,
} from '../types';
import { eachReactionEdge } from './reaction-graph';
import { PendingTasks } from '../core/pending-tasks';
import { ActionExecutor } from './action-executor';

type ReactionErrorEvent =
    | typeof ModelEvents.REACTION_ERROR
    | typeof ModelEvents.DEPENDENCY_ERROR;

/** Internal context carried through reaction writeback. */
export interface ReactionWriteContext {
    reactionStack: string[];
    initializeReactions: boolean;
}

/** Internal contract between {@link ReactionSystem} and its owning model. */
interface ReactionCallbacks {
    getValue: (field: string) => any;
    setValue: (field: string, value: any, context: ReactionWriteContext) => Promise<boolean>;
    setError: (field: string, error: ValidationError) => void;
    reportError: (
        event: ReactionErrorEvent,
        error: ModelError
    ) => void;
}

interface ScheduledReaction {
    timeoutId: ReturnType<typeof setTimeout>;
    endTask: () => void;
}

export class ReactionSystem {
    private readonly dependentsByField = new Map<string, Set<string>>();
    private readonly initializingFields = new Set<string>();
    private readonly reactionTimeouts = new Map<string, ScheduledReaction>();
    private readonly actionExecutor: ActionExecutor;
    private disposed = false;

    constructor(
        private readonly schema: Model,
        private readonly options: ModelOptions,
        private readonly callbacks: ReactionCallbacks,
        private readonly pendingTasks: PendingTasks
    ) {
        this.actionExecutor = new ActionExecutor(
            pendingTasks,
            callbacks.getValue,
            (field, error) => this.handleReactionError(field, error)
        );
        this.collectReactions();
    }

    triggerReactionsForFields(
        changedFields: string[],
        reactionStack: string[] = [],
        initializeReactions = false
    ): void {
        if (this.disposed) return;
        const debounceTime = this.options.debounceReactions ?? 0;
        const firstSourceByOwner = new Map<string, string>();

        for (const changedField of changedFields) {
            for (const field of this.dependentsByField.get(changedField) ?? []) {
                if (!firstSourceByOwner.has(field)) {
                    firstSourceByOwner.set(field, changedField);
                }
            }
        }

        firstSourceByOwner.forEach((changedField, field) => {
            if (this.disposed) return;
            if (reactionStack.includes(field)) {
                this.callbacks.reportError(ModelEvents.REACTION_ERROR, {
                    code: 'circular_dependency',
                    field,
                    message: `Circular dependency detected: ${reactionStack.join(' -> ')} -> ${field}`,
                });
                return;
            }

            if (initializeReactions) this.initializingFields.add(field);
            this.scheduleReaction(field, debounceTime, [...reactionStack, changedField]);
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.actionExecutor.dispose();
        this.reactionTimeouts.forEach(({ timeoutId, endTask }) => {
            clearTimeout(timeoutId);
            endTask();
        });
        this.reactionTimeouts.clear();
        this.dependentsByField.clear();
        this.initializingFields.clear();
        // The shared PendingTasks is owned and disposed by ModelManager.
    }

    private collectReactions(): void {
        // Shared dependency parsing with DevTools; see docs/ARCHITECTURE.md.
        eachReactionEdge(this.schema, (field, depField) => {
            let dependents = this.dependentsByField.get(depField);
            if (!dependents) {
                dependents = new Set<string>();
                this.dependentsByField.set(depField, dependents);
            }
            dependents.add(field);
        });
    }

    private scheduleReaction(
        field: string,
        debounceTime: number,
        reactionStack: string[] = []
    ): void {
        // Register the replacement before releasing the old task so settled()
        // never observes a false idle state during debounce rescheduling.
        const endTask = this.pendingTasks.begin();
        const run = () => {
            void this.processReaction(field, reactionStack).finally(endTask);
        };
        if (debounceTime > 0) {
            const scheduled = this.reactionTimeouts.get(field);
            if (scheduled) {
                clearTimeout(scheduled.timeoutId);
                scheduled.endTask();
            }
            const pending: ScheduledReaction = {
                endTask,
                timeoutId: setTimeout(() => {
                    this.reactionTimeouts.delete(field);
                    run();
                }, debounceTime),
            };
            this.reactionTimeouts.set(field, pending);
        } else {
            run();
        }
    }

    private async processReaction(
        field: string,
        reactionStack: string[] = []
    ): Promise<void> {
        if (this.disposed) return;
        try {
            const reaction = this.schema[field]!.reaction!;
            const dependentValues: Record<string, any> = Object.create(null);
            for (const f of reaction.fields) {
                if (this.disposed) return;
                if (!Object.prototype.hasOwnProperty.call(this.schema, f)) {
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
            const computedValue = reaction.computed({ ...dependentValues });
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
            if (committed) {
                this.initializingFields.delete(field);
                this.actionExecutor.register(field, reaction.action);
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

}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as PromiseLike<unknown>).then === 'function'
    );
}
