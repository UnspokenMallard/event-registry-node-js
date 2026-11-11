import { afterEach, describe, expect, it, vi } from "vitest";
import { EventRegistry } from "../../src/eventRegistry";
import { ErBudgetExceededError } from "../../src/errors";

const reply = (body: unknown, tokens?: number) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", ...(tokens === undefined ? {} : { "req-tokens": String(tokens), "req-action": "getArticles" }) }
    });
const newEr = (maxTokens?: number) =>
    new EventRegistry({ minDelayBetweenRequests: 0, settingsFName: "no-settings.json", maxTokens });

describe("usage and budget", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("tracks last call and session totals from response headers", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => reply({ articles: { results: [] } }, 3)));
        const er = newEr();
        expect(er.usage.last).toBeUndefined();
        await er.articles.search({ keywords: "x" }).exec();
        await er.articles.search({ keywords: "y" }).exec();
        expect(er.usage.session).toEqual({ tokens: 6, requests: 2 });
        expect(er.usage.last).toMatchObject({ tokens: 3, action: "getArticles", archive: false });
        er.usage.reset();
        expect(er.usage.session).toEqual({ tokens: 0, requests: 0 });
    });

    it("throws ErBudgetExceededError before sending a call that would exceed maxTokens", async () => {
        const fetchMock = vi.fn(async () => reply({ articles: { results: [] } }, 4));
        vi.stubGlobal("fetch", fetchMock);
        const er = newEr(10);
        await er.articles.search({ keywords: "x" }).exec(); // 4
        await er.articles.search({ keywords: "x" }).exec(); // 8
        await expect(er.articles.search({ keywords: "x" }).exec()).rejects.toBeInstanceOf(ErBudgetExceededError); // 8 + 4 > 10
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(er.usage.remainingBudget).toBe(2);
        er.usage.maxTokens = 100; // raising the budget lifts the guard
        await er.articles.search({ keywords: "x" }).exec();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("lets iterators surface the budget error instead of logging it away", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => reply({ articles: { results: [{ uri: "a" }], pages: 3 } }, 5)));
        const er = newEr(5);
        const run = async () => {
            for await (const _ of er.articles.iterate({ keywords: "x" })) { /* drain */ }
        };
        await expect(run()).rejects.toBeInstanceOf(ErBudgetExceededError);
    });

    it("getRemainingTokens reads the usage endpoint and is exempt from the guard", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => reply({ availableTokens: 100, usedTokens: 30 }, 0)));
        const er = newEr(0);
        await expect(er.getRemainingTokens()).resolves.toBe(70);
    });
});
