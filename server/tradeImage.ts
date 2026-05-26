// Renders a Dynasty Command-themed trade image (PNG) for the Discord trade post.
// Hand-built SVG → rasterized with sharp, then player headshots (fetched from
// the Sleeper CDN) are composited on as circular avatars. Uses DejaVu Sans.
//
// Deliberately shows NO team-owner avatars or owner names — only league info,
// the two sides, player names/headshots, and draft picks.

import sharp from "sharp";

export interface TradeAsset {
  label: string;       // display text, e.g. "Bijan Robinson (RB)" or "2026 Round 1"
  sleeperId?: string;  // present for players → drives the headshot lookup
}

export interface TradePosterData {
  leagueName: string;
  leagueFormat: string;
  sideA: { label: string; receives: TradeAsset[] };
  sideB: { label: string; receives: TradeAsset[] };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

// ── Layout constants ──────────────────────────────────────────────────────────
const W = 1000;
const PAD = 48;
const COL_GAP = 84;
const COL_W = (W - PAD * 2 - COL_GAP) / 2;
const HEADER_H = 150;
const SIDE_HEADER_H = 56;
const ROW_H = 56;            // tall enough for a headshot
const ROWS_TOP_GAP = 12;
const AVATAR_D = 44;         // headshot diameter
const RING_R = AVATAR_D / 2 + 2;
const FOOTER_H = 96;

const leftX = PAD;
const rightX = PAD + COL_W + COL_GAP;
const midX = PAD + COL_W + COL_GAP / 2;

const rowCenterY = (i: number) => HEADER_H + SIDE_HEADER_H + ROWS_TOP_GAP + ROW_H / 2 + i * ROW_H;
const avatarCx = (xCol: number) => xCol + AVATAR_D / 2;
const textX = (xCol: number) => xCol + AVATAR_D + 14;

/**
 * Fetches a player's Sleeper headshot and returns it as a circle-cropped PNG of
 * diameter `d`. Returns null on any failure (404 for team defenses, network,
 * timeout) so the caller can fall back to a plain badge.
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

// Renders one column's asset rows as SVG (rings/badges + text). Headshots are
// composited on afterward; this draws the gold ring + dark placeholder so a row
// looks intentional even when an image is missing.
function columnSvg(items: TradeAsset[], xCol: number): string {
  return items
    .map((it, i) => {
      const cx = avatarCx(xCol);
      const cy = rowCenterY(i);
      const tx = textX(xCol);
      if (it.sleeperId) {
        // player: gold ring + dark placeholder disc (headshot composited later)
        return (
          `<circle cx="${cx}" cy="${cy}" r="${RING_R}" fill="#0e2a4d" stroke="#d4af37" stroke-opacity="0.7" stroke-width="2"/>` +
          `<text x="${tx}" y="${cy + 7}" font-family="DejaVu Sans" font-size="21" fill="#e8eef7">${esc(clip(it.label, 24))}</text>`
        );
      }
      // pick: gold badge (no headshot)
      return (
        `<circle cx="${cx}" cy="${cy}" r="${RING_R}" fill="#0e2a4d" stroke="#d4af37" stroke-opacity="0.7" stroke-width="2"/>` +
        `<circle cx="${cx}" cy="${cy}" r="6" fill="#d4af37"/>` +
        `<text x="${tx}" y="${cy + 7}" font-family="DejaVu Sans" font-size="21" fill="#e8eef7">${esc(clip(it.label, 24))}</text>`
      );
    })
    .join("");
}

export async function renderTradePoster(d: TradePosterData): Promise<Buffer> {
  const maxRows = Math.max(d.sideA.receives.length, d.sideB.receives.length, 1);
  const bodyH = SIDE_HEADER_H + maxRows * ROW_H + ROWS_TOP_GAP + 8;
  const H = HEADER_H + bodyH + FOOTER_H;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0c2647"/>
        <stop offset="0.55" stop-color="#0b1f3a"/>
        <stop offset="1" stop-color="#081627"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" rx="26" fill="url(#bg)"/>
    <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="24" fill="none" stroke="#d4af37" stroke-opacity="0.35" stroke-width="2"/>

    <text x="${W / 2}" y="62" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="40" fill="#d4af37" letter-spacing="2">DYNASTY TRADE POLL</text>
    <text x="${W / 2}" y="100" text-anchor="middle" font-family="DejaVu Sans" font-size="22" fill="#ffffff">${esc(clip(d.leagueName, 48))}</text>
    <text x="${W / 2}" y="127" text-anchor="middle" font-family="DejaVu Sans" font-size="15" fill="#93a4b8" letter-spacing="1">${esc(d.leagueFormat.toUpperCase())}</text>

    <text x="${leftX}" y="${HEADER_H + 26}" font-family="DejaVu Sans" font-weight="bold" font-size="24" fill="#ffffff">${esc(clip(d.sideA.label, 22))}</text>
    <text x="${leftX}" y="${HEADER_H + 48}" font-family="DejaVu Sans" font-size="13" fill="#d4af37" letter-spacing="2">RECEIVES</text>
    <text x="${rightX}" y="${HEADER_H + 26}" font-family="DejaVu Sans" font-weight="bold" font-size="24" fill="#ffffff">${esc(clip(d.sideB.label, 22))}</text>
    <text x="${rightX}" y="${HEADER_H + 48}" font-family="DejaVu Sans" font-size="13" fill="#d4af37" letter-spacing="2">RECEIVES</text>

    ${columnSvg(d.sideA.receives, leftX)}
    ${columnSvg(d.sideB.receives, rightX)}

    <line x1="${midX}" y1="${HEADER_H + 8}" x2="${midX}" y2="${HEADER_H + bodyH - 8}" stroke="#d4af37" stroke-opacity="0.22" stroke-width="2"/>
    <circle cx="${midX}" cy="${HEADER_H + bodyH / 2}" r="26" fill="#0b1f3a" stroke="#d4af37" stroke-opacity="0.55" stroke-width="2"/>
    <text x="${midX}" y="${HEADER_H + bodyH / 2 + 7}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="20" fill="#d4af37">VS</text>

    <line x1="${PAD}" y1="${H - FOOTER_H + 8}" x2="${W - PAD}" y2="${H - FOOTER_H + 8}" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>
    <text x="${W / 2}" y="${H - FOOTER_H + 50}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="23" fill="#ffffff">Which side wins this dynasty trade?</text>
    <text x="${W / 2}" y="${H - 26}" text-anchor="middle" font-family="DejaVu Sans" font-size="14" fill="#93a4b8" letter-spacing="2">STATCHASERS · DYNASTY COMMAND</text>
  </svg>`;

  const base = sharp(Buffer.from(svg)).png();

  // Fetch + circle-crop every player headshot in parallel, then composite each
  // onto its row. Failures are skipped (the gold ring placeholder remains).
  const jobs: Array<Promise<{ input: Buffer; left: number; top: number } | null>> = [];
  const queue = (items: TradeAsset[], xCol: number) => {
    items.forEach((it, i) => {
      if (!it.sleeperId) return;
      const left = Math.round(avatarCx(xCol) - AVATAR_D / 2);
      const top = Math.round(rowCenterY(i) - AVATAR_D / 2);
      jobs.push(
        fetchCircleAvatar(it.sleeperId, AVATAR_D).then((buf) => (buf ? { input: buf, left, top } : null)),
      );
    });
  };
  queue(d.sideA.receives, leftX);
  queue(d.sideB.receives, rightX);

  const overlays = (await Promise.all(jobs)).filter((o): o is { input: Buffer; left: number; top: number } => o !== null);
  if (overlays.length) base.composite(overlays);

  return base.png().toBuffer();
}
