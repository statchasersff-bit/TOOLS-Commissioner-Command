import type { ADPResult, Position } from "@/types/draft";

// ── Mock ADP data for the Draft Command UI ──────────────────────────────────
//
// This is placeholder data so the UI can be built and reviewed before the
// real Sleeper draft pipeline is wired. Numbers are realistic-ish but not
// authoritative — replace once the backend adapter ships.
//
// Two flavors are included so the rookie-mode toggle has something to filter:
//   - is_rookie_placeholder: false → veterans / direct rookie draftees
//   - is_rookie_placeholder: true  → "2026 Rookie 1.01" style picks

interface Seed {
  name: string;
  pos: Position;
  team: string;
  avgPick: number;
  isRookiePlaceholder?: boolean;
  rookiePickLabel?: string;
}

const SEED: Seed[] = [
  // Veterans / direct-rookie draftees ──────────────────────────────────────
  { name: "Jayden Daniels",     pos: "QB", team: "WAS", avgPick: 6.4 },
  { name: "Bijan Robinson",     pos: "RB", team: "ATL", avgPick: 1.8 },
  { name: "Jahmyr Gibbs",       pos: "RB", team: "DET", avgPick: 2.7 },
  { name: "Breece Hall",        pos: "RB", team: "NYJ", avgPick: 5.1 },
  { name: "De'Von Achane",      pos: "RB", team: "MIA", avgPick: 7.3 },
  { name: "Jonathan Taylor",    pos: "RB", team: "IND", avgPick: 11.9 },
  { name: "Saquon Barkley",     pos: "RB", team: "PHI", avgPick: 8.8 },
  { name: "Kyren Williams",     pos: "RB", team: "LAR", avgPick: 24.6 },
  { name: "Isiah Pacheco",      pos: "RB", team: "KC",  avgPick: 32.4 },
  { name: "Josh Jacobs",        pos: "RB", team: "GB",  avgPick: 41.5 },
  { name: "Ja'Marr Chase",      pos: "WR", team: "CIN", avgPick: 1.4 },
  { name: "Justin Jefferson",   pos: "WR", team: "MIN", avgPick: 3.2 },
  { name: "CeeDee Lamb",        pos: "WR", team: "DAL", avgPick: 4.1 },
  { name: "Amon-Ra St. Brown",  pos: "WR", team: "DET", avgPick: 6.9 },
  { name: "Puka Nacua",         pos: "WR", team: "LAR", avgPick: 9.7 },
  { name: "Garrett Wilson",     pos: "WR", team: "NYJ", avgPick: 10.3 },
  { name: "Marvin Harrison Jr.", pos: "WR", team: "ARI", avgPick: 12.2 },
  { name: "Drake London",       pos: "WR", team: "ATL", avgPick: 13.5 },
  { name: "Malik Nabers",       pos: "WR", team: "NYG", avgPick: 14.8 },
  { name: "Brian Thomas Jr.",   pos: "WR", team: "JAX", avgPick: 16.1 },
  { name: "Rome Odunze",        pos: "WR", team: "CHI", avgPick: 19.4 },
  { name: "A.J. Brown",         pos: "WR", team: "PHI", avgPick: 17.6 },
  { name: "Tee Higgins",        pos: "WR", team: "CIN", avgPick: 20.2 },
  { name: "Davante Adams",      pos: "WR", team: "LV",  avgPick: 28.9 },
  { name: "DeVonta Smith",      pos: "WR", team: "PHI", avgPick: 26.7 },
  { name: "DK Metcalf",         pos: "WR", team: "SEA", avgPick: 33.1 },
  { name: "Stefon Diggs",       pos: "WR", team: "HOU", avgPick: 35.6 },
  { name: "Mike Evans",         pos: "WR", team: "TB",  avgPick: 37.8 },
  { name: "Sam LaPorta",        pos: "TE", team: "DET", avgPick: 22.4 },
  { name: "Brock Bowers",       pos: "TE", team: "LV",  avgPick: 23.9 },
  { name: "Trey McBride",       pos: "TE", team: "ARI", avgPick: 27.1 },
  { name: "Travis Kelce",       pos: "TE", team: "KC",  avgPick: 38.4 },
  { name: "Patrick Mahomes",    pos: "QB", team: "KC",  avgPick: 18.6 },
  { name: "Josh Allen",         pos: "QB", team: "BUF", avgPick: 15.7 },
  { name: "Lamar Jackson",      pos: "QB", team: "BAL", avgPick: 21.3 },
  { name: "Joe Burrow",         pos: "QB", team: "CIN", avgPick: 25.5 },
  { name: "C.J. Stroud",        pos: "QB", team: "HOU", avgPick: 29.1 },
  { name: "Caleb Williams",     pos: "QB", team: "CHI", avgPick: 30.7 },
  // Rookie placeholder picks ──────────────────────────────────────────────
  { name: "2026 Rookie 1.01", pos: "PICK", team: "", avgPick:  4.2, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.01" },
  { name: "2026 Rookie 1.02", pos: "PICK", team: "", avgPick:  6.8, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.02" },
  { name: "2026 Rookie 1.03", pos: "PICK", team: "", avgPick: 10.1, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.03" },
  { name: "2026 Rookie 1.04", pos: "PICK", team: "", avgPick: 12.9, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.04" },
  { name: "2026 Rookie 1.05", pos: "PICK", team: "", avgPick: 15.3, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.05" },
  { name: "2026 Rookie 1.06", pos: "PICK", team: "", avgPick: 18.7, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.06" },
  { name: "2026 Rookie 1.07", pos: "PICK", team: "", avgPick: 22.6, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.07" },
  { name: "2026 Rookie 1.08", pos: "PICK", team: "", avgPick: 26.0, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.08" },
  { name: "2026 Rookie 1.09", pos: "PICK", team: "", avgPick: 30.4, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.09" },
  { name: "2026 Rookie 1.10", pos: "PICK", team: "", avgPick: 34.2, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.10" },
  { name: "2026 Rookie 1.11", pos: "PICK", team: "", avgPick: 38.9, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.11" },
  { name: "2026 Rookie 1.12", pos: "PICK", team: "", avgPick: 43.5, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 1.12" },
  { name: "2026 Rookie 2.01", pos: "PICK", team: "", avgPick: 49.7, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 2.01" },
  { name: "2026 Rookie 2.06", pos: "PICK", team: "", avgPick: 60.4, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 2.06" },
  { name: "2026 Rookie 3.01", pos: "PICK", team: "", avgPick: 78.2, isRookiePlaceholder: true, rookiePickLabel: "2026 Rookie 3.01" },
];

// Compute the mock dataset once at module load — sort and rank by avg_pick,
// derive plausible spreads and a stable positional rank.
function buildMockAdp(): ADPResult[] {
  const sorted = [...SEED].sort((a, b) => a.avgPick - b.avgPick);
  const posCounters: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, PICK: 0 };

  return sorted.map((s, idx) => {
    posCounters[s.pos]++;
    const overall = idx + 1;
    const positional = posCounters[s.pos];
    // Synthesize realistic spreads: tighter at the top, wider deeper.
    const spreadFactor = Math.max(2, Math.round(overall * 0.6));
    const minPick = Math.max(1, Math.round(s.avgPick - spreadFactor));
    const maxPick = Math.round(s.avgPick + spreadFactor + 2);
    // Vary draft count so a few sample-size warnings show up.
    const draftCount = overall % 9 === 0 ? 4 : 30 + ((overall * 13) % 90);
    // Pseudo-random but deterministic trends in [-12, +12].
    const trend7 = ((overall * 37) % 25) - 12;
    const trend14 = ((overall * 19) % 25) - 12;
    const trend30 = ((overall * 23) % 25) - 12;

    return {
      player_id: s.isRookiePlaceholder
        ? `rookie_pick_${(s.rookiePickLabel ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
        : `sleeper_${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      player_name: s.name,
      position: s.pos,
      team: s.team,
      is_rookie_placeholder: !!s.isRookiePlaceholder,
      rookie_pick_label: s.rookiePickLabel ?? null,
      avg_pick: Math.round(s.avgPick * 10) / 10,
      median_pick: Math.round(s.avgPick),
      min_pick: minPick,
      max_pick: maxPick,
      draft_count: draftCount,
      positional_rank: positional,
      overall_rank: overall,
      trend_7d: trend7,
      trend_14d: trend14,
      trend_30d: trend30,
      sample_size_warning: draftCount < 8,
    };
  });
}

export const MOCK_ADP: ADPResult[] = buildMockAdp();
export const MOCK_LAST_UPDATED = new Date().toISOString();
