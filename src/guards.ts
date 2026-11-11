/**
 * Hand-written shape checks for the top-level blocks of Event Registry responses. They back the opt-in
 * `validate: true` option. Each check only looks at fields the SDK types document; extra fields are fine.
 */

type Issues = string[];
type Json = Record<string, unknown>;

export const isObject = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const checkCounters = (block: Json, path: string, issues: Issues) => {
    for (const key of ["count", "page", "pages", "totalResults", "usedResults"]) {
        if (block[key] !== undefined && typeof block[key] !== "number") {
            issues.push(`${path}.${key}: expected a number`);
        }
    }
};

const checkResultsBlock = (value: unknown, path: string, issues: Issues, item: (entry: unknown, entryPath: string) => string | undefined) => {
    if (!isObject(value)) {
        issues.push(`${path}: expected an object`);
        return;
    }
    checkCounters(value, path, issues);
    if (!Array.isArray(value.results)) {
        issues.push(`${path}.results: expected an array`);
        return;
    }
    value.results.forEach((entry, index) => {
        const problem = item(entry, `${path}.results[${index}]`);
        if (problem) {
            issues.push(problem);
        }
    });
};

const withUri = (entry: unknown, path: string) =>
    isObject(entry) && typeof entry.uri === "string" ? undefined : `${path}.uri: expected an object with a string uri`;
const anyObject = (entry: unknown, path: string) => isObject(entry) ? undefined : `${path}: expected an object`;
const aString = (entry: unknown, path: string) => typeof entry === "string" ? undefined : `${path}: expected a string`;

/**
 * List every way `data` departs from the documented response shapes. Empty means it is fine.
 * Error responses (`{ error }`) are not validated; the caller already handles those.
 */
export function validateResponse(data: unknown): string[] {
    const issues: Issues = [];
    if (!isObject(data)) {
        return ["response: expected an object"];
    }
    if (data.error !== undefined) {
        return issues;
    }
    if (data.articles !== undefined) {
        checkResultsBlock(data.articles, "articles", issues, withUri);
    }
    if (data.events !== undefined) {
        checkResultsBlock(data.events, "events", issues, withUri);
    }
    if (data.mentions !== undefined) {
        checkResultsBlock(data.mentions, "mentions", issues, anyObject);
    }
    if (data.uriWgtList !== undefined) {
        checkResultsBlock(data.uriWgtList, "uriWgtList", issues, aString);
    }
    for (const key of ["keywordAggr", "conceptAggr", "categoryAggr"]) {
        if (data[key] !== undefined) {
            checkResultsBlock(data[key], key, issues, anyObject);
        }
    }
    if (data.conceptTrends !== undefined) {
        const trends = data.conceptTrends;
        if (!isObject(trends) || !Array.isArray(trends.trends)) {
            issues.push("conceptTrends.trends: expected an array");
        }
    }
    return issues;
}
