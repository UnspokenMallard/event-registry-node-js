import { ErBudgetExceededError, ErTimeoutError } from "./errors";

/**
 * Combine an optional caller signal with an optional overall deadline into one signal.
 * `AbortSignal.any` is Node 20+, so this links the two by hand (the package floor is Node 18).
 */
export function composeSignal(
    signals: (AbortSignal | undefined)[],
    timeoutMs?: number
): { signal?: AbortSignal; dispose: () => void } {
    const given = signals.filter((s): s is AbortSignal => s !== undefined);
    if (given.length === 0 && !timeoutMs) {
        return { dispose: () => undefined };
    }
    const controller = new AbortController();
    const listeners: [AbortSignal, () => void][] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const alreadyAborted = given.find((s) => s.aborted);
    if (alreadyAborted) {
        controller.abort(alreadyAborted.reason);
    } else {
        for (const s of given) {
            const onAbort = () => controller.abort(s.reason);
            s.addEventListener("abort", onAbort, { once: true });
            listeners.push([s, onAbort]);
        }
        if (timeoutMs) {
            timer = setTimeout(() => controller.abort(new ErTimeoutError(timeoutMs)), timeoutMs);
        }
    }
    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
            for (const [s, onAbort] of listeners) {
                s.removeEventListener("abort", onAbort);
            }
        }
    };
}

/** The abort reason as an Error (a custom `abort(reason)` value that is not an Error is wrapped). */
export function abortReason(signal?: AbortSignal): Error {
    const reason: unknown = signal?.reason;
    return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "The operation was aborted");
}

/** `setTimeout` as a promise that rejects with the signal's reason as soon as the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortReason(signal));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortReason(signal));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/** True when an error means the caller cancelled, ran out of time or out of budget, so it must propagate instead of being logged away. */
export function isCancellation(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true || error instanceof ErTimeoutError || error instanceof ErBudgetExceededError;
}
