// Compact formatters shared across Value Finder tables, cards, and tooltips.

export const fmtValue = (n?: number) =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString();

export const fmtSignedPct = (n?: number) =>
  n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n)}%`;

export const fmtPct = (frac?: number) =>
  frac == null || !Number.isFinite(frac) ? "—" : `${Math.round(frac * 100)}%`;

export const fmtPpg = (n?: number) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)} PPG`;

export const fmtScore = (n?: number) =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n * 100).toString();

export const fmtAge = (n?: number) =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toString();

/** "RB · DET · 23" style meta line. */
export const fmtPlayerMeta = (
  position?: string,
  team?: string,
  age?: number,
) =>
  [position, team, age != null ? `${Math.round(age)}y` : undefined]
    .filter(Boolean)
    .join(" · ");
