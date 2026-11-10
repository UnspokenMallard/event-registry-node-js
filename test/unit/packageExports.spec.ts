import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

describe("package exports", () => {
    // These tests load the built package, so build it when dist/ is missing
    // (CI builds before the suite runs, which skips this).
    beforeAll(() => {
        if (!existsSync(join(root, "dist", "cjs", "index.js")) || !existsSync(join(root, "dist", "esm", "index.js"))) {
            execSync("npm run build", { cwd: root, stdio: "inherit" });
        }
    }, 120_000);

    it("loads via require", () => {
        const er = require("eventregistry");
        expect(er.EventRegistry).toBeDefined();
    });

    it("loads via dynamic import", async () => {
        const er = await import("eventregistry");
        expect(er.EventRegistry).toBeDefined();
    });
});
