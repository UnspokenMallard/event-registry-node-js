import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventRegistry } from "../../src/eventRegistry";

const page = (uris: string[], newest: string) => new Response(
    JSON.stringify({ recentActivityArticles: { activity: uris.map((uri) => ({ uri })), newestUri: { newestUri: newest, oldestUri: "o" } } }),
    { status: 200, headers: { "content-type": "application/json" } });
const newEr = () => new EventRegistry({ minDelayBetweenRequests: 0, settingsFName: "no-settings.json" });
const bodies = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>);

describe("recent feeds", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("stays awaitable for a single poll", async () => {
        const fetchMock = vi.fn(async () => page(["a"], "u1"));
        vi.stubGlobal("fetch", fetchMock);
        await expect(newEr().recent.articles({ lang: "eng" })).resolves.toEqual([{ uri: "a" }]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sends nothing until used", () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        newEr().recent.articles({ pollMs: 10 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("polls every pollMs, advances the cursor and reports it", async () => {
        const replies = [page(["a", "b"], "u1"), page([], "u1"), page(["c"], "u2")];
        const fetchMock = vi.fn(async () => replies.shift() ?? page([], "u2"));
        vi.stubGlobal("fetch", fetchMock);
        const cursors: unknown[] = [];
        const seen: string[] = [];
        const run = (async () => {
            for await (const item of newEr().recent.articles({ pollMs: 1000, onCursor: (c) => { cursors.push(c); } })) {
                seen.push((item as { uri: string }).uri);
                if (seen.length === 3) {
                    break;
                }
            }
        })();
        await vi.advanceTimersByTimeAsync(2500);
        await run;
        expect(seen).toEqual(["a", "b", "c"]);
        expect(cursors).toEqual([{ newestUri: "u1", oldestUri: "o" }, { newestUri: "u2", oldestUri: "o" }]);
        const sent = bodies(fetchMock);
        expect(sent[0]).not.toHaveProperty("recentActivityArticlesNewestUri");
        expect(sent[1]).toMatchObject({ recentActivityArticlesNewestUri: "u1" });
        expect(sent[2]).toMatchObject({ recentActivityArticlesNewestUri: "u1" });
    });

    it("resumes from a saved cursor and does not leak feed options into the query", async () => {
        const fetchMock = vi.fn(async () => page([], "u9"));
        vi.stubGlobal("fetch", fetchMock);
        await newEr().recent.articles({ cursor: { newestUri: "saved" }, pollMs: 5, onCursor: () => undefined });
        const [sent] = bodies(fetchMock);
        expect(sent).toMatchObject({ recentActivityArticlesNewestUri: "saved" });
        expect(sent).not.toHaveProperty("pollMs");
        expect(sent).not.toHaveProperty("onCursor");
    });

    it("stops on abort during the wait without another request", async () => {
        const fetchMock = vi.fn(async () => page(["a"], "u1"));
        vi.stubGlobal("fetch", fetchMock);
        const controller = new AbortController();
        const run = (async () => {
            for await (const _ of newEr().recent.events({ pollMs: 60_000, signal: controller.signal })) { /* drain */ }
        })();
        const assertion = expect(run).rejects.toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(1000);
        controller.abort();
        await assertion;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
