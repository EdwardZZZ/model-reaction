/**
 * Options threaded through the internal write pipeline.
 * This type is shared by `ModelManager` and `ReactionSystem`, but is not part
 * of the package's public API.
 */
export interface CommitOptions {
    origin: 'direct' | 'reaction';
    reactionStack?: string[];
    /** Collect fields whose committed values actually changed. */
    changedFields?: Set<string>;
    initializeReactions?: boolean;
}
