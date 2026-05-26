// "Share Trade to Discord Poll" — posts a trade to a Discord channel as a native
// Discord poll. The bot token never leaves the server. Gated behind requireAuth
// (authenticated StatChasers users only) and a per-user in-memory rate limiter.

import type { Express, Request, Response } from "express";
import { requireAuth } from "./accessMiddleware";
import { renderTradePoster } from "./tradeImage";

const DISCORD_API = "https://discord.com/api/v10";

// ── Per-user rate limiting (in-memory) ───────────────────────────────────────
// Prevents a user from spamming the channel. minInterval guards rapid double
// submits; max caps total posts per window.
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX = 8;                     // posts per user per window
const RATE_MIN_INTERVAL_MS = 8_000;     // min gap between a user's posts
const recentByUser = new Map<string, number[]>();

function checkRate(userId: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const times = (recentByUser.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const last = times[times.length - 1];
  if (last != null && now - last < RATE_MIN_INTERVAL_MS) {
    return { ok: false, retryAfter: Math.ceil((RATE_MIN_INTERVAL_MS - (now - last)) / 1000) };
  }
  if (times.length >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - times[0])) / 1000) };
  }
  times.push(now);
  recentByUser.set(userId, times);
  return { ok: true };
}

// ── Input shaping ─────────────────────────────────────────────────────────────
function cleanAssets(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const arr = input
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((s) => (s.length > 90 ? s.slice(0, 89) + "…" : s));
  return arr.length ? arr : null;
}

function clampLabel(s: unknown, fallback: string, max = 60): string {
  const v = String(s ?? "").trim();
  if (!v) return fallback;
  return v.length > max ? v.slice(0, max - 1) + "…" : v;
}

