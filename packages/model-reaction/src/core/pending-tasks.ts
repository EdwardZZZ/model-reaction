/** Shared computation and action lifecycle; see docs/DESIGN_EFFECT_DEPS_CN.md §4.4. */
export class PendingTasks {
    private counts = { compute: 0, action: 0 };
    private computeIdleListeners = new Set<() => void>();
    private settledResolvers: Array<() => void> = [];
    private disposed = false;

    get isComputeIdle(): boolean {
        return this.counts.compute === 0;
    }

    onComputeIdle(listener: () => void): () => void {
        if (this.disposed) return () => {};
        this.computeIdleListeners.add(listener);
        return () => this.computeIdleListeners.delete(listener);
    }

    begin(kind: 'compute' | 'action' = 'compute'): () => void {
        if (this.disposed) return () => {};

        this.counts[kind]++;
        let ended = false;

        return () => {
            if (ended) return;
            ended = true;
            if (this.disposed) return;
            this.counts[kind]--;
            if (kind === 'compute' && this.isComputeIdle) {
                for (const listener of this.computeIdleListeners) listener();
            }
            this.notifyIfIdle();
        };
    }

    settled(): Promise<void> {
        if (this.isIdle || this.disposed) return Promise.resolve();

        return new Promise<void>((resolve) => {
            this.settledResolvers.push(resolve);
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.counts = { compute: 0, action: 0 };
        for (const listener of this.computeIdleListeners) listener();
        this.computeIdleListeners.clear();
        this.notifyIfIdle();
    }

    private get isIdle(): boolean {
        return this.isComputeIdle && this.counts.action === 0;
    }

    private notifyIfIdle(): void {
        if (!this.isIdle || this.settledResolvers.length === 0) return;

        const resolvers = this.settledResolvers.splice(0);
        resolvers.forEach((resolve) => resolve());
    }
}
