/**
 * Minimal, conservative robots.txt + paywall gate for the news pipeline.
 *
 * Compliance rules we enforce here:
 *  - Never fetch an original source page whose robots.txt disallows our path.
 *  - Never attempt to fetch known-paywalled / login-walled hosts; those become
 *    link-only items requiring manual review.
 *  - Identify ourselves honestly via a named User-Agent (see feeds.NEWS_USER_AGENT).
 *
 * This is intentionally simple (no wildcards beyond a trailing-prefix match, no
 * crawl-delay handling) and fails CLOSED on ambiguity for paywalls but OPEN for
 * robots-fetch errors (a missing/unreachable robots.txt conventionally means
 * "allow"). We only ever read pages, never POST or bypass anything.
 */
import { NEWS_USER_AGENT } from "./feeds";

// Hosts we will not fetch from at all — paywalled, login-walled, or terms that
// don't permit extraction. Items from these become link-only `needs_review`.
const BLOCKED_HOSTS = new Set<string>([
  "theathletic.com",
  "nytimes.com",
  "wsj.com",
  "bloomberg.com",
  "espn.com/insider",
  "the-athletic.com",
]);

interface RobotsRule {
  path: string;
  allow: boolean;
}

interface RobotsCacheEntry {
  rules: RobotsRule[];
  fetchedAt: number;
}

const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000; // re-check robots.txt every 6h
const robotsCache = new Map<string, RobotsCacheEntry>();

function hostKey(u: URL): string {
  return u.hostname.replace(/^www\./, "").toLowerCase();
}

/** True if this host is on the never-fetch (paywall/login) list. */
export function isBlockedHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = hostKey(u);
    const pathHost = `${host}${u.pathname}`.toLowerCase();
    for (const blocked of BLOCKED_HOSTS) {
      if (host === blocked || pathHost.startsWith(blocked)) return true;
    }
    return false;
  } catch {
    return true; // unparseable URL — treat as not fetchable
  }
}

/**
 * Parse robots.txt text into the ordered allow/deny rules that apply to either
 * our named UA or the "*" group. Our UA group, when present, takes precedence
 * over "*", matching the de-facto standard (most specific group wins).
 */
function parseRobots(text: string, ua: string): RobotsRule[] {
  const lines = text.split(/\r?\n/);
  const uaLower = ua.toLowerCase();
  // Collect rule blocks keyed by which user-agents they apply to.
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      if (!current) {
        current = { agents: ["*"], rules: [] };
        groups.push(current);
      }
      if (value) current.rules.push({ path: value, allow: field === "allow" });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  // Prefer a group naming our UA (or a prefix of it); else fall back to "*".
  const specific = groups.find((g) =>
    g.agents.some((a) => a !== "*" && (uaLower.startsWith(a) || a.startsWith(uaLower.split("/")[0]))),
  );
  const star = groups.find((g) => g.agents.includes("*"));
  return (specific ?? star)?.rules ?? [];
}

async function loadRobots(u: URL): Promise<RobotsRule[]> {
  const key = hostKey(u);
  const cached = robotsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.rules;

  let rules: RobotsRule[] = [];
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, {
      headers: { "User-Agent": NEWS_USER_AGENT() },
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(t));
    if (res.ok) {
      rules = parseRobots(await res.text(), NEWS_USER_AGENT());
    }
    // Non-OK (incl. 404) → no rules → allow, per convention.
  } catch (e) {
    // Unreachable robots.txt → allow (fail open) but log.
    console.error(`[news/robots] ${key} robots.txt fetch failed:`, e instanceof Error ? e.message : e);
  }
  robotsCache.set(key, { rules, fetchedAt: Date.now() });
  return rules;
}

/**
 * Decide whether we may fetch `rawUrl`'s page. Blocked hosts → false. Otherwise
 * apply robots.txt: longest matching prefix rule wins (Allow beats Disallow on
 * ties), no matching rule → allowed.
 */
export async function isFetchAllowed(rawUrl: string): Promise<boolean> {
  if (isBlockedHost(rawUrl)) return false;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const rules = await loadRobots(u);
  const path = u.pathname + u.search;
  let best: { len: number; allow: boolean } | null = null;
  for (const r of rules) {
    if (path.startsWith(r.path)) {
      if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) {
        best = { len: r.path.length, allow: r.allow };
      }
    }
  }
  return best ? best.allow : true;
}
