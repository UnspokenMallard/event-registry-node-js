import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventRegistry } from "../../src/eventRegistry";
import { ErValidationError } from "../../src/errors";
import { validateResponse } from "../../src/guards";

const reply = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const newEr = (validate?: boolean) =>
    new EventRegistry({ minDelayBetweenRequests: 0, settingsFName: "no-settings.json", validate });

describe("validateResponse", () => {
    it("accepts documented shapes and ignores unknown fields", () => {
        expect(validateResponse({ articles: { results: [{ uri: "a", extra: 1 }], totalResults: 1, page: 1, pages: 1, count: 1 }, newField: true })).toEqual([]);
        expect(validateResponse({ uriWgtList: { results: ["1:5", "2:3"] } })).toEqual([]);
        expect(validateResponse({ error: "boom" })).toEqual([]);
    });

    it("reports each departure with its path", () => {
        expect(validateResponse({ articles: { results: [{ uri: "a" }, { title: "no uri" }], totalResults: "7" } })).toEqual([
            "articles.totalResults: expected a number",
            "articles.results[1].uri: expected an object with a string uri"
        ]);
        expect(validateResponse({ events: {} })).toEqual(["events.results: expected an array"]);
        expect(validateResponse([])).toEqual(["response: expected an object"]);
    });

    it("accepts every recorded fixture response", () => {
        const dir = join(__dirname, "..", "fixtures");
        const failures: string[] = [];
        for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
            const fixture = JSON.parse(readFileSync(join(dir, name), "utf8")) as { response: { body: unknown } };
            const body = typeof fixture.response.body === "string" ? safeParse(fixture.response.body) : fixture.response.body;
            if (body !== null && typeof body === "object" && !Array.isArray(body)) {
                const issues = validateResponse(body);
                if (issues.length > 0) {
                    failures.push(`${name}: ${issues[0]}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });
});

function safeParse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

describe("validate option", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("is off by default", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => reply({ articles: { results: [{ title: "no uri" }] } })));
        await expect(newEr().articles.search({ keywords: "x" }).exec()).resolves.toHaveProperty("articles");
    });

    it("throws ErValidationError for drifted responses when on", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => reply({ articles: { results: [{ title: "no uri" }] } })));
        const error = await newEr(true).articles.search({ keywords: "x" }).exec().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ErValidationError);
        expect((error as ErValidationError).issues[0]).toContain("articles.results[0].uri");
    });

    it("passes valid responses through when on", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => reply({ articles: { results: [{ uri: "a" }], totalResults: 1 } })));
        await expect(newEr(true).articles.search({ keywords: "x" }).exec()).resolves.toHaveProperty("articles");
    });
});
