import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventRegistry } from "../../src/eventRegistry";
import { ErTimeoutError } from "../../src/errors";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const newEr = (config: ConstructorParameters<typeof EventRegistry>[0] = {}) =>
    new EventRegistry({ minDelayBetweenRequests: 0, settingsFName: "no-settings.json", ...config });

describe("cancellation and timeouts", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("rejects with the abort reason when the signal aborts during a backoff wait", async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn(async () => json({}, 500));
        vi.stubGlobal("fetch", fetchMock);
        const controller = new AbortController();
        const pending = newEr().jsonRequest("/x", {}, true, { signal: controller.signal });
        const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(10); // first attempt done, now sleeping 2.5–5 s
        controller.abort();
        await assertion;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchMock).toHaveBeenCalledTimes(1); // no dangling retry
    });

    it("times out the whole call, retries included, with ErTimeoutError", async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn(async () => json({}, 500));
        vi.stubGlobal("fetch", fetchMock);
        const pending = newEr().execQuery({ path: "/x", getQueryParams: () => ({}) }, true, { timeoutMs: 12_000 });
        const assertion = expect(pending).rejects.toBeInstanceOf(ErTimeoutError);
        await vi.advanceTimersByTimeAsync(12_001);
        await assertion;
        const calls = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it("cancels a call that is still queued behind another request", async () => {
        let release: (r: Response) => void = () => undefined;
        const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
        vi.stubGlobal("fetch", fetchMock);
        const er = newEr();
        const first = er.jsonRequest("/first");
        const controller = new AbortController();
        const second = er.jsonRequest("/second", {}, true, { signal: controller.signal });
        controller.abort();
        await expect(second).rejects.toMatchObject({ name: "AbortError" });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        release(json({ ok: true }));
        await expect((await first).data).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("applies constructor defaults and withOptions views to fluent calls", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => json({ articles: { results: [], totalResults: 0 } })));
        const controller = new AbortController();
        controller.abort();
        await expect(newEr({ signal: controller.signal }).articles.search({ keywords: "x" }).exec())
            .rejects.toMatchObject({ name: "AbortError" });

        const er = newEr();
        const view = er.withOptions({ signal: controller.signal });
        await expect(view.articles.search({ keywords: "x" }).exec()).rejects.toMatchObject({ name: "AbortError" });
        await expect(er.articles.search({ keywords: "x" }).exec()).resolves.toHaveProperty("articles"); // root unaffected
    });

    it("stops an iterator without another request once the signal aborts", async () => {
        const fetchMock = vi.fn(async () =>
            json({ articles: { results: [{ uri: "a1" }, { uri: "a2" }], pages: 5, totalResults: 10 } }));
        vi.stubGlobal("fetch", fetchMock);
        const controller = new AbortController();
        const seen: unknown[] = [];
        const run = async () => {
            for await (const article of newEr().articles.iterate({ keywords: "x", signal: controller.signal })) {
                seen.push(article);
                controller.abort(); // abort after first item of the first page
            }
        };
        await expect(run()).rejects.toMatchObject({ name: "AbortError" });
        expect(seen).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
