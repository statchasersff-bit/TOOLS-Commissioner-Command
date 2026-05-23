/**
 * Centralized configuration for the StatChasers public-data repo
 * (https://github.com/statchasersff-bit/statchasers-data).
 *
 * One source of truth for the base URL, the valid axes (position, category,
 * year), and the URL-builder. The loader (statChasersDataLoader.ts) reads
 * everything here so the rest of the app never hard-codes raw GitHub URLs.
 *
 * Easy future migration: when this data moves to S3 / CDN / DB, update the
 * proxy route + this base URL and the rest of the app keeps working.
 */

// The repo's default branch is `master` and the data lives under a nested
// `statchasers-data/output/...` subdirectory (the repo wraps a Replit
// workspace). Both bits caught us off guard during initial integration —
// every URL was 404'ing until we matched the real layout. If the data ever
// moves to its own dedicated repo, just update this base.
export const GITHUB_RAW_BASE_URL =
  "https://raw.githubusercontent.com/statchasersff-bit/statchasers-data/master/statchasers-data/output";

export const POSITIONS = ["qb", "rb", "wr", "te"] as const;
export type Position = (typeof POSITIONS)[number];

export const DATA_CATEGORIES = [
  "overview",
  "usage",
  "efficiency",
  "stat_explorer",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export const DATA_YEARS = [2023, 2024, 2025] as const;
export type DataYear = (typeof DATA_YEARS)[number];

export function isPosition(v: unknown): v is Position {
  return typeof v === "string" && (POSITIONS as readonly string[]).includes(v);
}

export function isDataCategory(v: unknown): v is DataCategory {
  return typeof v === "string" && (DATA_CATEGORIES as readonly string[]).includes(v);
}

export function isDataYear(v: unknown): v is DataYear {
  const n = typeof v === "string" ? parseInt(v, 10) : v;
  return typeof n === "number" && (DATA_YEARS as readonly number[]).includes(n);
}

/**
 * Build the canonical raw-GitHub URL for a position / category / year combo.
 * Throws on invalid inputs so callers can surface a clear error rather than
 * generating a URL that 404s.
 *
 * Example: buildPositionDataUrl("te", "efficiency", 2024) →
 *   .../output/positions/te/efficiency_2024.json
 */
export function buildPositionDataUrl(
  position: Position | string,
  category: DataCategory | string,
  year: DataYear | number,
): string {
  const pos = String(position).toLowerCase();
  if (!isPosition(pos)) {
    throw new Error(
      `Invalid position "${position}". Expected one of: ${POSITIONS.join(", ")}`,
    );
  }
  if (!isDataCategory(category)) {
    throw new Error(
      `Invalid category "${category}". Expected one of: ${DATA_CATEGORIES.join(", ")}`,
    );
  }
  if (!isDataYear(year)) {
    throw new Error(
      `Invalid year "${year}". Expected one of: ${DATA_YEARS.join(", ")}`,
    );
  }
  return `${GITHUB_RAW_BASE_URL}/positions/${pos}/${category}_${year}.json`;
}

/**
 * Same shape as buildPositionDataUrl but routes through the backend proxy
 * (with server-side caching) instead of hitting GitHub raw directly.
 */
export function buildProxyPositionDataUrl(
  position: Position | string,
  category: DataCategory | string,
  year: DataYear | number,
): string {
  const pos = String(position).toLowerCase();
  if (!isPosition(pos)) {
    throw new Error(
      `Invalid position "${position}". Expected one of: ${POSITIONS.join(", ")}`,
    );
  }
  if (!isDataCategory(category)) {
    throw new Error(
      `Invalid category "${category}". Expected one of: ${DATA_CATEGORIES.join(", ")}`,
    );
  }
  if (!isDataYear(year)) {
    throw new Error(
      `Invalid year "${year}". Expected one of: ${DATA_YEARS.join(", ")}`,
    );
  }
  return `/api/statchasers-data/positions/${pos}/${category}/${year}`;
}
