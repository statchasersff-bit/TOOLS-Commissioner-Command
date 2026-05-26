// Safe number conversion
const num = (v: any) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

export function normalizePos(p?: string) {
  if (!p) return "";
  const up = p.toUpperCase();
  if (["DST","D/ST","DEF","D"].includes(up)) return "DEF";
  return up;
}

export interface Projection {
  sleeper_id?: string;
  name: string;
  team?: string;
  pos: string;
  proj: number;
  opp?: string;
  stats?: Record<string, number>;
}

// Generate name variations for better matching
function getNameVariations(name: string): string[] {
  const variations = [name];
  const nameLower = name.toLowerCase();
  
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
  
  for (const [fullName, nicknames] of Object.entries(commonNicknames)) {
    if (nameLower.includes(fullName)) {
      for (const nickname of nicknames) {
        variations.push(name.replace(new RegExp(fullName, 'gi'), nickname));
      }
    }
    for (const nickname of nicknames) {
      if (nameLower.includes(nickname) && !nameLower.includes(fullName)) {
        variations.push(name.replace(new RegExp(nickname, 'gi'), fullName));
      }
    }
  }
  
  return [...Array.from(new Set(variations))];
}

export function buildProjectionIndex(rows: Projection[]) {
  const idx: Record<string, Projection> = {};
  for (const r of rows) {
    if (r.sleeper_id) idx[r.sleeper_id] = r;
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
