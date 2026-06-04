import { Model, ModelError, Reaction } from './types';

export interface ReactionCallbacks {
    getValue: (field: string) => any;
    /** Returns true if the value passed validation and was committed. */
    setValue: (
        field: string,
        value: any,
        options?: { reactionStack?: string[] }
    ) => boolean;
    onError: (error: ModelError) => void;
}

/**
 * Synchronous reaction system.
 *
 * No debounce, no async scheduler — when a dependency changes we run the
 * reaction immediately within the same tick. The circular-dependency guard
 * is preserved so misbehaving schemas still surface a clear error instead of
 * blowing the stack.
 */
export class ReactionSystem {
    private reactionDeps: Map<string, Array<{ field: string; reaction: Reaction }>> = new Map();
    private schema: Model;
    private callbacks: ReactionCallbacks;

    constructor(schema: Model, callbacks: ReactionCallbacks) {
        this.schema = schema;
        this.callbacks = callbacks;
        this.collectReactions();
    }

    private collectReactions(): void {
        Object.entries(this.schema).forEach(([field, schema]) => {
            if (!schema.reaction) return;
            const reactions = Array.isArray(schema.reaction)
                ? schema.reaction
                : [schema.reaction];
            reactions.forEach((reaction) => {
                reaction.fields.forEach((depField) => {
                    if (!this.reactionDeps.has(depField)) {
                        this.reactionDeps.set(depField, []);
                    }
                    this.reactionDeps.get(depField)!.push({ field, reaction });
                });
            });
        });
    }

    triggerReactions(changedField: string, reactionStack: string[] = []): void {
        this.triggerReactionsForFields([changedField], reactionStack);
    }

    triggerReactionsForFields(
        changedFields: string[],
        reactionStack: string[] = []
    ): void {
        const reactionsToTrigger = new Map<Reaction, string>();
        changedFields.forEach((changedField) => {
            const deps = this.reactionDeps.get(changedField);
            if (deps) deps.forEach((d) => reactionsToTrigger.set(d.reaction, d.field));
        });
        if (reactionsToTrigger.size === 0) return;

        reactionsToTrigger.forEach((field, reaction) => {
            if (reactionStack.includes(field)) {
                this.callbacks.onError({
                    kind: 'reaction',
                    field,
                    message: `Circular dependency detected: ${reactionStack.join(' -> ')} -> ${field}`,
                });
                return;
            }
            this.runReaction(field, reaction, [...reactionStack, ...changedFields]);
        });
    }

    private runReaction(
        field: string,
        reaction: Reaction,
        reactionStack: string[]
    ): void {
        try {
            const dependentValues = reaction.fields.reduce((values, f) => {
                if (!(f in this.schema)) {
                    this.callbacks.onError({
                        kind: 'reaction',
                        field,
                        message: `Dependency field ${f} is not defined`,
                    });
                    return { ...values, [f]: undefined };
                }
                return { ...values, [f]: this.callbacks.getValue(f) };
            }, {} as Record<string, any>);

            const computedValue = reaction.computed(dependentValues);
            this.callbacks.setValue(field, computedValue, { reactionStack });
            if (reaction.action) {
                reaction.action({ ...dependentValues, computed: computedValue });
            }
        } catch (error) {
            this.callbacks.onError({
                kind: 'reaction',
                field,
                message: (error as Error).message,
                cause: error as Error,
            });
        }
    }

    dispose(): void {
        this.reactionDeps.clear();
    }
}
