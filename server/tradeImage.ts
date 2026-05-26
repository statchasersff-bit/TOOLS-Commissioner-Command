// Renders a Dynasty Command-themed trade image (PNG) for the Discord poll.
// Hand-built SVG → rasterized with sharp. Uses the system DejaVu Sans font.

import sharp from "sharp";

export interface TradePosterData {
  leagueName: string;
  leagueFormat: string;
  sideA: { label: string; receives: string[] };
  sideB: { label: string; receives: string[] };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

export async function renderTradePoster(d: TradePosterData): Promise<Buffer> {
  const W = 1000;
  const PAD = 48;
  const COL_GAP = 84;
  const colW = (W - PAD * 2 - COL_GAP) / 2;
  const HEADER_H = 150;
  const SIDE_HEADER_H = 56;
  const LINE_H = 38;
  const FOOTER_H = 96;

  const maxRows = Math.max(d.sideA.receives.length, d.sideB.receives.length, 1);
  const bodyH = SIDE_HEADER_H + maxRows * LINE_H + 20;
  const H = HEADER_H + bodyH + FOOTER_H;

  const leftX = PAD;
  const rightX = PAD + colW + COL_GAP;
  const midX = PAD + colW + COL_GAP / 2;

  const assets = (items: string[], x: number) =>
    items
      .map((it, i) => {
        const y = HEADER_H + SIDE_HEADER_H + 26 + i * LINE_H;
        return `<circle cx="${x + 5}" cy="${y - 6}" r="4" fill="#d4af37"/>` +
          `<text x="${x + 20}" y="${y}" font-family="DejaVu Sans" font-size="22" fill="#e8eef7">${esc(clip(it, 30))}</text>`;
      })
      .join("");

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

    ${assets(d.sideA.receives, leftX)}
    ${assets(d.sideB.receives, rightX)}

    <line x1="${midX}" y1="${HEADER_H + 8}" x2="${midX}" y2="${HEADER_H + bodyH - 8}" stroke="#d4af37" stroke-opacity="0.22" stroke-width="2"/>
    <circle cx="${midX}" cy="${HEADER_H + bodyH / 2}" r="26" fill="#0b1f3a" stroke="#d4af37" stroke-opacity="0.55" stroke-width="2"/>
    <text x="${midX}" y="${HEADER_H + bodyH / 2 + 7}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="20" fill="#d4af37">VS</text>

    <line x1="${PAD}" y1="${H - FOOTER_H + 8}" x2="${W - PAD}" y2="${H - FOOTER_H + 8}" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>
    <text x="${W / 2}" y="${H - FOOTER_H + 50}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="23" fill="#ffffff">Which side wins this dynasty trade?</text>
    <text x="${W / 2}" y="${H - 26}" text-anchor="middle" font-family="DejaVu Sans" font-size="14" fill="#93a4b8" letter-spacing="2">STATCHASERS · DYNASTY COMMAND</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
