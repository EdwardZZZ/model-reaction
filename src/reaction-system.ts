import { Model, ModelOptions, Reaction, ValidationError } from './types';
import { ErrorHandler } from './error-handler';

export interface ReactionCallbacks {
    getValue: (field: string) => any;
    setValue: (field: string, value: any, options?: { reactionStack?: string[] }) => Promise<boolean>;
    emit: (event: string, data: any) => void;
    setError: (field: string, error: ValidationError) => void;
}

export class ReactionSystem {
    private reactionDeps: Map<string, Array<{ field: string; reaction: Reaction }>> = new Map();
    private reactionTimeouts: Map<Reaction, any> = new Map();
    private schema: Model;
    private options: ModelOptions;
    private callbacks: ReactionCallbacks;
    private errorHandler: ErrorHandler;

    constructor(schema: Model, options: ModelOptions, callbacks: ReactionCallbacks, errorHandler: ErrorHandler) {
        this.schema = schema;
        this.options = options;
        this.callbacks = callbacks;
        this.errorHandler = errorHandler;
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
        const debounceTime = this.options.debounceReactions || 0;
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
                const error = this.errorHandler.createCircularDependencyError(reactionStack.join(' -> '), field);
                this.errorHandler.triggerError(error);
                return;
            }

            this.scheduleReaction(field, reaction, debounceTime, [...reactionStack, ...changedFields]);
        });
    }

    private scheduleReaction(field: string, reaction: Reaction, debounceTime: number, reactionStack: string[] = []): void {
        if (this.reactionTimeouts.has(reaction)) {
            clearTimeout(this.reactionTimeouts.get(reaction));
        }

        if (debounceTime > 0) {
            const timeoutId = setTimeout(() => {
                this.reactionTimeouts.delete(reaction);
                this.processReaction(field, reaction, reactionStack);
            }, debounceTime);
            this.reactionTimeouts.set(reaction, timeoutId);
        } else {
            this.processReaction(field, reaction, reactionStack);
        }
    }

    private async processReaction(field: string, reaction: Reaction, reactionStack: string[] = []): Promise<void> {
        try {
            const dependentValues = reaction.fields.reduce((values, f) => {
                const val = this.callbacks.getValue(f);
                if (val === undefined) {
                    const error = this.errorHandler.createDependencyError(field, f);
                    this.errorHandler.triggerError(error);
                    return { ...values, [f]: undefined };
                }
                return { ...values, [f]: val };
            }, {} as Record<string, any>);

            try {
                const computedValue = reaction.computed(dependentValues);
                await this.callbacks.setValue(field, computedValue, { reactionStack });
                if (reaction.action) {
                    reaction.action({ ...dependentValues, computed: computedValue });
                }
            } catch (error) {
                this.handleReactionError(field, error as Error);
            }
        } catch (error) {
            this.handleReactionError(field, error as Error);
        }
    }

    private handleReactionError(field: string, error: Error): void {
        const appError = this.errorHandler.createReactionError(field, error);
        this.errorHandler.triggerError(appError);
        
        this.callbacks.setError('__reactions', {
            field,
            rule: 'reaction_error',
            message: appError.message
        });
    }

    public dispose(): void {
        this.reactionTimeouts.forEach((timeoutId) => {
            clearTimeout(timeoutId);
        });
        this.reactionTimeouts.clear();
        this.reactionDeps.clear();
    }

    public async settled(): Promise<void> {
        if (this.reactionTimeouts.size === 0) return;
        
        return new Promise<void>(resolve => {
            const check = () => {
                if (this.reactionTimeouts.size === 0) {
                    resolve();
                } else {
                    setTimeout(check, 10);
                }
            };
            check();
        });
    }
}
