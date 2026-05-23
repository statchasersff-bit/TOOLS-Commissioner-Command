/**
 * Shape-tolerant helpers for the StatChasers public-data JSON files.
 *
 * The files in statchasers-data may ship in a handful of shapes:
 *   - a bare array of records
 *   - an object with `players` array
 *   - an object with `data` array
 *   - an object with `metadata` + `rows` array
 *
 * These helpers normalize the shape so callers don't have to branch on it.
 */

/**
 * Best-effort extraction of the record array from a parsed JSON payload.
 * Returns `[]` if no recognized records-array can be found — callers should
 * surface a "no data available" empty state rather than crashing.
 */
export function extractRecords<T = unknown>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.players)) return obj.players as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.rows)) return obj.rows as T[];
  }
  return [];
}

const ID_FIELDS = ["player_id", "playerId", "sleeper_id", "sleeperId", "id"] as const;
const NAME_FIELDS = ["player_name", "playerName", "name", "full_name", "fullName"] as const;

function recordId(rec: Record<string, unknown>): string | null {
  for (const f of ID_FIELDS) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function recordName(rec: Record<string, unknown>): string | null {
  for (const f of NAME_FIELDS) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Find the best matching player record for a free-form query. Tries (in order):
 *   1. exact ID match against any of the common ID fields
 *   2. exact lowercase name match against any of the common name fields
 *   3. partial (substring) lowercase name match
 *
 * Returns the first matching record or `null`. Records is intentionally
 * untyped (Record<string, unknown>) so this is reusable across the four
 * category shapes in the data repo.
 */
export function findPlayerRecord<T extends Record<string, unknown>>(
  records: readonly T[],
  query: string | number | null | undefined,
): T | null {
  if (records.length === 0) return null;
  const raw = query == null ? "" : String(query).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Pass 1: exact ID
  for (const rec of records) {
    const id = recordId(rec);
    if (id != null && (id === raw || id.toLowerCase() === lower)) return rec;
  }
  // Pass 2: exact name (case-insensitive)
  for (const rec of records) {
    const name = recordName(rec);
    if (name && name.toLowerCase() === lower) return rec;
  }
  // Pass 3: substring name (case-insensitive)
  for (const rec of records) {
    const name = recordName(rec);
    if (name && name.toLowerCase().includes(lower)) return rec;
  }
  return null;
}
