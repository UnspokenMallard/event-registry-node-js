import { EventRegistry } from "../eventRegistry";
import { GetRecentArticles, GetRecentEvents } from "../recent";
import { RecentFeed, RecentFeedOptions, recentArticlesFeed, recentEventsFeed } from "../recentFeed";

/**
 * Recent activity. Each method returns a `RecentFeed`: `await` it for one poll (as in 10.0.0), or
 * `for await` it to keep polling every `pollMs`.
 */
export class RecentFluent {
    constructor(private readonly er: EventRegistry) {}

    events(args: ConstructorParameters<typeof GetRecentEvents>[1] & RecentFeedOptions = {}): RecentFeed {
        return recentEventsFeed(this.er, args);
    }

    articles(args: ConstructorParameters<typeof GetRecentArticles>[1] & RecentFeedOptions = {}): RecentFeed {
        return recentArticlesFeed(this.er, args);
    }
}
