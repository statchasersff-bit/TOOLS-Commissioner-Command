// "Share Trade to Discord Poll" — posts a trade to a Discord channel as a native
// Discord poll. The bot token never leaves the server. Gated behind requireAuth
// (authenticated StatChasers users only) and a per-user in-memory rate limiter.

import type { Express, Request, Response } from "express";
import { requireAuth } from "./accessMiddleware";
import { renderTradePoster, type TradeAsset } from "./tradeImage";

const DISCORD_API = "https://discord.com/api/v10";

// OTC-style vote reactions, seeded onto every trade post (A wins / B wins / fair).
const REACTIONS = ["🅰️", "🅱️", "⚖️"] as const;

// PUTs a single reaction emoji, honoring Discord's per-route rate limit
// (reaction-adds trip 429s easily when fired back-to-back). Retries on 429
// using retry_after. Returns the final HTTP status (0 on network error), so the
// caller can decide whether a 400 warrants retrying with a different emoji form.
async function putReaction(channelId: string, messageId: string, emoji: string, token: string): Promise<number> {
  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const rr = await fetch(url, { method: "PUT", headers: { Authorization: `Bot ${token}` } });
    if (rr.ok) return rr.status;
    if (rr.status === 429) {
      const body: any = await rr.json().catch(() => ({}));
      const waitMs = Math.min(3000, Math.ceil((Number(body?.retry_after) || 1) * 1000) + 50);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    const detail = await rr.text().catch(() => "");
    console.error(`[discord] add reaction ${emoji} failed: ${rr.status} ${rr.statusText} — ${detail.slice(0, 300)}`);
    return rr.status;
  }
  console.error(`[discord] add reaction ${emoji} gave up after repeated 429s`);
  return 429;
}

// Adds one vote reaction. The 🅰️/🅱️/⚖️ glyphs all carry a U+FE0F variation
// selector, and Discord's reaction endpoint is inconsistent about whether it
// wants it — including it can yield "400 Unknown Emoji" for some glyphs, while
// other glyphs need it. So we try the emoji as-is, and on a 400 retry with the
// variation selector stripped. Returns true on success.
async function addReaction(channelId: string, messageId: string, emoji: string, token: string): Promise<boolean> {
  const status = await putReaction(channelId, messageId, emoji, token);
  if (status >= 200 && status < 300) return true;
  if (status === 400) {
    const stripped = emoji.replace(/\uFE0F/g, "");
    if (stripped !== emoji) {
      const retry = await putReaction(channelId, messageId, stripped, token);
      return retry >= 200 && retry < 300;
    }
  }
  return false;
}

