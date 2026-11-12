import type { Model, Reaction } from '../types';

export function eachReaction(
    schema: Model,
    visit: (field: string, reaction: Reaction) => void
): void {
    for (const [name, field] of Object.entries(schema)) {
        if (!field.reaction) continue;
        visit(name, field.reaction);
    }
}

/**
 * The single definition of how a schema's `reaction` declarations are read as
 * dependency edges.
 *
 * Both the runtime reaction index ({@link ReactionSystem.collectReactions}) and
 * the DevTools field / graph derivation consume this, so the
 * "`reaction.fields` → edge" reading lives in exactly one place and cannot
 * drift between them.
 *
 * For every reaction on every field, `visit` is invoked once per declared
 * dependency. Direction is data-flow: `dependencyField` feeds `computedField`
 * (when `dependencyField` changes, the reaction that produces `computedField`
 * re-runs).
 *
 * Raw and undeduped: a repeated dependency yields that edge twice.
 * Consumers that want unique edges dedupe
 * themselves (e.g. via a `Set`) — this keeps the primitive faithful to the
 * schema and lets each consumer choose its own grouping.
 */
export function eachReactionEdge(
    schema: Model,
    visit: (computedField: string, dependencyField: string, reaction: Reaction) => void
): void {
    eachReaction(schema, (computedField, reaction) => {
        for (const dependencyField of reaction.fields) {
            visit(computedField, dependencyField, reaction);
        }
    });
}
