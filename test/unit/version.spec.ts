import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { __version__ } from "../../src/version";

const readJson = (file: string) => JSON.parse(readFileSync(join(__dirname, "..", "..", file), "utf8"));

describe("package version", () => {
    it("matches package.json", () => {
        expect(__version__).toBe(readJson("package.json").version);
    });

    it("matches package-lock.json", () => {
        const lock = readJson("package-lock.json");
        expect(lock.version).toBe(__version__);
        expect(lock.packages[""].version).toBe(__version__);
    });
});
