import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { erFetch } from "../../src/http";
import { ErApiError, parseRetryAfter } from "../../src/errors";

const fail = (status: number, headers: Record<string, string> = {}, body = "err") =>
    new Response(body, { status, statusText: "Err", headers });
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe("erFetch backoff", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(1); // jitter at its upper bound: full capped delay
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("doubles the delay per attempt and caps it at 30 s", async () => {
        const responses = [fail(500), fail(500), fail(500), fail(500), fail(500), ok()];
        const fetchMock = vi.fn(async () => responses.shift() as Response);
        vi.stubGlobal("fetch", fetchMock);
        const promise = erFetch({ url: "https://x.test", retry: -1, retryDelayMs: 5000 });

        // waits: 5s, 10s, 20s, 30s (capped), 30s (capped)
        for (const wait of [5000, 10_000, 20_000, 30_000, 30_000]) {
            await vi.advanceTimersByTimeAsync(wait - 1);
            const before = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(1);
            expect(fetchMock.mock.calls.length).toBe(before + 1);
        }
        await expect(promise).resolves.toMatchObject({ status: 200 });
    });

    it("honours Retry-After on 429 and 503 but not on 500", async () => {
        const responses = [fail(429, { "retry-after": "2" }), fail(503, { "retry-after": "1" }), fail(500, { "retry-after": "60" }), ok()];
        const fetchMock = vi.fn(async () => responses.shift() as Response);
        vi.stubGlobal("fetch", fetchMock);
        const promise = erFetch({ url: "https://x.test", retry: -1, retryDelayMs: 5000 });

        await vi.advanceTimersByTimeAsync(1999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        // 500 ignores Retry-After: attempt 2 backoff = 20 s, not 60 s
        await vi.advanceTimersByTimeAsync(20_000);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        await expect(promise).resolves.toMatchObject({ status: 200 });
    });

    it("caps Retry-After at maxRetryDelayMs, even for values that would overflow setTimeout", async () => {
        const responses = [fail(429, { "retry-after": "3600" }), fail(503, { "retry-after": "99999999999" }), ok()];
        const fetchMock = vi.fn(async () => responses.shift() as Response);
        vi.stubGlobal("fetch", fetchMock);
        const promise = erFetch({ url: "https://x.test", retry: -1, retryDelayMs: 5000 });

        await vi.advanceTimersByTimeAsync(29_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        await expect(promise).resolves.toMatchObject({ status: 200 });
    });

    it("keeps stop codes immediate and throws a typed ErApiError", async () => {
        const fetchMock = vi.fn(async () =>
            fail(403, { "x-request-id": "req-1", "req-tokens": "7" }, JSON.stringify({ error: { message: "no access", code: "E403" } })));
        vi.stubGlobal("fetch", fetchMock);
        const error = await erFetch({ url: "https://x.test", retry: -1, stopStatusCodes: [403] }).catch((e: unknown) => e);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(error).toBeInstanceOf(ErApiError);
        expect(error).toMatchObject({ status: 403, apiError: "no access", apiCode: "E403", requestId: "req-1", tokens: 7 });
        expect((error as ErApiError).response.status).toBe(403);
    });
});

describe("parseRetryAfter", () => {
    it("parses seconds and HTTP dates and rejects junk", () => {
        expect(parseRetryAfter("3")).toBe(3000);
        expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:05 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"))).toBe(5000);
        expect(parseRetryAfter("soon")).toBeUndefined();
        expect(parseRetryAfter(null)).toBeUndefined();
    });
});
