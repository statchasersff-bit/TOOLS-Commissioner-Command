import Papa from "papaparse";
import type { Projection } from "./types";
import { parseProjectionsFile, coerceProjectionRow } from "./csv-utils";

// Safe number conversion
const num = (v: any) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

export function normalizePos(p?: string) {
  if (!p) return "";
  const up = p.toUpperCase();
  if (["DST","D/ST","DEF","D"].includes(up)) return "DEF";
  return up;
}

export async function parseProjections(file: File): Promise<Projection[]> {
  try {
    const rows: any[] = await parseProjectionsFile(file);
    console.log(`[projections] Bullet-proof parse complete, rows: ${rows.length}`);
          
    // Fetch Sleeper players database for name lookups
    let playersDb: any = {};
    try {
      const response = await fetch('https://api.sleeper.app/v1/players/nfl');
      playersDb = await response.json();
    } catch (err) {
      console.warn('Could not fetch Sleeper players database:', err);
    }
    
    // Debug: Log first row to see available columns
    if (rows.length > 0) {
      console.log("CSV uploaded with columns:", Object.keys(rows[0]).length, "columns");
    }

    const mapped = rows.map((raw) => {
      // Apply robust number coercion first
      const processed = coerceProjectionRow(raw);
      const sleeperId = (processed.sleeper_id ?? processed.SLEEPER_ID ?? processed.player_id ?? processed.PLAYER_ID)?.toString()?.trim() || undefined;
      let name = (processed.name ?? processed.NAME ?? "").toString().trim();
            
      // If we have a sleeper_id but missing/poor name, try to resolve from Sleeper DB
      if (sleeperId && playersDb[sleeperId] && (!name || name.length < 3)) {
        const player = playersDb[sleeperId];
        name = `${player.first_name || ''} ${player.last_name || ''}`.trim() || player.full_name || `Player ${sleeperId}`;
      }
      
      // Final fallback if still no name
      if (!name && sleeperId) {
        name = `Player ${sleeperId}`;
      }
      
      // Extract detailed stats using exact column names from CSV
      const stats: Record<string, number> = {};
      
      // Standard stat columns that should be directly extracted
      const statColumns = [
        // Passing
        "pass_att", "pass_comp", "pass_yd", "pass_td", "pass_int",
        // Rushing  
        "rush_att", "rush_yd", "rush_td",
        // Receiving
        "rec", "rec_yd", "rec_td",
        // Misc offense
        "fum_lost", "two_pt",
        // Kicking
        "xpm", "xpa", "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p",
        // Defense
        "sacks", "defs_int", "defs_fum_rec", "defs_td", "safety", "blk_kick", "ret_td", "pts_allowed"
      ];

      // Extract stats directly from CSV columns (already coerced by bullet-proof parser)
      for (const column of statColumns) {
        if (processed[column] !== undefined && processed[column] !== null) {
          stats[column] = processed[column];
        }
      }


      return {
        sleeper_id: sleeperId,
        name: name || 'Unknown Player',
        team: (processed.team ?? processed.TEAM ?? "").toString().trim().toUpperCase() || undefined,
        pos: normalizePos((processed.pos ?? processed.POS ?? "").toString().trim()),
        proj: processed.proj ?? processed.PROJ ?? 0,
        opp: (processed.opp ?? processed.OPP ?? "").toString().trim(),
        stats, // Include detailed statistical breakdown
      };
    });

    return mapped as any;
  } catch (error) {
    console.error('[projections] Bullet-proof CSV parsing failed:', error);
    throw error;
  }
}

// Generate name variations for better matching
function getNameVariations(name: string): string[] {
  const variations = [name];
  const nameLower = name.toLowerCase();
  
  // Handle common nickname patterns
  const commonNicknames: Record<string, string[]> = {
    'chigoziem': ['chig'],
    'christopher': ['chris'],
    'alexander': ['alex'],
    'benjamin': ['ben'],
    'william': ['will', 'bill'],
    'robert': ['rob', 'bob'],
    'michael': ['mike'],
    'anthony': ['tony'],
    'joseph': ['joe'],
    'kenneth': ['ken'],
    'joshua': ['josh'],
  };
  
  // Check if full name contains a nickname-able first name
  for (const [fullName, nicknames] of Object.entries(commonNicknames)) {
    if (nameLower.includes(fullName)) {
      for (const nickname of nicknames) {
        variations.push(name.replace(new RegExp(fullName, 'gi'), nickname));
      }
    }
    // Also check reverse (nickname to full name)
    for (const nickname of nicknames) {
      if (nameLower.includes(nickname) && !nameLower.includes(fullName)) {
        variations.push(name.replace(new RegExp(nickname, 'gi'), fullName));
      }
    }
  }
  
  return [...Array.from(new Set(variations))]; // Remove duplicates
}

export function buildProjectionIndex(rows: Projection[]) {
  const idx: Record<string, Projection> = {};
  for (const r of rows) {
    if (r.sleeper_id) idx[r.sleeper_id] = r;
    
    // Create multiple keys for different name variations
    const nameVariations = getNameVariations(r.name);
    for (const nameVar of nameVariations) {
      const key = `${nameVar.toLowerCase()}|${r.team ?? ""}|${r.pos}`;
      idx[key] = r;
    }
  }
  return idx;
}

export function csvTemplate(): string {
  return [
    ["sleeper_id","name","team","pos","proj","opp","pass_yd","pass_td","rush_yd","rush_td","rec","rec_yd","rec_td"].join(","),
    ["4034","Patrick Mahomes","KC","QB","24.3","","280","2","25","0","0","0","0"].join(","),
    ["6787","Christian McCaffrey","SF","RB","21.9","","0","0","95","1","4","35","0"].join(","),
    ["6792","Justin Jefferson","MIN","WR","20.1","","0","0","0","0","8","110","1"].join(","),
    ["4046","Travis Kelce","KC","TE","17.4","","0","0","0","0","6","75","1"].join(","),
    ["9001","Generic Kicker","FA","K","8.0","","0","0","0","0","0","0","0"].join(","),
    ["4999","San Francisco 49ers","SF","DEF","7.1","","0","0","0","0","0","0","0"].join(","),
  ].join("\n");
}
