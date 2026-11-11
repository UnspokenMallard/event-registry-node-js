import { abortableSleep, composeSignal } from "./abort";
import { EventRegistry } from "./eventRegistry";
import { GetRecentArticles, GetRecentEvents, RecentCursor } from "./recent";
import { ER } from "./types";

/** Options of a recent-activity feed on top of the `GetRecentArticles` / `GetRecentEvents` arguments. */
export interface RecentFeedOptions extends ER.RequestOptions {
    /** Wait between polls in milliseconds. The API refreshes about once a minute. Default 60000. */
    pollMs?: number;
    /** Resume after a position saved from `onCursor`. Without it the feed starts at the API's current position. */
    cursor?: RecentCursor;
    /** Called with the new position after each poll that moved it. Awaited, so a slow store applies backpressure. */
    onCursor?: (cursor: RecentCursor) => void | Promise<void>;
}

type RecentSource = Pick<GetRecentArticles, "getUpdates" | "getCursor" | "setCursor">;

/**
 * Both a one-shot poll and an endless feed over one `GetRecent*` query:
 * `await feed` does a single `getUpdates()` (the 10.0.0 behaviour), `for await (const item of feed)` polls forever.
 * Nothing is requested until one of the two is used. Cancel a feed with `signal`; the loop then throws the abort reason.
 */
export class RecentFeed<T = unknown> implements Promise<T[]>, AsyncIterable<T> {
    public readonly [Symbol.toStringTag] = "RecentFeed";
    private readonly options: RecentFeedOptions;
    private once?: Promise<T[]>;

    constructor(private readonly er: EventRegistry, private readonly create: (er: EventRegistry) => RecentSource, options: RecentFeedOptions = {}) {
        this.options = options;
    }

    private source(): RecentSource {
        const { signal, timeoutMs, cursor } = this.options;
        const source = this.create(signal || timeoutMs ? this.er.withOptions({ signal, timeoutMs }) : this.er);
        if (cursor) {
            source.setCursor(cursor);
        }
        return source;
    }

    private poll(): Promise<T[]> {
        this.once ??= this.source().getUpdates() as Promise<T[]>;
        return this.once;
    }

    public then<R1 = T[], R2 = never>(onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2> {
        return this.poll().then(onfulfilled, onrejected);
    }

    public catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<T[] | R> {
        return this.poll().catch(onrejected);
    }

    public finally(onfinally?: (() => void) | null): Promise<T[]> {
        return this.poll().finally(onfinally);
    }

    public async *[Symbol.asyncIterator](): AsyncIterator<T> {
        const { pollMs = 60_000, signal, onCursor } = this.options;
        const source = this.source();
        let last = JSON.stringify(source.getCursor());
        for (;;) {
            const items = (await source.getUpdates()) as T[];
            const cursor = source.getCursor();
            const serialized = JSON.stringify(cursor);
            if (serialized !== last) {
                last = serialized;
                await onCursor?.(cursor);
            }
            for (const item of items) {
                yield item;
            }
            const { signal: sleepSignal, dispose } = composeSignal([signal]);
            try {
                await abortableSleep(pollMs, sleepSignal);
            } finally {
                dispose();
            }
        }
    }
}

export function recentArticlesFeed<T = unknown>(er: EventRegistry, args: ConstructorParameters<typeof GetRecentArticles>[1] & RecentFeedOptions = {}): RecentFeed<T> {
    const { pollMs, cursor, onCursor, signal, timeoutMs, ...rest } = args;
    return new RecentFeed<T>(er, (client) => new GetRecentArticles(client, rest), { pollMs, cursor, onCursor, signal, timeoutMs });
}

export function recentEventsFeed<T = unknown>(er: EventRegistry, args: ConstructorParameters<typeof GetRecentEvents>[1] & RecentFeedOptions = {}): RecentFeed<T> {
    const { pollMs, cursor, onCursor, signal, timeoutMs, ...rest } = args;
    return new RecentFeed<T>(er, (client) => new GetRecentEvents(client, rest), { pollMs, cursor, onCursor, signal, timeoutMs });
}
