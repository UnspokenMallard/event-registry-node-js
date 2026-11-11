/**
 * Error thrown by the HTTP layer when the Event Registry API answers with a non-200 status.
 * `response` mirrors the shape older code read from the previous Axios-style errors.
 */
export class ErApiError extends Error {
    public readonly status: number;
    public readonly statusText: string;
    /** Machine-readable error code from the response body, when the API sends one. */
    public readonly apiCode?: string;
    /** Error string from the response body, when the API sends one. */
    public readonly apiError?: string;
    /** Request id from the response headers, when the API sends one. */
    public readonly requestId?: string;
    /** Tokens the failed request cost, when the API reports it (`req-tokens` header). */
    public readonly tokens?: number;
    /** Parsed `Retry-After` header in milliseconds, when present. */
    public readonly retryAfterMs?: number;
    public readonly response: { status: number; statusText: string };

    constructor(init: {
        status: number;
        statusText: string;
        apiCode?: string;
        apiError?: string;
        requestId?: string;
        tokens?: number;
        retryAfterMs?: number;
    }) {
        super(init.apiError || init.statusText || `HTTP ${init.status}`);
        this.name = "ErApiError";
        this.status = init.status;
        this.statusText = init.statusText;
        this.apiCode = init.apiCode;
        this.apiError = init.apiError;
        this.requestId = init.requestId;
        this.tokens = init.tokens;
        this.retryAfterMs = init.retryAfterMs;
        this.response = { status: init.status, statusText: init.statusText };
    }
}

/** Parse a `Retry-After` header value (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
    if (value === null || value.trim() === "") {
        return undefined;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
        return seconds >= 0 ? Math.round(seconds * 1000) : undefined;
    }
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Thrown when the overall `timeoutMs` of a call (queueing, retries and backoff included) runs out. */
export class ErTimeoutError extends Error {
    public readonly timeoutMs: number;

    constructor(timeoutMs: number) {
        super(`Request timed out after ${timeoutMs} ms`);
        this.name = "ErTimeoutError";
        this.timeoutMs = timeoutMs;
    }
}

/**
 * Thrown before a request is sent when the `maxTokens` budget would be exceeded.
 * The check uses the token cost the API reported for earlier calls (see `Usage`), so it is an estimate.
 */
export class ErBudgetExceededError extends Error {
    public readonly maxTokens: number;
    /** Tokens spent by this client since construction or the last `usage.reset()`. */
    public readonly spentTokens: number;
    /** Estimated cost of the refused call (the last reported cost of the same path, 0 when unknown). */
    public readonly estimatedTokens: number;
    public readonly path: string;

    constructor(details: { maxTokens: number; spentTokens: number; estimatedTokens: number; path: string }) {
        super(`Token budget of ${details.maxTokens} would be exceeded by ${details.path}: ${details.spentTokens} spent, about ${details.estimatedTokens} needed`);
        this.name = "ErBudgetExceededError";
        this.maxTokens = details.maxTokens;
        this.spentTokens = details.spentTokens;
        this.estimatedTokens = details.estimatedTokens;
        this.path = details.path;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
