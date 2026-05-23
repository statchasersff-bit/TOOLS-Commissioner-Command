/**
 * Reusable loader for StatChasers public-data JSON files.
 *
 * - Validates every input axis before fetching.
 * - In-memory cache keyed by `position:category:year`.
 * - Prefers the backend proxy (`/api/statchasers-data/...`) when available;
 *   transparently falls back to the raw GitHub URL if the proxy 5xxs or
 *   the response isn't JSON.
 * - Dev-only console logs so production stays quiet.
 */

import {
  DATA_CATEGORIES,
  DATA_YEARS,
  POSITIONS,
  buildPositionDataUrl,
  buildProxyPositionDataUrl,
  isDataCategory,
  isDataYear,
  isPosition,
  type DataCategory,
  type DataYear,
  type Position,
} from "./statChasersDataConfig";
import { findPlayerRecord } from "./statChasersDataUtils";

const isDev =
  typeof import.meta !== "undefined" && (import.meta as any)?.env?.DEV === true;
const devLog = (...args: unknown[]) => {
  if (isDev) console.info("[statchasers-data]", ...args);
};
const devWarn = (...args: unknown[]) => {
  if (isDev) console.warn("[statchasers-data]", ...args);
};

const dataCache = new Map<string, unknown>();

function cacheKey(position: Position, category: DataCategory, year: DataYear): string {
  return `${position}:${category}:${year}`;
}

/** Clear the in-memory cache. Useful for tests and the dev tester panel. */
export function clearStatChasersCache(): void {
  dataCache.clear();
  devLog("cache cleared");
}

function normalizeInputs(
  position: Position | string,
  category: DataCategory | string,
  year: DataYear | number | string,
): { position: Position; category: DataCategory; year: DataYear } {
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
  const yearNum = typeof year === "string" ? parseInt(year, 10) : year;
  if (!isDataYear(yearNum)) {
    throw new Error(
      `Invalid year "${year}". Expected one of: ${DATA_YEARS.join(", ")}`,
    );
  }
  return { position: pos, category, year: yearNum as DataYear };
}

async function fetchJsonSafe(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: "omit" });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status} ${res.statusText}) for ${url}`);
  }
  if (!ct.includes("application/json")) {
    throw new Error(`Non-JSON response (content-type=${ct || "none"}) from ${url}`);
  }
  return res.json();
}

/**
 * Fetch one (position, category, year) JSON file. Result is cached
 * in-memory; subsequent calls with the same key short-circuit.
 *
 * Strategy:
 *   1. Try the backend proxy (server-side cache + better error handling).
 *   2. On proxy failure (network error, 5xx, non-JSON), retry GitHub raw.
 *
 * Throws an Error with a clear message when both paths fail.
 */
export async function fetchPositionData<T = unknown>(
  position: Position | string,
  category: DataCategory | string,
  year: DataYear | number | string,
): Promise<T> {
  const norm = normalizeInputs(position, category, year);
  const key = cacheKey(norm.position, norm.category, norm.year);

  if (dataCache.has(key)) {
    devLog(`cache hit ${key}`);
    return dataCache.get(key) as T;
  }

  const proxyUrl = buildProxyPositionDataUrl(norm.position, norm.category, norm.year);
  const rawUrl = buildPositionDataUrl(norm.position, norm.category, norm.year);

  let lastError: unknown = null;
  try {
    devLog(`fetch proxy ${proxyUrl}`);
    const data = await fetchJsonSafe(proxyUrl);
    dataCache.set(key, data);
    return data as T;
  } catch (err) {
    lastError = err;
    devWarn(`proxy failed for ${key}, falling back to GitHub raw`, err);
  }

  try {
    devLog(`fetch raw ${rawUrl}`);
    const data = await fetchJsonSafe(rawUrl);
    dataCache.set(key, data);
    return data as T;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const proxyMsg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Failed to load ${norm.position}/${norm.category}/${norm.year}: ${errMsg} (proxy: ${proxyMsg})`,
    );
  }
}

/**
 * Warm the cache for every (position, category, year) combination. Useful
 * before navigating to a page that fans out across the dataset. Missing
 * files don't abort the run — each failure is logged and the function
 * returns the per-file outcome.
 */
export async function preloadAllPositionData(): Promise<
  Array<{
    position: Position;
    category: DataCategory;
    year: DataYear;
    ok: boolean;
    error?: string;
  }>
> {
  const tasks: Array<Promise<{
    position: Position;
    category: DataCategory;
    year: DataYear;
    ok: boolean;
    error?: string;
  }>> = [];
  for (const position of POSITIONS) {
    for (const category of DATA_CATEGORIES) {
      for (const year of DATA_YEARS) {
        tasks.push(
          fetchPositionData(position, category, year)
            .then(() => ({ position, category, year, ok: true }))
            .catch((err) => ({
              position,
              category,
              year,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })),
        );
      }
    }
  }
  return Promise.all(tasks);
}

/**
 * Look up a single player across every category for one position+year.
 * Returns a map keyed by category — values are the matching record or null
 * (when no match) or `{ error }` (when the category file failed to load).
 */
export async function fetchPlayerAcrossCategories<T extends Record<string, unknown> = Record<string, unknown>>(
  query: string | number,
  position: Position | string,
  year: DataYear | number | string,
): Promise<Record<DataCategory, T | null | { error: string }>> {
  const norm = normalizeInputs(position, String(DATA_CATEGORIES[0]), year);
  const result = {} as Record<DataCategory, T | null | { error: string }>;
  await Promise.all(
    DATA_CATEGORIES.map(async (category) => {
      try {
        const json = await fetchPositionData<unknown>(norm.position, category, norm.year);
        const records = (await import("./statChasersDataUtils")).extractRecords<T>(json);
        result[category] = findPlayerRecord(records, query);
      } catch (err) {
        result[category] = { error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return result;
}

/**
 * Load one category for one position across every supported year.
 * Returns a map keyed by year.
 */
export async function fetchPositionCategoryAcrossYears<T = unknown>(
  position: Position | string,
  category: DataCategory | string,
): Promise<Record<DataYear, T | { error: string }>> {
  // Normalize position + category once; year is the axis we fan out on.
  normalizeInputs(position, category, DATA_YEARS[0]);
  const result = {} as Record<DataYear, T | { error: string }>;
  await Promise.all(
    DATA_YEARS.map(async (year) => {
      try {
        result[year] = await fetchPositionData<T>(position, category, year);
      } catch (err) {
        result[year] = { error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return result;
}

/**
 * Load one category for one year across every position.
 * Returns a map keyed by position.
 */
export async function fetchCategoryForAllPositions<T = unknown>(
  category: DataCategory | string,
  year: DataYear | number | string,
): Promise<Record<Position, T | { error: string }>> {
  normalizeInputs(POSITIONS[0], category, year);
  const result = {} as Record<Position, T | { error: string }>;
  await Promise.all(
    POSITIONS.map(async (position) => {
      try {
        result[position] = await fetchPositionData<T>(position, category, year);
      } catch (err) {
        result[position] = { error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return result;
}
