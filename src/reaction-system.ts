import {
    Model,
    ModelError,
    ModelErrorEvent,
    ModelEvents,
    ModelOptions,
    Reaction,
    ValidationError,
} from './types';
import { PendingTasks } from './pending-tasks';

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

export class ReactionSystem {
    private reactionDeps: Map<string, Array<{ field: string; reaction: Reaction }>> = new Map();
    private reactionTimeouts: Map<
        Reaction,
        { timeoutId: ReturnType<typeof setTimeout>; endTask: () => void }
    > = new Map();
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
        Object.entries(this.schema).forEach(([field, schema]) => {
            if (schema.reaction) {
                const reactions = Array.isArray(schema.reaction) ? schema.reaction : [schema.reaction];
                reactions.forEach(reaction => {
                    reaction.fields.forEach(depField => {
                        if (!this.reactionDeps.has(depField)) {
                            this.reactionDeps.set(depField, []);
                        }
                        this.reactionDeps.get(depField)!.push({ field, reaction });
                    });
                });
            }
        });
    }

    public triggerReactions(changedField: string, reactionStack: string[] = []): void {
        this.triggerReactionsForFields([changedField], reactionStack);
    }

    public triggerReactionsForFields(changedFields: string[], reactionStack: string[] = []): void {
        const debounceTime = this.options.debounceReactions ?? 0;
        const reactionsToTrigger = new Map<Reaction, string>();

        changedFields.forEach(changedField => {
            const deps = this.reactionDeps.get(changedField);
            if (deps) {
                deps.forEach(d => reactionsToTrigger.set(d.reaction, d.field));
            }
        });
        
        if (reactionsToTrigger.size === 0) return;

        reactionsToTrigger.forEach((field, reaction) => {
            if (reactionStack.includes(field)) {
                this.callbacks.reportError(ModelEvents.REACTION_ERROR, {
                    code: 'circular_dependency',
                    field,
                    message: `Circular dependency detected: ${reactionStack.join(' -> ')} -> ${field}`,
                });
                return;
            }

            this.scheduleReaction(field, reaction, debounceTime, [...reactionStack, ...changedFields]);
        });
    }

    private scheduleReaction(field: string, reaction: Reaction, debounceTime: number, reactionStack: string[] = []): void {
        // Register the replacement before releasing the old task so settled()
        // never observes a false idle state during debounce rescheduling.
        const endTask = this.pendingTasks.begin();
        const scheduled = this.reactionTimeouts.get(reaction);
        if (scheduled) {
            clearTimeout(scheduled.timeoutId);
            scheduled.endTask();
        }

        if (debounceTime > 0) {
            const timeoutId = setTimeout(() => {
                this.reactionTimeouts.delete(reaction);
                this.runReaction(field, reaction, reactionStack, endTask);
            }, debounceTime);
            this.reactionTimeouts.set(reaction, { timeoutId, endTask });
        } else {
            this.runReaction(field, reaction, reactionStack, endTask);
        }
    }

    private runReaction(
        field: string,
        reaction: Reaction,
        reactionStack: string[],
        endTask: () => void
    ): void {
        this.processReaction(field, reaction, reactionStack).finally(() => {
            endTask();
        });
    }

    private async processReaction(field: string, reaction: Reaction, reactionStack: string[] = []): Promise<void> {
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
            await this.callbacks.setValue(field, computedValue, { reactionStack });
            if (reaction.action) {
                reaction.action({ ...dependentValues, computed: computedValue });
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
        this.callbacks.reportError(ModelEvents.REACTION_ERROR, modelError);

        // Record the failure under the field the reaction computes, so it is
        // reachable via `validationErrors[field]` rather than a hidden key.
        this.callbacks.setError(field, {
            field,
            rule: 'reaction_error',
            message: modelError.message
        });
    }

    public dispose(): void {
        this.reactionTimeouts.forEach(({ timeoutId, endTask }) => {
            clearTimeout(timeoutId);
            endTask();
        });
        this.reactionTimeouts.clear();
        this.reactionDeps.clear();
        // The shared PendingTasks is owned and disposed by ModelManager.
    }
}