export function registerDiscordRoutes(app: Express): void {
  app.post("/api/discord/share-trade-poll", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).dcUserId as string;

    const rate = checkRate(userId);
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      return res.status(429).json({
        error: "You're sharing too fast. Please wait a moment and try again.",
        retryAfter: rate.retryAfter,
      });
    }

    const token = process.env.DISCORD_BOT_TOKEN;
    const channelId = process.env.DISCORD_TRADE_POLLS_CHANNEL_ID;
    if (!token || !channelId) {
      console.error("[discord] share-trade-poll: missing DISCORD_BOT_TOKEN or DISCORD_TRADE_POLLS_CHANNEL_ID");
      return res.status(503).json({ error: "Discord sharing is not configured." });
    }

    const body = (req.body ?? {}) as Record<string, any>;
    const sideAReceives = cleanAssets(body?.sideA?.receives);
    const sideBReceives = cleanAssets(body?.sideB?.receives);
    if (!sideAReceives || !sideBReceives) {
      return res.status(400).json({ error: "Both sides of the trade must have at least one asset." });
    }

    const leagueName = clampLabel(body.leagueName, "Unknown League", 80);
    const leagueFormat = clampLabel(body.leagueFormat, "", 60);
    const sideALabel = clampLabel(body?.sideA?.label, "Side A", 50);
    const sideBLabel = clampLabel(body?.sideB?.label, "Side B", 50);
    const tradeLink =
      typeof body.tradeLink === "string" && /^https?:\/\//.test(body.tradeLink)
        ? body.tradeLink.slice(0, 300)
        : null;

    // Render the Dynasty Command-themed trade image. The image carries the
    // trade detail, so the text stays compact; if rendering fails we fall back
    // to a full text breakdown so the poll still has context.
    let poster: Buffer | null = null;
    try {
      poster = await renderTradePoster({
        leagueName, leagueFormat,
        sideA: { label: sideALabel, receives: sideAReceives },
        sideB: { label: sideBLabel, receives: sideBReceives },
      });
    } catch (e: any) {
      console.error("[discord] trade poster render failed:", e?.message ?? e);
    }

    const compact = [`🚨 **Dynasty Trade Poll**`, `**League:** ${leagueName}${leagueFormat ? ` · ${leagueFormat}` : ""}`];
    if (tradeLink) compact.push(`🔗 <${tradeLink}>`);

    let content: string;
    if (poster) {
      content = compact.join("\n");
    } else {
      const lines = [...compact, "", `**Side A — ${sideALabel} receives:**`];
      for (const a of sideAReceives) lines.push(`• ${a}`);
      lines.push("", `**Side B — ${sideBLabel} receives:**`);
      for (const a of sideBReceives) lines.push(`• ${a}`);
      content = lines.join("\n");
    }
    if (content.length > 1900) content = content.slice(0, 1900) + "…";

    const payload: Record<string, unknown> = {
      content,
      // user-derived text is sanitized of pings so a team name can't @everyone.
      allowed_mentions: { parse: [] as string[] },
      poll: {
        question: { text: "Which side wins this dynasty trade?" },
        answers: [
          { poll_media: { text: "Side A wins" } },
          { poll_media: { text: "Side B wins" } },
          { poll_media: { text: "Fair trade" } },
          { poll_media: { text: "Need more context" } },
        ],
        duration: 24,            // hours
        allow_multiselect: false,
      },
    };

    try {
      const url = `${DISCORD_API}/channels/${channelId}/messages`;
      let resp: globalThis.Response;
      if (poster) {
        // Multipart upload so the image attaches alongside the native poll.
        payload.attachments = [{ id: 0, filename: "dynasty-trade-poll.png" }];
        const form = new FormData();
        form.append("payload_json", JSON.stringify(payload));
        form.append("files[0]", new Blob([poster], { type: "image/png" }), "dynasty-trade-poll.png");
        // No Content-Type header — fetch sets the multipart boundary.
        resp = await fetch(url, { method: "POST", headers: { Authorization: `Bot ${token}` }, body: form });
      } else {
        resp = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        console.error(`[discord] message create failed: ${resp.status} ${resp.statusText} — ${detail.slice(0, 500)}`);
        return res.status(resp.status === 429 ? 429 : 502).json({
          error: "Could not share trade poll. Please try again.",
        });
      }
      const msg: any = await resp.json();
      return res.json({ ok: true, messageId: msg?.id ?? null, channelId: msg?.channel_id ?? channelId });
    } catch (err: any) {
      console.error("[discord] message create error:", err?.message ?? err);
      return res.status(502).json({ error: "Could not share trade poll. Please try again." });
    }
  });

  // Config diagnostic — confirms the bot token + channel are set and reachable
  // WITHOUT exposing any secret values. Open it in the browser while logged in.
  app.get("/api/discord/health", requireAuth, async (_req: Request, res: Response) => {
    const token = process.env.DISCORD_BOT_TOKEN;
    const channelId = process.env.DISCORD_TRADE_POLLS_CHANNEL_ID;
    const out: Record<string, unknown> = { hasToken: !!token, hasChannel: !!channelId, configured: !!token && !!channelId };
    if (!token || !channelId) return res.json(out);
    try {
      const me = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bot ${token}` } });
      out.tokenValid = me.ok;
      if (me.ok) { const j: any = await me.json(); out.botUser = j?.username ?? null; }
      else out.tokenError = me.status; // 401 = bad token
    } catch (e: any) { out.tokenValid = false; out.tokenError = e?.message ?? "fetch failed"; }
    try {
      const ch = await fetch(`${DISCORD_API}/channels/${channelId}`, { headers: { Authorization: `Bot ${token}` } });
      out.channelOk = ch.ok;
      if (ch.ok) { const j: any = await ch.json(); out.channelName = j?.name ?? null; }
      else out.channelError = ch.status; // 403 = bot lacks access · 404 = wrong id / bot not in server
    } catch (e: any) { out.channelOk = false; out.channelError = e?.message ?? "fetch failed"; }
    res.json(out);
  });
}
