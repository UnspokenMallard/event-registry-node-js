import { ErBudgetExceededError } from "./errors";

/** What the API reported for one call. */
export interface LastCallUsage {
    path: string;
    /** Tokens the call cost (`req-tokens` header, 0 when absent). */
    tokens: number;
    /** `req-action` header, when sent. */
    action?: string;
    /** Whether the archive was used (`req-archive: 1`). */
    archive: boolean;
}

/**
 * Token and request accounting for one `EventRegistry` client. Costs come from the API's response
 * headers, so they are only known after a call finished. The budget guard therefore estimates the
 * next call with the last cost reported for the same path.
 */
export class Usage {
    /** Refuse calls that would push the session total above this many tokens. `undefined` disables the guard. */
    public maxTokens?: number;
    private lastCall?: LastCallUsage;
    private sessionTokens = 0;
    private sessionRequests = 0;
    private readonly costByPath = new Map<string, number>();

    constructor(maxTokens?: number) {
        this.maxTokens = maxTokens;
    }

    /** The most recent call, or `undefined` before the first one. */
    public get last(): Readonly<LastCallUsage> | undefined {
        return this.lastCall;
    }

    /** Totals since construction or the last `reset()`. */
    public get session(): { tokens: number; requests: number } {
        return { tokens: this.sessionTokens, requests: this.sessionRequests };
    }

    /** Tokens left under `maxTokens`, or `undefined` when no budget is set. */
    public get remainingBudget(): number | undefined {
        return this.maxTokens === undefined ? undefined : Math.max(0, this.maxTokens - this.sessionTokens);
    }

    /** Zero the session totals and forget remembered per-path costs. */
    public reset(): void {
        this.lastCall = undefined;
        this.sessionTokens = 0;
        this.sessionRequests = 0;
        this.costByPath.clear();
    }

    /** @internal Throws `ErBudgetExceededError` when the call is expected to exceed the budget. */
    public assertWithinBudget(path: string): void {
        if (this.maxTokens === undefined) {
            return;
        }
        const estimatedTokens = this.costByPath.get(path) ?? 0;
        if (this.sessionTokens + estimatedTokens > this.maxTokens || this.sessionTokens >= this.maxTokens) {
            throw new ErBudgetExceededError({ maxTokens: this.maxTokens, spentTokens: this.sessionTokens, estimatedTokens, path });
        }
    }

    /** @internal Record a finished call from its response headers. */
    public record(path: string, headers: Headers): void {
        const tokens = Number(headers.get("req-tokens"));
        const cost = Number.isFinite(tokens) && headers.has("req-tokens") ? tokens : 0;
        this.sessionRequests += 1;
        this.sessionTokens += cost;
        this.costByPath.set(path, cost);
        this.lastCall = {
            path,
            tokens: cost,
            action: headers.get("req-action") ?? undefined,
            archive: headers.get("req-archive") === "1"
        };
    }
}
