import { describe, expect, it } from "vitest";
import { EventRegistry } from "../../src/eventRegistry";
import { QueryArticles, RequestArticlesInfo } from "../../src/queryArticles";

const newEr = () => new EventRegistry({ apiKey: "secret-key", host: "https://example.test", logging: false });

describe("getUrl", () => {
    it("URL-encodes keys and values", () => {
        const q = new QueryArticles({ keywords: "AT&T #1 50%" });
        q.setRequestedResult(new RequestArticlesInfo());
        const url = new URL(newEr().getUrl(q));
        expect(url.origin + url.pathname).toBe("https://example.test/api/v1/article");
        expect(url.hash).toBe("");
        expect(url.searchParams.get("keyword")).toBe("AT&T #1 50%");
    });

    it("repeats array values instead of comma-joining them", () => {
        const q = new QueryArticles({ conceptUri: ["http://en.wikipedia.org/wiki/A,B", "http://en.wikipedia.org/wiki/C"] });
        q.setRequestedResult(new RequestArticlesInfo());
        const url = new URL(newEr().getUrl(q));
        expect(url.searchParams.getAll("conceptUri")).toEqual(["http://en.wikipedia.org/wiki/A,B", "http://en.wikipedia.org/wiki/C"]);
    });

    it("serializes object values as JSON", () => {
        const q = new QueryArticles({ keywords: "x" });
        q.setRequestedResult(new RequestArticlesInfo());
        q.setVal("nested", { a: 1 });
        const url = new URL(newEr().getUrl(q));
        expect(url.searchParams.get("nested")).toBe("{\"a\":1}");
        expect(url.search).not.toContain("object");
    });

    it("never includes apiKey, even when the query carries one", () => {
        const er = newEr();
        er.setExtraParams({ apiKey: "extra-key" });
        const q = new QueryArticles({ keywords: "x" });
        q.setRequestedResult(new RequestArticlesInfo());
        q.setVal("apiKey", "query-key");
        const url = er.getUrl(q);
        expect(new URL(url).searchParams.has("apiKey")).toBe(false);
        expect(url).not.toContain("query-key");
    });
});
