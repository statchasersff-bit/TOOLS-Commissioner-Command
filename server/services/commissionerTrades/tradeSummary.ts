/**
 * tradeSummary — produce a copy-ready, Discord/Sleeper-friendly plain-text
 * summary of a trade for the commissioner to paste into a league chat.
 *
 * Pure formatting. Value is included only when the settings allow it (a
 * commissioner may not want to broadcast raw values publicly).
 */
import type { ManagerIdentity, ParsedTradeAsset, TradeFlag, TradeScore } from "./types";
import { formatTradeAssetsByRoster } from "./helpers";

function assetLabel(a: ParsedTradeAsset, includeValue: boolean): string {
  let label: string;
  if (a.assetType === "player") {
    const meta = [a.position, a.team].filter(Boolean).join(", ");
    label = meta ? `${a.playerName} (${meta})` : `${a.playerName ?? a.playerId}`;
  } else if (a.assetType === "pick") {
    label = `${a.pickSeason} ${ordinal(a.pickRound)}`;
  } else {
    label = `$${a.faabAmount ?? 0} FAAB`;
  }
  if (includeValue && a.assetValue != null) label += ` — ${a.assetValue.toLocaleString()} value`;
  return label;
}

function ordinal(round?: number): string {
  const r = Number(round);
  if (r === 1) return "1st";
  if (r === 2) return "2nd";
  if (r === 3) return "3rd";
  return `${r}th`;
}

export interface SummaryInput {
  week?: number | null;
  assets: ParsedTradeAsset[];
  score: TradeScore;
  flags: TradeFlag[];
  managers: ManagerIdentity[];
  note?: string | null;
  includeValue: boolean;
}

/** Map a roster id to a readable team label using the resolved managers. */
function teamLabel(rosterId: number, managers: ManagerIdentity[]): string {
  const m = managers.find((x) => x.rosterId === rosterId);
  return m ? m.teamName : `Team ${rosterId}`;
}

export function generateCommissionerTradeSummary(input: SummaryInput): string {
  const { week, assets, score, flags, managers, note, includeValue } = input;
  const byRoster = formatTradeAssetsByRoster(assets);
  const rosterIds = Object.keys(byRoster).map(Number).sort((a, b) => a - b);

  const lines: string[] = [];
  lines.push(week != null ? `Trade Review: Week ${week}` : `Trade Review`);
  lines.push("");

  for (const rid of rosterIds) {
    lines.push(`${teamLabel(rid, managers)} receives:`);
    for (const a of byRoster[rid]) {
      lines.push(`- ${assetLabel(a, includeValue)}`);
    }
    lines.push("");
  }

  if (includeValue) {
    lines.push("Estimated Value:");
    for (const rid of rosterIds) {
      const v = score.totalValueByRoster[String(rid)] ?? 0;
      lines.push(`${teamLabel(rid, managers)}: ${Math.round(v).toLocaleString()}`);
    }
    lines.push(`Value Difference: ${score.valueDiffPct}%`);
    lines.push("");
  }

  lines.push(`Risk Level: ${riskWord(score.riskScore)}`);
  lines.push("");

  if (flags.length > 0) {
    lines.push("Flags:");
    for (const f of flags) lines.push(`- ${f.title}`);
    lines.push("");
  }

  if (note && note.trim()) {
    lines.push("Commissioner Note:");
    lines.push(note.trim());
  }

  return lines.join("\n").trim();
}

function riskWord(score: number): string {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}
