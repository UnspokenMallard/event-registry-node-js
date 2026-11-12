import { abortReason, abortableSleep } from "./abort";
import { ErApiError, parseRetryAfter } from "./errors";

export interface ErHttpResponse<T = unknown> {
    data: T;
    status: number;
    statusText: string;
    headers: Headers;
}

export interface ErHttpRequest {
    url: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    /** Per-attempt timeout. For an overall deadline use `signal` (see `composeSignal`). */
    timeoutMs?: number;
    /** Aborts the call: no further attempt starts and a pending backoff wait is cancelled. */
    signal?: AbortSignal;
    retry?: number;
    /** Base of the backoff schedule: attempt n waits about `retryDelayMs * 2^n`, capped at `maxRetryDelayMs`. */
    retryDelayMs?: number;
    maxRetryDelayMs?: number;
    stopStatusCodes?: number[];
    responseType?: "json" | "text";
}

/** Largest delay `setTimeout` accepts; anything bigger overflows and fires after about 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Exponential backoff with equal jitter; the fixed `retryDelayMs` is the base of the schedule. */
function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
    const capped = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
    return Math.round(capped / 2 + Math.random() * (capped / 2));
}

function scalarText(value: unknown): string | undefined {
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

async function toApiError(response: Response): Promise<ErApiError> {
    let apiError: string | undefined;
    let apiCode: string | undefined;
    try {
        const body = JSON.parse(await response.text()) as Record<string, unknown>;
        const err = body?.error;
        if (typeof err === "string") {
            apiError = err;
        } else if (err && typeof err === "object") {
            const obj = err as Record<string, unknown>;
            apiError = typeof obj.message === "string" ? obj.message : undefined;
            apiCode = scalarText(obj.code);
        }
        apiCode ??= scalarText(body?.errorCode);
    } catch {
        // body is empty or not JSON: status line is all we have
    }
    const tokens = Number(response.headers.get("req-tokens"));
    return new ErApiError({
        status: response.status,
        statusText: response.statusText,
        apiCode,
        apiError,
        requestId: response.headers.get("x-request-id") ?? response.headers.get("req-id") ?? undefined,
        tokens: response.headers.has("req-tokens") && Number.isFinite(tokens) ? tokens : undefined,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after"))
    });
}

function isFetchNetworkError(error: unknown): boolean {
    if (!(error instanceof TypeError)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return message.includes("fetch failed") || message.includes("failed to fetch") || message.includes("network");
}

/** Programmer / parse errors must not spin on retry: -1. Network TypeErrors still retry. */
function isNonRetryableClientError(error: unknown): boolean {
    if (error instanceof SyntaxError) {
        return true;
    }
    return error instanceof TypeError && !isFetchNetworkError(error);
}

export async function erFetch<T = unknown>(req: ErHttpRequest): Promise<ErHttpResponse<T>> {
    const method = req.method ?? "POST";
    const timeoutMs = req.timeoutMs ?? 600_000;
    const retry = req.retry ?? 0;
    const retryDelayMs = req.retryDelayMs ?? 5000;
    const maxRetryDelayMs = req.maxRetryDelayMs ?? 30_000;
    const stopStatusCodes = req.stopStatusCodes ?? [204, 400, 401, 403, 530];
    const serializedBody = req.body !== undefined ? JSON.stringify(req.body) : undefined;

    let attempt = 0;
    for (;;) {
        req.signal?.throwIfAborted();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const onAbort = () => controller.abort(req.signal?.reason);
        req.signal?.addEventListener("abort", onAbort, { once: true });
        try {
            const init: RequestInit = {
                method,
                headers: {
                    "content-type": "application/json",
                    ...(req.headers ?? {})
                },
                signal: controller.signal
            };
            if (serializedBody !== undefined) {
                init.body = serializedBody;
            }
            const response = await fetch(req.url, init);
            clearTimeout(timer);

            if (response.status === 200) {
                const data = (req.responseType === "text"
                    ? await response.text()
                    : await response.json()) as T;
                return {
                    data,
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                };
            }

            const apiError = await toApiError(response);
            if (stopStatusCodes.includes(response.status)) {
                throw apiError;
            }

            if (retry >= 0 && attempt >= retry) {
                throw Object.assign(apiError, { __retryCount: attempt });
            }

            const honourRetryAfter = response.status === 429 || response.status === 503;
            const delay = honourRetryAfter && apiError.retryAfterMs !== undefined
                ? Math.min(apiError.retryAfterMs, maxRetryDelayMs, MAX_TIMER_MS)
                : backoffDelay(attempt, retryDelayMs, maxRetryDelayMs);
            attempt += 1;
            await abortableSleep(delay, req.signal);
        } catch (error) {
            clearTimeout(timer);
            if (req.signal?.aborted) {
                // the caller cancelled: never retry
                throw abortReason(req.signal);
            }
            const status = (error as { response?: { status?: number } })?.response?.status;
            if (status !== undefined && stopStatusCodes.includes(status)) {
                throw error;
            }
            if (isNonRetryableClientError(error)) {
                throw error;
            }
            if (retry >= 0 && attempt >= retry) {
                // Rethrow the original thrown value (it may not be an Error) with the retry count attached.
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw Object.assign(error as object, { __retryCount: attempt });
            }
            const delay = backoffDelay(attempt, retryDelayMs, maxRetryDelayMs);
            attempt += 1;
            await abortableSleep(delay, req.signal);
        } finally {
            req.signal?.removeEventListener("abort", onAbort);
        }
    }
}
