// Loads the ESM build inside workerd (via Miniflare) and calls the client from a Worker fetch handler.
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "esm");

const mf = new Miniflare({
    modules: true,
    modulesRoot: root,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-01-01",
    compatibilityFlags: ["nodejs_compat"],
    script: `
        import { EventRegistry, QueryArticles, ErApiError, Usage } from "./index.js";
        export default {
            async fetch() {
                const er = new EventRegistry({ apiKey: "workers-check", maxTokens: 10 });
                const q = new QueryArticles({ keywords: "x" });
                return Response.json({
                    client: er instanceof EventRegistry,
                    query: typeof q.getQuery === "function" || q instanceof QueryArticles,
                    usage: er.usage instanceof Usage,
                    error: typeof ErApiError === "function"
                });
            }
        };`,
    scriptPath: path.join(root, "__worker_entry.js")
});

try {
    const res = await mf.dispatchFetch("http://localhost/");
    const body = await res.json();
    if (res.status !== 200 || !Object.values(body).every(Boolean)) {
        throw new Error(`unexpected worker result ${res.status} ${JSON.stringify(body)}`);
    }
    console.log("workerd OK", body);
} finally {
    await mf.dispose();
}
