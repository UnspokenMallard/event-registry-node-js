import { pathToFileURL } from "node:url";
import { ArticleInfoFlags, EventRegistry, QueryArticle, RequestArticleInfo, ReturnInfo } from "eventregistry";

// The suggest -> scan -> triage -> retrieve pattern from AGENT-RECIPES.md, in plain SDK calls.
// Needs an API key in settings.json. Every step costs tokens, so the scan asks for titles only.

type ScanRow = { uri: string; title?: string; date?: string; source?: { title?: string } };
type ScanResponse = { articles?: { results?: ScanRow[] } };
type ArticleDetails = Record<string, { info?: { title?: string; body?: string; url?: string } }>;

const er = new EventRegistry({
    maxTokens: 50,            // stop before a call that would push this run over 50 tokens
    timeoutMs: 60_000         // overall deadline per call, retries included
});

// 1. Suggest: resolve a name to a concept uri. Throws when nothing matches.
async function suggest(label: string): Promise<string> {
    return er.concepts.uri(label);
}

// 2. Scan: one row per article, no body text, near-duplicates dropped.
async function scan(conceptUri: string): Promise<ScanRow[]> {
    const titlesOnly = new ReturnInfo({ articleInfo: new ArticleInfoFlags({ bodyLen: 0 }) });
    const response = await er.articles
        .search({ conceptUri, lang: "eng", isDuplicateFilter: "skipDuplicates" })
        .info({ count: 100, returnInfo: titlesOnly })
        .exec() as ScanResponse;
    return response.articles?.results ?? [];
}

// 3. Triage: decide from titles which articles deserve a full read. Plain code here; an agent would use a model.
function triage(rows: ScanRow[], wanted: RegExp, limit = 5): string[] {
    return rows.filter((row) => row.title !== undefined && wanted.test(row.title)).slice(0, limit).map((row) => row.uri);
}

// 4. Retrieve: full text for the chosen uris only (up to 100 per call).
async function retrieve(uris: string[]): Promise<ArticleDetails> {
    const query = new QueryArticle(uris, new RequestArticleInfo());
    return await er.execQuery(query) as unknown as ArticleDetails;
}

async function main() {
    const conceptUri = await suggest("Tesla");
    const rows = await scan(conceptUri);
    console.info(`scanned ${rows.length} titles, ${er.usage.session.tokens} tokens so far`);
    const picked = triage(rows, /recall|lawsuit|earnings/i);
    if (picked.length === 0) {
        return;
    }
    const details = await retrieve(picked);
    for (const [uri, entry] of Object.entries(details)) {
        console.info(uri, entry.info?.title, entry.info?.url);
    }
    console.info(`done: ${er.usage.session.requests} requests, ${er.usage.session.tokens} tokens`);
}

const invokedDirectly = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    void main().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
}
