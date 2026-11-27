import type { Model, Reaction } from '../types';

/** Visit declared dependency → computed edges without deduplication; see docs/ARCHITECTURE.md. */
export function eachReactionEdge(
    schema: Model,
    visit: (computedField: string, dependencyField: string, reaction: Reaction) => void
): void {
    for (const [computedField, { reaction }] of Object.entries(schema)) {
        if (!reaction) continue;
        for (const dependencyField of reaction.fields) {
            visit(computedField, dependencyField, reaction);
        }
    }
}
