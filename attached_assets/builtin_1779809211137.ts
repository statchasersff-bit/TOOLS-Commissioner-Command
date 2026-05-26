import Papa from "papaparse";
import { buildProjectionIndex } from "./projections";
import { parseProjectionsFile, coerceProjectionRow } from "./csv-utils";

/**
 * Auto-detect the latest available week by probing from week 18 down to week 1
 * Verifies the file is actually a CSV by checking content
 */
export async function findLatestWeek(season: string): Promise<number> {
  for (let w = 18; w >= 1; w--) {
    const url = `/projections/${season}/week${String(w).padStart(2, '0')}.csv?v=${Date.now()}`;
    try {
      // Use GET to check both status and content
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) {
        const text = await res.text();
        // Verify it's actually CSV content (starts with header row, not HTML)
        if (text && text.trim().startsWith('sleeper_id')) {
          console.log(`[builtin] Found latest week: ${w} for season ${season}`);
          return w;
        }
      }
    } catch (e) {
      // Continue to next week
    }
  }
  console.log(`[builtin] No weeks found for season ${season}, defaulting to week 1`);
  return 1; // Default fallback
}

export async function fetchBuiltInCSV(season: string, week: string | number) {
  const url = `/projections/${season}/week${String(week).padStart(2,"0")}.csv?v=${Date.now()}`;
  console.log(`[builtin] Fetching CSV from: ${url}`);
  const res = await fetch(url, { cache: "no-store" });
  console.log(`[builtin] Fetch response:`, res.status, res.statusText);
  if (!res.ok) throw new Error(`No built-in projections for ${season} W${week}`);
  const text = await res.text();
  console.log(`[builtin] CSV text length:`, text.length);
  
  try {
    const rawRows = await parseProjectionsFile(text);
    console.log(`[builtin] Bullet-proof parse complete, raw data length: ${rawRows.length}`);
    if (rawRows.length > 0) {
      console.log(`[builtin] Sample raw row:`, rawRows[0]);
    }
    
    // Handle both old format (JSON stats) and new format (individual stat columns)
    const rows = rawRows.map((row, index) => {
      // Apply robust number coercion
      const processed = coerceProjectionRow(row);
      
      // CRITICAL: Normalize sleeper_id to string for consistent index lookups
      // The ID could come from multiple column names and needs to be a string
      const rawId = processed.sleeper_id ?? processed.SLEEPER_ID ?? processed.player_id ?? processed.PLAYER_ID;
      if (rawId !== undefined && rawId !== null) {
        processed.sleeper_id = String(rawId).trim();
      }
      
      // Check if this is old format (has stats column) or new format (individual columns)
      if (processed.stats && typeof processed.stats === 'string') {
        // Old format: Parse stats JSON strings to objects
        try {
          processed.stats = JSON.parse(processed.stats);
        } catch (e) {
          console.warn(`[builtin] Failed to parse stats JSON for player ${processed.name} (row ${index}):`, e);
          processed.stats = {};
        }
      } else {
        // New format: Collect individual stat columns into stats object
        const stats: Record<string, number> = {};
        const statColumns = [
          "pass_att", "pass_comp", "pass_yd", "pass_td", "pass_int",
          "rush_att", "rush_yd", "rush_td",
          "rec", "rec_yd", "rec_td",
          "fum_lost", "two_pt",
          "xpm", "xpa", "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p",
          "sacks", "defs_int", "defs_fum_rec", "defs_td", "safety", "blk_kick", "ret_td", "pts_allowed"
        ];
        
        for (const column of statColumns) {
          if (processed[column] !== undefined && processed[column] !== null) {
            stats[column] = processed[column];
          }
        }
        processed.stats = stats;
        
        // Add missing week/season for new format
        if (!processed.week) processed.week = week;
        if (!processed.season) processed.season = season;
      }
      
      return processed;
    });
    console.log(`[builtin] Processed rows length: ${rows.length}, sample processed:`, rows[0]);
    return rows;
  } catch (error) {
    console.error(`[builtin] Bullet-proof CSV parsing failed:`, error);
    throw error;
  }
}

export async function loadBuiltInOrSaved({
  season, week,
  loadSaved, saveSaved,
  setProjections, setProjIdx, setBanner
}: {
  season: string; week: string | number;
  loadSaved: (s: string, w: string|number) => { rows?: any[], updatedAt?: string } | null;
  saveSaved: (s: string, w: string|number, rows: any[]) => void;
  setProjections: (rows: any[]) => void;
  setProjIdx: (idx: Record<string, any>) => void;
  setBanner: (msg: string | null) => void;
}) {
  try {
    const rows = await fetchBuiltInCSV(season, week);
    setProjections(rows);
    setProjIdx(buildProjectionIndex(rows));
    saveSaved(season, week, rows); // cache locally for speed/offline
    setBanner(`Using StatChasers built-in projections for Week ${week}, ${season}.`);
    return true;
  } catch {
    const saved = loadSaved(season, week);
    if (saved?.rows?.length) {
      setProjections(saved.rows);
      setProjIdx(buildProjectionIndex(saved.rows));
      setBanner(`Using saved projections (no built-in found) for Week ${week}, ${season}.`);
      return true;
    }
    setBanner(null);
    return false;
  }
}