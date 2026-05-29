// Renders a Dynasty Command-themed trade image (PNG) for the Discord trade post.
// Hand-built SVG → rasterized with sharp at 2x for crispness, then player
// headshots (fetched from the Sleeper CDN) are composited on as circular avatars.
// Uses DejaVu Sans.
//
// Deliberately shows NO team-owner avatars or owner names — only league info,
// the two sides, player names/positions/headshots, and draft picks.
//
// Note on emoji: librsvg/DejaVu render NO color emoji, so the 🅰️/🅱️ glyphs would
// come out as tofu boxes. The image therefore uses gold A/B badges that mirror
// the Discord reactions; the literal emoji live in the Discord message text.

import sharp from "sharp";

export interface TradeAsset {
  label: string;       // display text, e.g. "Bijan Robinson (RB)" or "2026 1.03"
  sleeperId?: string;  // present for players → drives the headshot lookup
}

export interface TradePosterData {
  leagueName: string;
  leagueFormat: string;
  sideA: { label: string; receives: TradeAsset[] };
  sideB: { label: string; receives: TradeAsset[] };
}

// ── Palette (StatChasers / Dynasty Command) ───────────────────────────────────
const C = {
  gold: "#d4af37",
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  panelBorder: "rgba(212,175,55,0.30)",
  rowBg: "rgba(255,255,255,0.045)",
  rowBorder: "rgba(148,163,184,0.12)",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

// Players arrive as "Name (POS)". Split off the position so it can be styled as
// muted text; falls back to the whole label as the name when there's no "(…)".
function splitPlayer(label: string): { name: string; pos: string } {
  const m = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m && m[1].trim()) return { name: m[1].trim(), pos: m[2].trim() };
  return { name: label.trim(), pos: "" };
}

// ── High-res scale ────────────────────────────────────────────────────────────
// The whole layout is authored in logical px; the SVG is rasterized at DPR× by
// scaling its pixel dimensions while keeping the logical viewBox, so text and
// vectors stay crisp on Discord's retina displays. Avatar composites multiply
// their logical coordinates by DPR to land in the raster.
const DPR = 2;

// ── Layout constants (logical px) ─────────────────────────────────────────────
const W = 1200;
const PAD = 56;
const CENTER_GAP = 104;                                   // room for the VS badge
const PANEL_W = (W - PAD * 2 - CENTER_GAP) / 2;
const leftPanelX = PAD;
const rightPanelX = PAD + PANEL_W + CENTER_GAP;
const midX = PAD + PANEL_W + CENTER_GAP / 2;

const PANEL_TOP = 156;
const PANEL_HEADER = 84;        // panel top → first row's top
const PANEL_BOTTOM_PAD = 22;
const PP_X = 26;                // panel inner horizontal padding
const BELOW_PANELS = 204;       // vote prompt + footer block height

// Per-density-tier sizing, chosen so both panels stay readable as a side grows.
interface Tier { rowH: number; avatar: number; nameSize: number; posSize: number; nameMax: number; list: boolean; }
function tierFor(maxRows: number): Tier {
  if (maxRows >= 7) return { rowH: 40, avatar: 0, nameSize: 20, posSize: 16, nameMax: 30, list: true };
  if (maxRows >= 4) return { rowH: 54, avatar: 38, nameSize: 22, posSize: 18, nameMax: 24, list: false };
  return { rowH: 68, avatar: 50, nameSize: 26, posSize: 21, nameMax: 20, list: false };
}

const MAX_LIST_VISIBLE = 6; // in 7+ mode, show this many then "+N more assets"

// A row to render — either a player/pick chip, or a "+N more" summary line.
type Row =
  | { kind: "asset"; name: string; pos: string; sleeperId?: string }
  | { kind: "more"; count: number };

