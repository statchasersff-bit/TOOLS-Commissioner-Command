/**
 * App-mode policy — single source of truth for "is this host allowed to
 * perform Sleeper write actions?".
 *
 * The Commissioner Command app is deployed on multiple domains:
 *   - dynastycommandff.com / www.dynastycommandff.com  →  WRITE_ACCESS (paid tier).
 *     Subscription-gated write features (lineup submit, waiver, trade
 *     propose/accept/reject, draft pick, DMs) are exposed.
 *   - statchasers.com / www.statchasers.com  →  TEMPORARILY also WRITE_ACCESS
 *     (see TEMPORARY_WRITE_ACCESS_DOMAINS below). Originally a READ_ONLY
 *     free-tier mirror; promoted for live testing until manually reverted.
 *     Reads (portfolio, league analysis, ADP, etc.) work on both regardless.
 *
 * This file runs in both the browser bundle and the Node server (no DOM,
 * no Express types) so the mode decision is identical on both sides. The
 * server uses it as the authoritative gate; the client uses it for UX.
 *
 * Override priority (highest → lowest):
 *   1. Explicit `APP_MODE` / `VITE_APP_MODE` env (`"READ_ONLY"` | `"WRITE_ACCESS"`)
 *   2. Host matches a configured write-access domain → WRITE_ACCESS
 *   3. Host matches a configured read-only domain → READ_ONLY
 *   4. Localhost / 127.0.0.1 / *.replit.dev / *.repl.co → WRITE_ACCESS (dev)
 *   5. Default → READ_ONLY (safe fallback)
 *
 * Why a strict default: if we ever deploy to a new domain and forget to
 * configure it, the dataset stays read-only rather than accidentally
 * exposing write tools. "Open by default" is the wrong call here.
 */

export type AppMode = "READ_ONLY" | "WRITE_ACCESS";

/** Hosts that MUST run read-only. Match is case-insensitive and ignores
 *  port. Subdomains other than `www` are NOT included — they'd need an
 *  explicit entry.
 *
 *  NOTE: statchasers.com / www.statchasers.com are also listed in
 *  TEMPORARY_WRITE_ACCESS_DOMAINS below. Write-access wins in `getAppMode`,
 *  so the temporary promotion is in effect; the read-only entries remain
 *  only so that the kill-switch fallback (ENABLE_WRITE_ACCESS=false) still
 *  classifies statchasers.com as a known host rather than WRONG_DOMAIN.
 *  When you remove the temporary promotion, leave these as-is. */
export const READ_ONLY_DOMAINS: readonly string[] = [
  "statchasers.com",
  "www.statchasers.com",
];

/**
 * Hosts that ARE allowed to expose write features. Defaults to the paid
 * Commissioner Command domain; can be replaced/extended via `WRITE_ACCESS_HOSTS`
 * (or legacy `WRITE_ACCESS_DOMAINS`) env var, comma-separated. Keep this
 * list small and explicit — every entry is a place where subscription-
 * gated mutations can be initiated.
 */
const DEFAULT_WRITE_ACCESS_DOMAINS: readonly string[] = [
  "dynastycommandff.com",
  "www.dynastycommandff.com",
];

// ─── TEMPORARY (remove to revert) ──────────────────────────────────────────
// Hosts that are unconditionally treated as WRITE_ACCESS in addition to
// the env-configured / default list. Merged in by `getWriteAccessDomains`
// EVEN WHEN `WRITE_ACCESS_HOSTS` env var is set, so production env config
// cannot accidentally disable the promotion.
//
// statchasers.com is normally a READ_ONLY tier (free, public mirror); this
// block was added to give it the same full Commissioner Command functionality
// as dynastycommandff.com for live testing. Remove this constant and the
// corresponding merge in `getWriteAccessDomains` to revert to the original
// read-only tier. The READ_ONLY_DOMAINS entries above intentionally stay.
const TEMPORARY_WRITE_ACCESS_DOMAINS: readonly string[] = [
  "statchasers.com",
  "www.statchasers.com",
];
// ─── end TEMPORARY ─────────────────────────────────────────────────────────

/** Canonical public URLs surfaced to the UI ("Upgrade to Pro", etc.).
 *  Overridable via APP_PUBLIC_URL / APP_WRITE_URL env vars. */
