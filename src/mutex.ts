import { abortReason } from "./abort";

export class Mutex {
    private locked = false;
    private readonly waiters: (() => void)[] = [];

    /** Resolves when the lock is held. If `signal` aborts while queued, rejects with its reason and holds nothing. */
    public async acquire(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (!this.locked) {
            this.locked = true;
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const waiter = () => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            };
            const onAbort = () => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0) {
                    this.waiters.splice(index, 1);
                }
                reject(abortReason(signal));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            this.waiters.push(waiter);
        });
        this.locked = true;
    }

    public release(): void {
        const next = this.waiters.shift();
        if (next) {
            next();
            return;
        }
        this.locked = false;
    }
}
