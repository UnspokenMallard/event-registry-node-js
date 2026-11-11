// Imports the ESM build and makes sure the client can be constructed (run with `bun scripts/check-runtime-bun.mjs`).
import { EventRegistry, QueryArticles, Usage } from "../dist/esm/index.js";

const er = new EventRegistry({ apiKey: "bun-check", maxTokens: 10 });
if (!(er.usage instanceof Usage) || !new QueryArticles({ keywords: "x" })) {
    throw new Error("client did not construct");
}
console.log("runtime OK", typeof Bun !== "undefined" ? `bun ${Bun.version}` : process.version);
