import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq } from "drizzle-orm";
import { userValueSets, userPlayerValues } from "@shared/schema";
import { getSleeperPlayers } from "./sleeper";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export type ValueType = "dynasty" | "redraft";

// ── CSV parsing ──────────────────────────────────────────────────────────────
// Hand-rolled CSV parser — handles double-quoted fields with embedded commas
// and escaped quotes (""). No dependency. Returns string[][].
//
// We accept "\r\n", "\r", and "\n" as line terminators. Empty trailing lines
// are dropped. Comments / BOM are tolerated.
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { pushField(); continue; }
    if (c === "\r") {
      pushField();
      pushRow();
      if (text[i + 1] === "\n") i++;
      continue;
    }
    if (c === "\n") { pushField(); pushRow(); continue; }
    field += c;
  }

  // Flush trailing field/row.
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  // Drop pure-empty rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ── Name normalization ───────────────────────────────────────────────────────
// Lowercase, strip diacritics, drop punctuation, strip common suffixes
// (Jr., Sr., II, III, IV, V), collapse whitespace.
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'`’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POS_SET = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
function normalizePos(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = raw.trim().toUpperCase();
  if (p === "D/ST" || p === "DST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return POS_SET.has(p) ? p : p; // accept unknown positions verbatim
}

// ── Sleeper player index for matching ────────────────────────────────────────
type SleeperPlayerRow = {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
};

interface PlayerIndex {
  byId: Map<string, { name: string; pos: string; team: string }>;
  byNamePos: Map<string, string>;            // "name|pos" → player_id
  byName: Map<string, string[]>;             // "name" → player_id[]
  byNameTeam: Map<string, string>;           // "name|team" → player_id
}

let cachedIndex: { index: PlayerIndex; builtAt: number } | null = null;
const INDEX_TTL_MS = 60 * 60 * 1000;

async function getPlayerIndex(): Promise<PlayerIndex> {
  if (cachedIndex && Date.now() - cachedIndex.builtAt < INDEX_TTL_MS) {
    return cachedIndex.index;
  }
  const players = await getSleeperPlayers() as Record<string, SleeperPlayerRow>;

  const idx: PlayerIndex = {
    byId: new Map(),
    byNamePos: new Map(),
    byName: new Map(),
    byNameTeam: new Map(),
  };

  for (const [id, p] of Object.entries(players)) {
    const fullName = (p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`).trim();
    if (!fullName) continue;
    const pos = (p.position || "").toUpperCase();
    const team = (p.team || "FA").toUpperCase();
    const norm = normalizeName(fullName);

    idx.byId.set(id, { name: fullName, pos, team });
    idx.byNamePos.set(`${norm}|${pos}`, id);
    const list = idx.byName.get(norm) ?? [];
    list.push(id);
    idx.byName.set(norm, list);
    idx.byNameTeam.set(`${norm}|${team}`, id);
  }
  cachedIndex = { index: idx, builtAt: Date.now() };
  return idx;
}

// ── Preview / matching ───────────────────────────────────────────────────────

export interface ParsedRow {
  rowIndex: number;       // 1-based row number in the source file (excluding header)
  playerName: string;
  position: string | null;
  team: string | null;
  value: number | null;
  rawValue: string;
  providedSleeperId: string | null;
  matchedSleeperId: string | null;
  matchMethod: "sleeper_id" | "name_pos" | "name_team" | "name_unique" | null;
  matched: boolean;
  invalidReason: string | null;
  duplicate: boolean;
}

export interface PreviewResult {
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  invalidCount: number;
  duplicateCount: number;
  matchRate: number;
  sample: ParsedRow[];     // first 20 valid rows
  unmatchedSample: ParsedRow[]; // first 50 unmatched (for download)
  invalidSample: ParsedRow[];
  rows: ParsedRow[];       // full normalized rows — stored for save step
}

const REQUIRED_COLS = ["player_name", "value"] as const;
const OPTIONAL_COLS = ["position", "team", "player_id", "pos"] as const;

export async function previewCsv(content: string): Promise<PreviewResult> {
  const raw = parseCsv(content);
  if (raw.length === 0) {
    return {
      totalRows: 0, matchedCount: 0, unmatchedCount: 0, invalidCount: 0, duplicateCount: 0,
      matchRate: 0, sample: [], unmatchedSample: [], invalidSample: [], rows: [],
    };
  }

  const header = raw[0].map((c) => c.trim().toLowerCase().replace(/\s+/g, "_"));
  const colIdx: Record<string, number> = {};
  header.forEach((h, i) => { colIdx[h] = i; });

  for (const c of REQUIRED_COLS) {
    if (colIdx[c] === undefined) {
      throw new Error(`Missing required column "${c}". Expected at least: ${REQUIRED_COLS.join(", ")}.`);
    }
  }

  const idx = await getPlayerIndex();
  const seenNamePos = new Set<string>();

  const rows: ParsedRow[] = [];
  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    const playerName = (cells[colIdx.player_name] ?? "").trim();
    const valueStr = (cells[colIdx.value] ?? "").trim();
    const positionCell = colIdx.position !== undefined ? (cells[colIdx.position] ?? "").trim()
                       : colIdx.pos !== undefined ? (cells[colIdx.pos] ?? "").trim()
                       : null;
    const teamCell = colIdx.team !== undefined ? (cells[colIdx.team] ?? "").trim() : null;
    const providedSleeperId = colIdx.player_id !== undefined ? (cells[colIdx.player_id] ?? "").trim() : "";

    let invalidReason: string | null = null;
    if (!playerName) invalidReason = "missing player_name";

    const valueNum = Number(valueStr.replace(/[, ]/g, ""));
    if (!invalidReason && (!Number.isFinite(valueNum) || valueNum < 0)) {
      invalidReason = "invalid value";
    }

    const pos = normalizePos(positionCell || null);
    const team = teamCell ? teamCell.toUpperCase() : null;
    const normName = normalizeName(playerName);

    let matchedSleeperId: string | null = null;
    let matchMethod: ParsedRow["matchMethod"] = null;

    if (!invalidReason) {
      // 1) Provided sleeper id (only accept if it actually exists in our index).
      if (providedSleeperId && idx.byId.has(providedSleeperId)) {
        matchedSleeperId = providedSleeperId;
        matchMethod = "sleeper_id";
      }
      // 2) Exact name + position.
      if (!matchedSleeperId && pos) {
        const id = idx.byNamePos.get(`${normName}|${pos}`);
        if (id) { matchedSleeperId = id; matchMethod = "name_pos"; }
      }
      // 3) Name + team (fuzzy fallback when pos is missing or mismatched).
      if (!matchedSleeperId && team) {
        const id = idx.byNameTeam.get(`${normName}|${team}`);
        if (id) { matchedSleeperId = id; matchMethod = "name_team"; }
      }
      // 4) Name-only when unique across all positions.
      if (!matchedSleeperId) {
        const candidates = idx.byName.get(normName) ?? [];
        if (candidates.length === 1) {
          matchedSleeperId = candidates[0];
          matchMethod = "name_unique";
        }
      }
    }

    const dupKey = `${normName}|${pos ?? ""}`;
    const duplicate = !invalidReason && seenNamePos.has(dupKey);
    if (!invalidReason) seenNamePos.add(dupKey);

    rows.push({
      rowIndex: r,
      playerName,
      position: pos,
      team,
      value: invalidReason ? null : Math.round(valueNum),
      rawValue: valueStr,
      providedSleeperId: providedSleeperId || null,
      matchedSleeperId,
      matchMethod,
      matched: !!matchedSleeperId,
      invalidReason,
      duplicate,
    });
  }

  const validRows = rows.filter((r) => !r.invalidReason);
  const matched = validRows.filter((r) => r.matched).length;
  const unmatched = validRows.filter((r) => !r.matched).length;
  const invalid = rows.length - validRows.length;
  const duplicate = rows.filter((r) => r.duplicate).length;
  const matchRate = validRows.length === 0 ? 0 : Math.round((matched / validRows.length) * 100);

  return {
    totalRows: rows.length,
    matchedCount: matched,
    unmatchedCount: unmatched,
    invalidCount: invalid,
    duplicateCount: duplicate,
    matchRate,
    sample: validRows.slice(0, 20),
    unmatchedSample: validRows.filter((r) => !r.matched).slice(0, 50),
    invalidSample: rows.filter((r) => r.invalidReason).slice(0, 50),
    rows,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function saveValueSet(opts: {
  userId: string;
  valueType: ValueType;
  name: string;
  rows: ParsedRow[];
  activate?: boolean;
}): Promise<{ valueSetId: number; matched: number; unmatched: number; invalid: number; duplicates: number }> {
  const { userId, valueType, name, rows, activate = true } = opts;

  const validRows = rows.filter((r) => !r.invalidReason && !r.duplicate);
  const matched = validRows.filter((r) => r.matched).length;
  const unmatched = validRows.filter((r) => !r.matched).length;
  const invalid = rows.filter((r) => r.invalidReason).length;
  const duplicates = rows.filter((r) => r.duplicate).length;

  // If activating, flip any other active set for this (user, type) off first
  // so the resolver always sees a single canonical active set.
  if (activate) {
    await db
      .update(userValueSets)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(userValueSets.userId, userId), eq(userValueSets.valueType, valueType)));
  }

  const [inserted] = await db
    .insert(userValueSets)
    .values({
      userId,
      valueType,
      name,
      source: "custom_upload",
      isActive: activate,
      totalRows: rows.length,
      matchedRows: matched,
      unmatchedRows: unmatched,
      invalidRows: invalid,
      duplicateRows: duplicates,
    })
    .returning({ id: userValueSets.id });

  const valueSetId = inserted.id;

  // Persist every valid row (matched + unmatched) so the user can review
  // unmatched players later from the manage screen.
  const playerRows = validRows.map((r) => ({
    valueSetId,
    playerId: r.matchedSleeperId,
    playerName: r.playerName,
    position: r.position,
    team: r.team,
    value: r.value ?? 0,
    matched: r.matched,
    matchMethod: r.matchMethod,
  }));

  const BATCH = 500;
  for (let i = 0; i < playerRows.length; i += BATCH) {
    await db.insert(userPlayerValues).values(playerRows.slice(i, i + BATCH));
  }

  return { valueSetId, matched, unmatched, invalid, duplicates };
}

export async function listValueSets(userId: string): Promise<Array<UserValueSetSummary>> {
  const rows = await db
    .select()
    .from(userValueSets)
    .where(eq(userValueSets.userId, userId))
    .orderBy(desc(userValueSets.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    valueType: r.valueType as ValueType,
    name: r.name,
    isActive: r.isActive,
    totalRows: r.totalRows,
    matchedRows: r.matchedRows,
    unmatchedRows: r.unmatchedRows,
    invalidRows: r.invalidRows,
    duplicateRows: r.duplicateRows,
    matchRate: r.totalRows === 0 ? 0 : Math.round((r.matchedRows / Math.max(r.matchedRows + r.unmatchedRows, 1)) * 100),
    createdAt: r.createdAt?.toISOString() ?? null,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}

export interface UserValueSetSummary {
  id: number;
  valueType: ValueType;
  name: string;
  isActive: boolean;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  invalidRows: number;
  duplicateRows: number;
  matchRate: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function activateValueSet(userId: string, valueSetId: number): Promise<void> {
  const existing = await db
    .select()
    .from(userValueSets)
    .where(and(eq(userValueSets.id, valueSetId), eq(userValueSets.userId, userId)))
    .limit(1);

  if (existing.length === 0) throw new Error("Value set not found");
  const set = existing[0];

  // Flip every other set for this (user, type) off, then turn the chosen one on.
  await db
    .update(userValueSets)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(userValueSets.userId, userId), eq(userValueSets.valueType, set.valueType)));

  await db
    .update(userValueSets)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(userValueSets.id, valueSetId));
}

export async function deactivateValueSet(userId: string, valueType: ValueType): Promise<void> {
  await db
    .update(userValueSets)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(userValueSets.userId, userId), eq(userValueSets.valueType, valueType)));
}

export async function deleteValueSet(userId: string, valueSetId: number): Promise<void> {
  // Ensure the set actually belongs to this user before deleting.
  const existing = await db
    .select()
    .from(userValueSets)
    .where(and(eq(userValueSets.id, valueSetId), eq(userValueSets.userId, userId)))
    .limit(1);
  if (existing.length === 0) throw new Error("Value set not found");

  await db.delete(userPlayerValues).where(eq(userPlayerValues.valueSetId, valueSetId));
  await db.delete(userValueSets).where(eq(userValueSets.id, valueSetId));
}

// ── Resolver: feeds the centralized client-side context ──────────────────────
// Returns the currently-active custom values for both dynasty and redraft.
// Each map is keyed by Sleeper player_id. The client merges these on top of
// FantasyCalc; unmatched entries are exposed separately so the UI can show a
// "some players using FC fallback" warning.

export interface ResolvedValues {
  dynasty: {
    setId: number | null;
    name: string | null;
    valuesBySleeperId: Record<string, number>;
    valuesByNamePos: Record<string, number>;
    matchedCount: number;
    unmatchedCount: number;
    updatedAt: string | null;
  } | null;
  redraft: {
    setId: number | null;
    name: string | null;
    valuesBySleeperId: Record<string, number>;
    valuesByNamePos: Record<string, number>;
    matchedCount: number;
    unmatchedCount: number;
    updatedAt: string | null;
  } | null;
}

async function loadActiveSet(userId: string, valueType: ValueType) {
  const set = await db
    .select()
    .from(userValueSets)
    .where(and(
      eq(userValueSets.userId, userId),
      eq(userValueSets.valueType, valueType),
      eq(userValueSets.isActive, true),
    ))
    .limit(1);
  if (set.length === 0) return null;

  const players = await db
    .select()
    .from(userPlayerValues)
    .where(eq(userPlayerValues.valueSetId, set[0].id));

  const valuesBySleeperId: Record<string, number> = {};
  const valuesByNamePos: Record<string, number> = {};
  for (const p of players) {
    if (p.playerId && p.matched) valuesBySleeperId[p.playerId] = p.value;
    if (p.playerName) {
      const key = `${normalizeName(p.playerName)}|${p.position ?? ""}`;
      valuesByNamePos[key] = p.value;
    }
  }

  return {
    setId: set[0].id,
    name: set[0].name,
    valuesBySleeperId,
    valuesByNamePos,
    matchedCount: set[0].matchedRows,
    unmatchedCount: set[0].unmatchedRows,
    updatedAt: set[0].updatedAt?.toISOString() ?? null,
  };
}

export async function getResolvedValues(userId: string): Promise<ResolvedValues> {
  const [dynasty, redraft] = await Promise.all([
    loadActiveSet(userId, "dynasty"),
    loadActiveSet(userId, "redraft"),
  ]);
  return { dynasty, redraft };
}