// Builds the display rows for one side, collapsing the tail in list mode.
function buildRows(items: TradeAsset[], tier: Tier): Row[] {
  const asAsset = (it: TradeAsset): Row => {
    if (it.sleeperId) { const { name, pos } = splitPlayer(it.label); return { kind: "asset", name, pos, sleeperId: it.sleeperId }; }
    return { kind: "asset", name: it.label, pos: "" }; // pick / FAAB — no headshot
  };
  if (!tier.list || items.length <= MAX_LIST_VISIBLE + 1) return items.map(asAsset);
  const head = items.slice(0, MAX_LIST_VISIBLE).map(asAsset);
  return [...head, { kind: "more", count: items.length - MAX_LIST_VISIBLE }];
}

/**
 * Fetches a player's Sleeper headshot and returns it as a circle-cropped PNG of
 * diameter `d` (raster px). Returns null on any failure (404 for team defenses,
 * network, timeout) so the caller can fall back to a plain ring badge.
 */
async function fetchCircleAvatar(sleeperId: string, d: number): Promise<Buffer | null> {
  const url = `https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const src = Buffer.from(await r.arrayBuffer());
    const mask = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);
    return await sharp(src).resize(d, d, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Geometry for one panel's rows. `rowCount` is this side's row count; `maxRows`
// is the shared (taller) count that fixes panel height — a shorter side gets its
// rows vertically centered so a single-player panel doesn't look empty.
function rowLayout(rowCount: number, maxRows: number, tier: Tier) {
  const rowsTop = PANEL_TOP + PANEL_HEADER;
  const offset = ((maxRows - rowCount) * tier.rowH) / 2;
  const rowTopY = (i: number) => rowsTop + offset + i * tier.rowH;
  const rowCenterY = (i: number) => rowTopY(i) + tier.rowH / 2;
  return { rowTopY, rowCenterY };
}

// Renders one panel: frame, side label + RECEIVES, and the asset/pick rows.
function panelSvg(panelX: number, label: string, rows: Row[], maxRows: number, panelH: number, tier: Tier): string {
  const { rowTopY, rowCenterY } = rowLayout(rows.length, maxRows, tier);
  const innerLeft = panelX + PP_X;
  const innerRight = panelX + PANEL_W - PP_X;
  const chipGap = tier.list ? 6 : 9;
  const chipH = tier.rowH - chipGap;
  const avLeft = innerLeft + 12;
  const textLeft = tier.list ? innerLeft + 16 + 18 : avLeft + tier.avatar + 16;

  const frame =
    `<rect x="${panelX}" y="${PANEL_TOP}" width="${PANEL_W}" height="${panelH}" rx="20" fill="#0b223d"/>` +
    `<rect x="${panelX + 0.75}" y="${PANEL_TOP + 0.75}" width="${PANEL_W - 1.5}" height="${panelH - 1.5}" rx="19.25" fill="none" stroke="${C.panelBorder}" stroke-width="1.5"/>`;

  const header =
    `<text x="${innerLeft}" y="${PANEL_TOP + 40}" font-family="DejaVu Sans" font-weight="bold" font-size="29" fill="${C.textPrimary}" letter-spacing="0.5">${esc(clip(label.toUpperCase(), 18))}</text>` +
    `<text x="${innerLeft}" y="${PANEL_TOP + 66}" font-family="DejaVu Sans" font-size="15" fill="${C.gold}" letter-spacing="3">RECEIVES</text>`;

  const body = rows.map((row, i) => {
    const cy = rowCenterY(i);
    const top = rowTopY(i) + chipGap / 2;
    const chip = `<rect x="${innerLeft}" y="${top}" width="${innerRight - innerLeft}" height="${chipH}" rx="${Math.min(14, chipH / 2)}" fill="${C.rowBg}" stroke="${C.rowBorder}" stroke-width="1"/>`;

    if (row.kind === "more") {
      return chip +
        `<text x="${(innerLeft + innerRight) / 2}" y="${cy + tier.posSize / 2 - 2}" text-anchor="middle" font-family="DejaVu Sans" font-size="${tier.posSize}" fill="${C.textSecondary}">+ ${row.count} more asset${row.count === 1 ? "" : "s"}</text>`;
    }

    const baselineY = cy + tier.nameSize / 2 - 4;
    const nameTspan = `<tspan font-weight="bold" fill="${C.textPrimary}">${esc(clip(row.name, tier.nameMax))}</tspan>`;
    const posTspan = row.pos ? `<tspan dx="12" font-weight="normal" font-size="${tier.posSize}" fill="${C.textSecondary}">· ${esc(clip(row.pos, 8))}</tspan>` : "";
    const text = `<text x="${textLeft}" y="${baselineY}" font-family="DejaVu Sans" font-size="${tier.nameSize}">${nameTspan}${posTspan}</text>`;

    if (tier.list) {
      // Compact list: small gold bullet instead of an avatar.
      return chip + `<circle cx="${innerLeft + 16}" cy="${cy}" r="4" fill="${C.gold}"/>` + text;
    }

    const r = tier.avatar / 2;
    const acx = avLeft + r;
    if (row.sleeperId) {
      // Player: gold ring + dark placeholder disc (headshot composited later).
      return chip +
        `<circle cx="${acx}" cy="${cy}" r="${r + 1.5}" fill="#0e2a4d" stroke="${C.gold}" stroke-opacity="0.7" stroke-width="2"/>` +
        text;
    }
    // Pick / FAAB: gold-bordered rounded square chip with a small gold diamond.
    const s = tier.avatar - 6;
    return chip +
      `<rect x="${acx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" rx="7" fill="#0e2a4d" stroke="${C.gold}" stroke-opacity="0.7" stroke-width="2"/>` +
      `<rect x="${acx - 5}" y="${cy - 5}" width="10" height="10" rx="2" transform="rotate(45 ${acx} ${cy})" fill="${C.gold}"/>` +
      text;
  }).join("");

  return frame + header + body;
}

export async function renderTradePoster(d: TradePosterData): Promise<Buffer> {
  const tier = tierFor(Math.max(d.sideA.receives.length, d.sideB.receives.length, 1));
  const rowsA = buildRows(d.sideA.receives, tier);
  const rowsB = buildRows(d.sideB.receives, tier);
  const maxRows = Math.max(rowsA.length, rowsB.length, 1);

  const panelH = PANEL_HEADER + maxRows * tier.rowH + PANEL_BOTTOM_PAD;
  const panelsBottom = PANEL_TOP + panelH;
  const H = panelsBottom + BELOW_PANELS;

  // One clean header line: league name + format, separated by gold dots.
  const fmtParts = d.leagueFormat.split(/[•·,|]/).map((s) => s.trim()).filter(Boolean);
  const leagueLine = clip([d.leagueName, ...fmtParts].filter(Boolean).join("  •  "), 82);

  const vsCy = PANEL_TOP + panelH / 2;

  // Vote prompt geometry (centered around the card's horizontal middle).
  const qY = panelsBottom + 74;
  const voteY = panelsBottom + 124;
  const badgeR = 17;
  const aBadgeCx = W / 2 - 168;
  const bBadgeCx = W / 2 + 36;

  const voteBadge = (cx: number, letter: string) =>
    `<circle cx="${cx}" cy="${voteY - 7}" r="${badgeR}" fill="#0b223d" stroke="${C.gold}" stroke-width="2"/>` +
    `<text x="${cx}" y="${voteY}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="20" fill="${C.gold}">${letter}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * DPR}" height="${H * DPR}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stop-color="#0a2138"/>
        <stop offset="0.6" stop-color="#081a2e"/>
        <stop offset="1" stop-color="#06121f"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" rx="28" fill="url(#bg)"/>
    <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="26" fill="none" stroke="${C.gold}" stroke-opacity="0.30" stroke-width="2"/>

    <text x="${W / 2}" y="74" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="46" fill="${C.gold}" letter-spacing="3">DYNASTY TRADE POLL</text>
    <text x="${W / 2}" y="114" text-anchor="middle" font-family="DejaVu Sans" font-size="23" fill="${C.textPrimary}" fill-opacity="0.92">${esc(leagueLine)}</text>

    ${panelSvg(leftPanelX, d.sideA.label, rowsA, maxRows, panelH, tier)}
    ${panelSvg(rightPanelX, d.sideB.label, rowsB, maxRows, panelH, tier)}

    <line x1="${midX}" y1="${PANEL_TOP + 18}" x2="${midX}" y2="${panelsBottom - 18}" stroke="${C.gold}" stroke-opacity="0.14" stroke-width="2"/>
    <circle cx="${midX}" cy="${vsCy}" r="29" fill="#06121f"/>
    <circle cx="${midX}" cy="${vsCy}" r="29" fill="none" stroke="${C.gold}" stroke-opacity="0.6" stroke-width="2"/>
    <text x="${midX}" y="${vsCy + 7}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="21" fill="${C.gold}">VS</text>

    <line x1="${W / 2 - 150}" y1="${panelsBottom + 32}" x2="${W / 2 + 150}" y2="${panelsBottom + 32}" stroke="${C.gold}" stroke-opacity="0.30" stroke-width="1.5"/>
    <text x="${W / 2}" y="${qY}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="${C.textPrimary}" letter-spacing="0.5">WHO WINS THIS DYNASTY TRADE?</text>

    ${voteBadge(aBadgeCx, "A")}
    <text x="${aBadgeCx + 28}" y="${voteY}" font-family="DejaVu Sans" font-size="23" fill="${C.textPrimary}">Side A</text>
    <text x="${W / 2}" y="${voteY}" text-anchor="middle" font-family="DejaVu Sans" font-size="23" fill="${C.textSecondary}">•</text>
    ${voteBadge(bBadgeCx, "B")}
    <text x="${bBadgeCx + 28}" y="${voteY}" font-family="DejaVu Sans" font-size="23" fill="${C.textPrimary}">Side B</text>

    <text x="${W / 2}" y="${H - 28}" text-anchor="middle" font-family="DejaVu Sans" font-size="15" fill="${C.textSecondary}" letter-spacing="3">STATCHASERS  •  DYNASTY COMMAND</text>
  </svg>`;

  const base = sharp(Buffer.from(svg)).png();

  // Fetch + circle-crop every player headshot in parallel, then composite each
  // onto its row at raster (DPR×) coordinates. Failures are skipped (the gold
  // ring placeholder remains). Skipped entirely in list mode (no avatars).
  const overlays: Array<{ input: Buffer; left: number; top: number }> = [];
  if (!tier.list) {
    const avD = tier.avatar * DPR;
    const queue = (rows: Row[], panelX: number) => {
      const { rowCenterY } = rowLayout(rows.length, maxRows, tier);
      const acx = panelX + PP_X + 12 + tier.avatar / 2;
      return rows.map((row, i) => {
        if (row.kind !== "asset" || !row.sleeperId) return null;
        const left = Math.round((acx - tier.avatar / 2) * DPR);
        const top = Math.round((rowCenterY(i) - tier.avatar / 2) * DPR);
        return fetchCircleAvatar(row.sleeperId, avD).then((buf) => (buf ? { input: buf, left, top } : null));
      });
    };
    const jobs = [...queue(rowsA, leftPanelX), ...queue(rowsB, rightPanelX)].filter(
      (j): j is Promise<{ input: Buffer; left: number; top: number } | null> => j !== null,
    );
    for (const o of await Promise.all(jobs)) if (o) overlays.push(o);
  }
  if (overlays.length) base.composite(overlays);

  return base.png().toBuffer();
}