// The message-create REST response doesn't include guild_id, but we need it to
// build a jump link. Resolve it once (env override or a channel lookup) and cache.
let cachedGuildId: string | null = null;
async function resolveGuildId(channelId: string, token: string): Promise<string | null> {
  if (cachedGuildId) return cachedGuildId;
  if (process.env.DISCORD_GUILD_ID) return (cachedGuildId = process.env.DISCORD_GUILD_ID);
  try {
    const r = await fetch(`${DISCORD_API}/channels/${channelId}`, { headers: { Authorization: `Bot ${token}` } });
    if (r.ok) {
      const j: any = await r.json();
      if (j?.guild_id) return (cachedGuildId = j.guild_id);
    }
  } catch (e: any) {
    console.warn("[discord] resolveGuildId failed:", e?.message ?? e);
  }
  return null;
}

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
// Accepts either plain strings (legacy) or `{ label, sleeperId? }` objects. The
// optional sleeperId drives the player headshot on the rendered image; it's
// validated to a safe charset so it can't escape the CDN path.
function cleanAssets(input: unknown): TradeAsset[] | null {
  if (!Array.isArray(input)) return null;
  const arr: TradeAsset[] = [];
  for (const raw of input.slice(0, 12)) {
    let label = "";
    let sleeperId: string | undefined;
    if (typeof raw === "string") {
      label = raw;
    } else if (raw && typeof raw === "object") {
      label = String((raw as any).label ?? (raw as any).text ?? "");
      const sid = (raw as any).sleeperId;
      if (typeof sid === "string" && /^[A-Za-z0-9]{1,15}$/.test(sid)) sleeperId = sid;
    }
    label = label.trim();
    if (!label) continue;
    if (label.length > 90) label = label.slice(0, 89) + "…";
    arr.push(sleeperId ? { label, sleeperId } : { label });
  }
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

    // Reaction-based voting (OTC-style) replaces the native Discord poll. The
    // rendered image carries the league info, the two sides, and the "who wins?"
    // question, so the message text stays lean and just spells out the vote.
    // When the image fails to render we fall back to listing league + assets in
    // text so no context is lost.
    const lines: string[] = ["📊 **Dynasty Trade Poll**"];
    if (!poster) {
      lines.push(`**${leagueName}**${leagueFormat ? ` · ${leagueFormat}` : ""}`);
      lines.push("", `**${sideALabel} receives:**`);
      for (const a of sideAReceives) lines.push(`• ${a.label}`);
      lines.push("", `**${sideBLabel} receives:**`);
      for (const a of sideBReceives) lines.push(`• ${a.label}`);
    }
    if (tradeLink) lines.push(`🔗 <${tradeLink}>`);
    lines.push("", "React below:", `${REACTIONS[0]} Side A`, `${REACTIONS[1]} Side B`, `${REACTIONS[2]} Fair trade`);
    let content = lines.join("\n");
    if (content.length > 1900) content = content.slice(0, 1900) + "…";

    const url = `${DISCORD_API}/channels/${channelId}/messages`;
    const failStatus = (s: number) => (s === 429 ? 429 : 502);

    try {
      // Single message: the image (when rendered) attaches directly beneath the
      // vote prompt. No native poll object, so there's no attachment conflict.
      let resp: globalThis.Response;
      if (poster) {
        const form = new FormData();
        form.append("payload_json", JSON.stringify({
          content,
          // user-derived text is sanitized of pings so a team name can't @everyone.
          allowed_mentions: { parse: [] as string[] },
          attachments: [{ id: 0, filename: "dynasty-trade-poll.png" }],
        }));
        form.append("files[0]", new Blob([poster], { type: "image/png" }), "dynasty-trade-poll.png");
        // No Content-Type header — fetch sets the multipart boundary.
        resp = await fetch(url, { method: "POST", headers: { Authorization: `Bot ${token}` }, body: form });
      } else {
        resp = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content, allowed_mentions: { parse: [] as string[] } }),
        });
      }
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        console.error(`[discord] message create failed: ${resp.status} ${resp.statusText} — ${detail.slice(0, 500)}`);
        return res.status(failStatus(resp.status)).json({ error: "Could not share trade poll. Please try again." });
      }
      const msg: any = await resp.json();
      const messageId: string | null = msg?.id ?? null;
      const msgChannelId: string = msg?.channel_id ?? channelId;

      // Seed the vote reactions. A reaction failure must NOT fail the whole
      // share — the trade is already posted — so we collect a soft warning.
      let warning: string | undefined;
      if (messageId) {
        for (const emoji of REACTIONS) {
          const added = await addReaction(msgChannelId, messageId, emoji, token).catch((e: any) => {
            console.error(`[discord] add reaction ${emoji} error:`, e?.message ?? e);
            return false;
          });
          if (!added) warning = "Trade posted, but reactions could not be added.";
        }
      }

      const guildId = await resolveGuildId(msgChannelId, token);
      const discordMessageUrl = guildId && messageId
        ? `https://discord.com/channels/${guildId}/${msgChannelId}/${messageId}`
        : null;

      return res.json({
        ok: true,
        success: true,
        discordMessageId: messageId,
        discordChannelId: msgChannelId,
        discordMessageUrl,
        ...(warning ? { warning } : {}),
      });
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
