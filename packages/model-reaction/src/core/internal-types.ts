/**
 * Options threaded through the internal validate → commit pipeline.
 * This type is shared by `ModelManager` and `ReactionSystem`, but is not part
 * of the package's public API.
 */
export interface CommitOptions {
    origin: 'direct' | 'reaction';
    reactionStack?: string[];
    /** Collect fields whose committed values actually changed. */
    changedFields?: Set<string>;
    /** Shared candidate data used by all validators in a direct batch. */
    validationData?: Readonly<Record<string, any>>;
    initializeReactions?: boolean;
}