const DEFAULT_PUBLIC_URL = "https://statchasers.com/commissioner-command";
const DEFAULT_WRITE_URL = "https://dynastycommandff.com";

export function getPublicAppUrl(): string {
  return readEnv("APP_PUBLIC_URL") || readEnv("VITE_APP_PUBLIC_URL") || DEFAULT_PUBLIC_URL;
}
export function getWriteAccessUrl(): string {
  return readEnv("APP_WRITE_URL") || readEnv("VITE_APP_WRITE_URL") || DEFAULT_WRITE_URL;
}

/** Master kill switch — when false, write features are off everywhere
 *  regardless of host. Defaults to true. Set ENABLE_WRITE_ACCESS=false to
 *  force the entire stack into read-only for an incident. */
export function isWriteAccessEnabled(): boolean {
  const v = (readEnv("ENABLE_WRITE_ACCESS") ?? readEnv("VITE_ENABLE_WRITE_ACCESS") ?? "").toLowerCase();
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  return true;
}

/** Read the env var list — comma-separated; trims whitespace; lowercases. */
function readEnvDomainList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Cross-runtime env reader. `import.meta.env` is the Vite client-side
 *  surface; `process.env` is the Node server. Try both; either may be
 *  undefined depending on where this module is imported. */
function readEnv(name: string): string | undefined {
  try {
    if (typeof process !== "undefined" && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch {
    // ignore — `process` may not exist in some bundles
  }
  try {
    const meta = (globalThis as unknown as { import?: { meta?: { env?: Record<string, string | undefined> } } });
    const v = meta?.import?.meta?.env?.[name];
    if (typeof v === "string") return v;
  } catch {
    // ignore
  }
  return undefined;
}

export function getWriteAccessDomains(): string[] {
  const fromEnv = readEnvDomainList(
    readEnv("WRITE_ACCESS_HOSTS") ??
      readEnv("VITE_WRITE_ACCESS_HOSTS") ??
      readEnv("WRITE_ACCESS_DOMAINS") ??
      readEnv("VITE_WRITE_ACCESS_DOMAINS"),
  );
  const base = fromEnv.length > 0 ? fromEnv : [...DEFAULT_WRITE_ACCESS_DOMAINS];
  // TEMPORARY: always merge in the statchasers.com promotion, regardless
  // of env config. Dedupe to keep the list clean. Remove this merge (and
  // the TEMPORARY_WRITE_ACCESS_DOMAINS constant) to revert.
  const merged = new Set([...base, ...TEMPORARY_WRITE_ACCESS_DOMAINS]);
  return [...merged];
}

export function getReadOnlyDomains(): string[] {
  const fromEnv = readEnvDomainList(
    readEnv("READ_ONLY_HOSTS") ??
      readEnv("VITE_READ_ONLY_HOSTS") ??
      readEnv("READ_ONLY_DOMAINS") ??
      readEnv("VITE_READ_ONLY_DOMAINS"),
  );
  if (fromEnv.length > 0) return fromEnv;
  return [...READ_ONLY_DOMAINS];
}

/** Normalize a host string. Strips port and lowercases. Returns null for
 *  empty / non-string input. */
export function normalizeHost(host: string | null | undefined): string | null {
  if (!host || typeof host !== "string") return null;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return null;
  // Strip an optional `:port` suffix.
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/** Dev/preview hosts get WRITE_ACCESS by default so local testing works. */
function isDevHost(host: string): boolean {
  if (host === "localhost") return true;
  if (host === "127.0.0.1") return true;
  if (host === "0.0.0.0") return true;
  if (host === "::1") return true;
  if (host.endsWith(".replit.dev")) return true;
  if (host.endsWith(".repl.co")) return true;
  if (host.endsWith(".replit.app")) return true;
  return false;
}

/**
 * Compute the app mode for a host. Pure — same input always returns same
 * output, modulo env vars which are read at call time.
 */
/** True when the current runtime is non-production (Vite DEV flag in the
 *  browser, NODE_ENV !== "production" on the server). Dev overrides MUST
 *  be gated on this so they can never silently apply to a deployed build. */
export function isDevRuntime(): boolean {
  // Server-side
  try {
    if (typeof process !== "undefined" && process.env) {
      if (process.env.NODE_ENV === "production") return false;
      if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return true;
      // Replit's preview workspace sets neither — assume non-prod.
      if (!process.env.NODE_ENV) return true;
    }
  } catch {
    // ignore
  }
  // Browser-side (Vite)
  try {
    const meta = (globalThis as unknown as { import?: { meta?: { env?: Record<string, unknown> } } });
    const env = meta?.import?.meta?.env;
    if (env && typeof env.PROD === "boolean") return !env.PROD;
    if (env && typeof env.DEV === "boolean") return env.DEV;
  } catch {
    // ignore
  }
  return false;
}

export function getAppMode(host: string | null | undefined): AppMode {
  // 0. Global kill switch — force read-only when ENABLE_WRITE_ACCESS=false.
  if (!isWriteAccessEnabled()) return "READ_ONLY";

  // 1a. Dev-only override — `DEV_APP_MODE` / `VITE_DEV_APP_MODE`. Lets a
  //     preview deployment behave like the paid domain without touching
  //     real production env. NEVER honored in production.
  if (isDevRuntime()) {
    const devOverride = (readEnv("DEV_APP_MODE") ?? readEnv("VITE_DEV_APP_MODE") ?? "").toUpperCase();
    if (devOverride === "READ_ONLY" || devOverride === "WRITE_ACCESS") {
      return devOverride as AppMode;
    }
  }

  // 1b. Hard env override (production-safe) — used to force read-only on
  //     an otherwise-write-access domain during incident response.
  const override = (readEnv("APP_MODE") ?? readEnv("VITE_APP_MODE") ?? "").toUpperCase();
  if (override === "READ_ONLY" || override === "WRITE_ACCESS") {
    return override as AppMode;
  }

  const h = normalizeHost(host);
  if (!h) return "READ_ONLY"; // safest default — unknown host

  if (getWriteAccessDomains().includes(h)) return "WRITE_ACCESS";
  if (getReadOnlyDomains().includes(h)) return "READ_ONLY";
  if (isDevHost(h)) return "WRITE_ACCESS";

  // Unknown host — stay read-only. A misconfiguration must not silently
  // expose write features.
  return "READ_ONLY";
}

/** Reads a boolean dev override. Returns false in production regardless
 *  of the env var. */
export function readDevBooleanOverride(name: string): boolean {
  if (!isDevRuntime()) return false;
  // Try both server-side (DEV_*) and Vite-prefixed (VITE_DEV_*) forms so
  // the same logical override works in either runtime.
  const v = (readEnv(name) ?? readEnv(`VITE_${name}`) ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** True when the user wants the subscription gate bypassed for testing. */
export function isDevSubscriptionOverride(): boolean {
  return readDevBooleanOverride("DEV_SUBSCRIPTION_OVERRIDE");
}

/** True when the user wants the Sleeper-token gate bypassed for testing. */
export function isDevSleeperConnectedOverride(): boolean {
  return readDevBooleanOverride("DEV_SLEEPER_CONNECTED_OVERRIDE");
}

/** True when any dev override is currently active. Drives the dev banner. */
export function anyDevOverrideActive(): boolean {
  if (!isDevRuntime()) return false;
  if (readEnv("DEV_APP_MODE") || readEnv("VITE_DEV_APP_MODE")) return true;
  if (isDevSubscriptionOverride()) return true;
  if (isDevSleeperConnectedOverride()) return true;
  return false;
}

export function isWriteAccessDomain(host: string | null | undefined): boolean {
  return getAppMode(host) === "WRITE_ACCESS";
}

export function isReadOnlyDomain(host: string | null | undefined): boolean {
  return getAppMode(host) === "READ_ONLY";
}

/** Error returned when a server route is hit on a read-only domain. The
 *  HTTP layer translates this to a 403; the message is shown to the user. */
export const WRITE_ACCESS_REQUIRED_ERROR = {
  code: "WRITE_ACCESS_REQUIRED" as const,
  message:
    "This action is only available on the paid Commissioner Command domain. " +
    "Read-only features remain free at statchasers.com.",
};

/** Error returned when a user has no active subscription. */
export const SUBSCRIPTION_REQUIRED_ERROR = {
  code: "SUBSCRIPTION_REQUIRED" as const,
  message:
    "An active Commissioner Command subscription is required to perform this action.",
};
