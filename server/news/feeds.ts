/**
 * Approved discovery feeds for the curated player-news pipeline.
 *
 * Two roles, with very different compliance treatment:
 *
 *  - role "primary": a credited original source whose public RSS feed we are
 *    permitted to read. Each item IS its own original source — we summarize from
 *    it and attribute back to it (source_name/source_url).
 *
 *  - role "discovery": a feed we use ONLY to learn that news exists about a
 *    player at a time (player name + timestamp). We never store, display, or
 *    summarize its text. RotoWire lives here: it can tip the pipeline that a
 *    player is in the news, but the summary is always built from a primary
 *    source, never from RotoWire content.
 *
 * Add/replace feeds here only after confirming the source's terms + robots.txt
 * permit reading its public feed.
 */
import Parser from "rss-parser";

export type FeedRole = "primary" | "discovery";

export interface ApprovedFeed {
  /** Stable short key used as discovery_source and in logs (e.g. "espn"). */
  key: string;
  /** Human-facing credited source name (e.g. "ESPN"). */
  name: string;
  url: string;
  role: FeedRole;
}

/**
 * The approved set. Primary feeds are credited sources we summarize from;
 * RotoWire is discovery-only (player name + timestamp signal, no text).
 */
export const APPROVED_FEEDS: ApprovedFeed[] = [
  // ESPN's public RSS (https://www.espn.com/espn/rss/nfl/news) is currently
  // served behind AWS WAF and returns an "x-amzn-waf-action: challenge" bot
  // gate. Our compliance rules forbid bypassing bot protections, so ESPN stays
  // DISABLED until we have a permitted access path (e.g. a licensed feed/API).
  // { key: "espn", name: "ESPN", url: "https://www.espn.com/espn/rss/nfl/news", role: "primary" },
  { key: "pft", name: "ProFootballTalk", url: "https://profootballtalk.nbcsports.com/feed/", role: "primary" },
  { key: "yahoo", name: "Yahoo Sports", url: "https://sports.yahoo.com/nfl/rss.xml", role: "primary" },
  { key: "cbs", name: "CBS Sports", url: "https://www.cbssports.com/rss/headlines/nfl/", role: "primary" },
  // Discovery only — never summarized or displayed.
  { key: "rotowire", name: "RotoWire", url: "https://www.rotowire.com/rss/news.php?sport=NFL", role: "discovery" },
];

export const PRIMARY_FEEDS = APPROVED_FEEDS.filter((f) => f.role === "primary");
export const DISCOVERY_FEEDS = APPROVED_FEEDS.filter((f) => f.role === "discovery");

/** A normalized feed item. For discovery feeds, `contentSnippet` is dropped. */
export interface FeedItem {
  feedKey: string;
  sourceName: string;
  role: FeedRole;
  title: string;
  /** Source's own short syndicated summary — primary feeds only (null for discovery). */
  contentSnippet: string | null;
  link: string;
  guid: string | null;
  pubDate: string | null;
}

// rss-parser pulls a few extra fields some feeds use for the body.
const parser = new Parser({
  timeout: 12_000,
  headers: { "User-Agent": NEWS_USER_AGENT() },
  customFields: { item: [["content:encoded", "contentEncoded"]] },
});

/** The UA we identify as when fetching feeds and pages (used for robots checks too). */
export function NEWS_USER_AGENT(): string {
  return "DynastyCommandNewsBot/1.0 (+https://dynastycommand.com/news-bot)";
}

/**
 * Fetch + normalize one feed. Best-effort: on any failure returns [] and logs,
 * so one flaky feed never stalls the pipeline. Discovery feeds return metadata
 * only (no content snippet) by construction.
 */
export async function fetchFeed(feed: ApprovedFeed): Promise<FeedItem[]> {
  try {
    const parsed = await parser.parseURL(feed.url);
    return (parsed.items ?? []).map((item) => ({
      feedKey: feed.key,
      sourceName: feed.name,
      role: feed.role,
      title: (item.title || "").trim(),
      contentSnippet:
        feed.role === "discovery"
          ? null
          : (item.contentSnippet || (item as any).summary || "").trim() || null,
      link: item.link || feed.url,
      guid: item.guid ?? null,
      pubDate: item.pubDate ?? item.isoDate ?? null,
    }));
  } catch (e) {
    console.error(`[news/feeds] ${feed.key} fetch failed:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/** Fetch every primary feed concurrently and flatten. */
export async function fetchPrimaryItems(): Promise<FeedItem[]> {
  const batches = await Promise.all(PRIMARY_FEEDS.map(fetchFeed));
  return batches.flat();
}

/** Fetch every discovery feed concurrently and flatten (metadata only). */
export async function fetchDiscoveryItems(): Promise<FeedItem[]> {
  const batches = await Promise.all(DISCOVERY_FEEDS.map(fetchFeed));
  return batches.flat();
}
