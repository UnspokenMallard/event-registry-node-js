import { afterEach, describe, expect, it, vi } from "vitest";
import { EventRegistry } from "../../src/eventRegistry";
import { ErApiError } from "../../src/errors";

describe("error responses", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("carry the typed ErApiError next to the error message", async () => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response(JSON.stringify({ error: { message: "no access", code: "E403" } }), {
                status: 403,
                headers: { "x-request-id": "req-9", "req-tokens": "2" }
            })));
        const er = new EventRegistry({ minDelayBetweenRequests: 0, settingsFName: "no-settings.json" });
        const response = await er.articles.search({ keywords: "x" }).exec();
        expect(response.error).toBe("no access");
        expect(response.apiError).toBeInstanceOf(ErApiError);
        expect(response.apiError).toMatchObject({ status: 403, apiCode: "E403", requestId: "req-9", tokens: 2 });
    });
});
