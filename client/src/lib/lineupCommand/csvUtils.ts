const NUM_COLS = new Set([
  "proj","pass_att","pass_comp","pass_yd","pass_td","pass_int",
  "rush_att","rush_yd","rush_td","rec","rec_yd","rec_td","fum_lost","two_pt",
  "xpm","xpa","fgm_0_19","fgm_20_29","fgm_30_39","fgm_40_49","fgm_50p",
  "sacks","defs_int","defs_fum_rec","defs_td","safety","blk_kick","ret_td","pts_allowed"
]);

const HEADER_ALIASES: Record<string, string> = {
  projection: "proj",
  projections: "proj",
  opponent: "opp",
  position: "pos",
  sleeper_id: "sleeper_id",
  player_id: "sleeper_id",
  id: "sleeper_id",
  name: "name",
  player_name: "name",
  full_name: "name"
};

function coerceNumber(v: any) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export async function parseProjectionsFile(fileOrText: File | string) {
  const { default: Papa } = await import('papaparse');
  const text = typeof fileOrText === "string" ? fileOrText : await fileOrText.text();

  return new Promise<any[]>((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => {
        const k = h.trim().toLowerCase();
        return HEADER_ALIASES[k] ?? k;
      },
      transform: (value: string, field: string) => {
        const k = String(field).trim().toLowerCase();
        return NUM_COLS.has(k) ? coerceNumber(value) : String(value ?? "").trim();
      },
      complete: (out: any) => resolve(out.data as any[]),
      error: reject,
    });
  });
}

export function coerceProjectionRow(row: any): any {
  const processed = { ...row };
  if (processed.proj !== null && processed.proj !== undefined) {
    processed.proj = coerceNumber(processed.proj);
  }
  for (const col of Array.from(NUM_COLS)) {
    if (processed[col] !== undefined) {
      processed[col] = coerceNumber(processed[col]);
    }
  }
  return processed;
}
