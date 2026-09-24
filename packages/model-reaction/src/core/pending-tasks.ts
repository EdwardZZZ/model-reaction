/**
 * Tracks asynchronous work across validation and reactions.
 *
 * A task is registered before it can schedule follow-up work, so `settled()`
 * observes the complete chain rather than coordinating separate subsystems.
 */
export class PendingTasks {
    private count = 0;
    private settledResolvers: Array<() => void> = [];
    private disposed = false;

    begin(): () => void {
        if (this.disposed) return () => {};

        this.count++;
        let ended = false;

        return () => {
            if (ended) return;
            ended = true;
            if (this.disposed) return;
            this.count--;
            this.notifyIfIdle();
        };
    }

    settled(): Promise<void> {
        if (this.count === 0 || this.disposed) return Promise.resolve();

        return new Promise<void>((resolve) => {
            this.settledResolvers.push(resolve);
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.count = 0;
        this.notifyIfIdle();
    }

    private notifyIfIdle(): void {
        if (this.count !== 0 || this.settledResolvers.length === 0) return;

        const resolvers = this.settledResolvers.splice(0);
        resolvers.forEach((resolve) => resolve());
    }
}
