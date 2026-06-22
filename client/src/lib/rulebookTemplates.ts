/**
 * Rulebook templates — full league-rulebook starting points and per-section
 * snippets, so commissioners don't type every section from scratch.
 *
 * Templates use {{placeholder}} tokens (see RULEBOOK_PLACEHOLDERS) that are
 * resolved from league data via applyPlaceholders(); any token without data is
 * left in place so the commissioner can fill it in manually.
 *
 * Section keys match the rulebook's BylawSection.key (kebab-case).
 */

export const RULEBOOK_SECTION_KEYS = [
  "league-setup", "scoring", "rosters", "lineups", "trades", "waivers",
  "tanking", "playoffs", "draft-picks", "payments", "payouts", "orphans",
  "commissioner-powers",
] as const;
export type RulebookSectionKey = typeof RULEBOOK_SECTION_KEYS[number];

export interface RulebookTemplate {
  id: string;
  name: string;
  description: string;
  format: string;
  sections: Partial<Record<RulebookSectionKey, string>>;
  /** True for commissioner-saved custom templates (stored locally). */
  custom?: boolean;
}

export interface SectionSnippet {
  id: string;
  label: string;
  body: string;
}

// ── Placeholders ─────────────────────────────────────────────────────────────

export const RULEBOOK_PLACEHOLDERS = [
  "{{league_name}}", "{{platform}}", "{{team_count}}", "{{buy_in}}",
  "{{payment_due_date}}", "{{trade_deadline}}", "{{playoff_teams}}",
  "{{faab_budget}}", "{{payouts}}",
] as const;

export interface LeaguePlaceholderData {
  league_name?: string;
  platform?: string;
  team_count?: string | number;
  buy_in?: string;
  payment_due_date?: string;
  trade_deadline?: string;
  playoff_teams?: string | number;
  faab_budget?: string;
  payouts?: string;
}

/** Replace {{token}} with league data; unknown/empty tokens are left intact. */
export function applyPlaceholders(text: string, data: LeaguePlaceholderData): string {
  return text.replace(/\{\{(\w+)\}\}/g, (full, key: string) => {
    const v = (data as Record<string, unknown>)[key];
    return v != null && String(v).trim() !== "" ? String(v) : full;
  });
}

/** True when the text still has unresolved {{tokens}} (used for status pills). */
export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\{\{\w+\}\}/.test(text);
}

// ── Common section bodies (shared starting points) ───────────────────────────

const COMMON: Record<RulebookSectionKey, string> = {
  "league-setup":
    "{{league_name}} is a {{team_count}}-team league hosted on {{platform}}. Managers are expected to stay active all season, set valid lineups, and follow the rules in this book. The current ruleset stands until amended by the commissioner and a league vote.",
  scoring:
    "Scoring follows the platform settings configured for {{league_name}}. Any scoring change must be proposed and voted on in the offseason and cannot be changed mid-season.",
  rosters:
    "Each team carries the full roster allotment configured on {{platform}}. Managers are responsible for managing IR, taxi, and bench slots within the platform limits.",
  lineups:
    "Managers must set a complete, valid starting lineup before each week's kickoff. Players locked at game time cannot be moved. Repeatedly fielding incomplete lineups is subject to commissioner review.",
  trades:
    "Trades are allowed until the trade deadline ({{trade_deadline}}). All trades process on the platform; collusion or competitive-imbalance trades may be reviewed and reversed by the commissioner with league input.",
  waivers:
    "Free agents are acquired through a FAAB budget of {{faab_budget}} per team for the season. Waivers process on the platform's standard schedule; $0 bids are allowed once a player clears.",
  tanking:
    "Managers must field competitive lineups every week. Intentionally losing — sitting healthy starters, dumping a roster, or refusing to set a lineup — is not allowed and is subject to commissioner review.",
  playoffs:
    "The top {{playoff_teams}} teams qualify for the playoffs, seeded by record then total points for. Playoff matchups and tiebreakers follow the platform bracket.",
  "draft-picks":
    "The annual draft order is set before the draft. Draft picks may be discussed in the rulebook history; any pick-trading rules are documented here.",
  payments:
    "The buy-in is {{buy_in}} per team, due by {{payment_due_date}}. Teams that have not paid by the deadline may forfeit their spot at the commissioner's discretion.",
  payouts:
    "Payouts: {{payouts}}. All winnings are distributed within two weeks of the season ending.",
  orphans:
    "If a team is abandoned, the commissioner will manage it neutrally (no trades, best-available lineups) until a replacement manager takes over.",
  "commissioner-powers":
    "The commissioner administers the league, enforces these rules, and may act on lineup, trade, and conduct issues. Major decisions affecting competitive balance are put to a league vote when time allows.",
};

function tpl(
  id: string,
  name: string,
  description: string,
  format: string,
  overrides: Partial<Record<RulebookSectionKey, string>>,
): RulebookTemplate {
  return { id, name, description, format, sections: { ...COMMON, ...overrides } };
}

// ── Full rulebook templates ──────────────────────────────────────────────────

export const RULEBOOK_TEMPLATES: RulebookTemplate[] = [
  tpl("dynasty", "Dynasty League Template", "Multi-year keep-everything league with rookie drafts and tradeable future picks.", "Dynasty", {
    rosters:
      "Teams keep their entire roster year to year. Standard, taxi (for rookies/2nd-year players), and IR slots follow the {{platform}} limits. Players never return to a draft pool unless dropped.",
    "draft-picks":
      "A rookie draft is held each offseason in reverse order of final standings (non-playoff teams first). Future rookie picks up to three years out are tradeable. Pick trades are final once accepted on {{platform}}.",
    tanking:
      "Because draft order rewards losing, anti-tanking is strictly enforced: managers must start eligible, healthy players at every position every week. Suspected tanking is reviewed by the commissioner and may cost future draft capital.",
    orphans:
      "Abandoned dynasty teams are offered to a vetted replacement manager. Until taken over, the commissioner sets optimal lineups and makes no transactions. Incoming managers inherit the roster and all draft picks as-is.",
  }),

  tpl("redraft", "Redraft League Template", "Single-season league that fully redrafts every year — no keepers, no future picks.", "Redraft", {
    rosters:
      "Rosters reset every season. There are no keepers and no carryover; every player returns to the draft pool each year.",
    "draft-picks":
      "A full snake (or auction) draft is held each preseason. Draft order is randomized before the draft. There are no future-year picks to trade.",
    tanking:
      "Even in a single season, managers must stay competitive for the integrity of playoff races. Sitting healthy starters to lose is not allowed and is subject to commissioner review.",
    orphans:
      "If a manager leaves mid-season, the commissioner runs the team with best-available lineups and no transactions until a replacement is found or the season ends.",
  }),

  tpl("best-ball", "Best Ball Template", "Set-and-forget format — optimal lineups are scored automatically, no weekly management.", "Best Ball", {
    lineups:
      "There are no weekly lineup decisions. {{platform}} automatically scores each team's optimal lineup, so there are no empty-starter or inactive-starter penalties.",
    waivers:
      "This is a draft-only best ball league with no in-season waivers or free agency unless otherwise noted. Rosters are locked after the draft.",
    trades:
      "Trades are disabled by default in best ball. If trading is enabled, it closes at the trade deadline ({{trade_deadline}}) and is subject to commissioner review.",
    tanking:
      "Best ball auto-optimizes lineups, so traditional lineup tanking does not apply. Roster-dumping or draft sabotage is still subject to commissioner review.",
  }),

  tpl("empire", "Empire League Template", "Winner-takes-a-growing-pot format where the title carries over until dethroned.", "Empire", {
    payouts:
      "An empire pot accumulates each season on top of regular payouts ({{payouts}}). The reigning champion holds the empire; if they repeat as champion, they win the entire empire pot. A new champion claims the empire and the pot rolls over.",
    payments:
      "The buy-in is {{buy_in}} per team, due by {{payment_due_date}}. A portion of each buy-in feeds the empire pot as defined by the league.",
    tanking:
      "With an escalating empire pot on the line, competitive integrity is paramount. Tanking, especially against the reigning empire holder, is strictly reviewed by the commissioner.",
    "commissioner-powers":
      "The commissioner tracks the empire pot balance and holder each season, publishes it before the playoffs, and resolves any empire-eligibility disputes.",
  }),

  tpl("keeper", "Keeper League Template", "Hybrid format — keep a limited number of players each year at a draft-pick cost.", "Keeper", {
    rosters:
      "Each team may keep a set number of players into the next season. Kept players are documented before the keeper deadline; everyone else returns to the draft pool.",
    "draft-picks":
      "Keepers cost a draft pick based on where the player was drafted/acquired (cost rules defined by the league). A held player's keeper cost escalates each year they are retained.",
    tanking:
      "Keeper value can tempt late-season tanking. Managers must field competitive lineups every week; tanking to improve keeper or draft position is subject to commissioner review.",
  }),

  tpl("orphan-takeover", "Orphan Takeover Template", "Process-focused template for onboarding new managers into abandoned teams.", "Any", {
    orphans:
      "When a team is orphaned, the commissioner freezes its transactions and sets best-available lineups. The orphan is advertised to vetted candidates. The incoming manager inherits the roster, draft picks, and FAAB as-is, owes the standard buy-in ({{buy_in}}), and gets a short grace period to learn the roster before normal rules apply.",
    "commissioner-powers":
      "The commissioner vets and approves replacement managers, manages orphaned teams neutrally in the interim, and may grant a brief settling-in window (e.g., trade veto leniency) to new managers.",
    trades:
      "New managers taking over an orphan may not be trade-blocked for inherited assets, but their first trades receive extra commissioner scrutiny to protect competitive balance until {{trade_deadline}}.",
  }),

  tpl("dispersal-draft", "Dispersal Draft Template", "Rebooting a league by redistributing orphaned rosters through a dispersal draft.", "Any", {
    "draft-picks":
      "When multiple teams are orphaned (or the league reboots), their players are pooled and redistributed through a dispersal draft. Dispersal order is set by the commissioner (typically random or by greatest need), and future rookie picks are dispersed alongside players.",
    orphans:
      "Orphaned rosters are dissolved into the dispersal pool rather than handed over intact. New managers build from the dispersal draft and inherit the orphaned team's future draft picks per the dispersal rules.",
    "commissioner-powers":
      "The commissioner runs the dispersal draft: sets the player/pick pool, the draft order, and the timer, and resolves disputes. Dispersal results are final once the draft completes.",
  }),

  tpl("strict-anti-tanking", "Strict Anti-Tanking Template", "Maximum competitive-integrity ruleset with hard lineup and draft-order safeguards.", "Any", {
    tanking:
      "Zero tolerance for tanking. Every manager must start an eligible, healthy player at every position each week. Starting an OUT/IR/bye player when a healthy option exists, leaving empty slots, or failing to set a lineup twice triggers commissioner review and may result in a strike, loss of draft position, or removal.",
    lineups:
      "Lineups are scanned each week. Empty starter slots and inactive starters are logged. Two or more lineup violations in a season escalate to a formal review.",
    "draft-picks":
      "To remove the incentive to lose, non-playoff draft order is set by Maximum Points For (highest non-playoff PF picks last) rather than by record. This rewards teams that keep competing even when out of contention.",
    "commissioner-powers":
      "The commissioner may issue strikes, adjust draft order, withhold payouts, or remove a manager for repeated tanking or integrity violations, with league notice.",
  }),

  tpl("minimal", "Minimal Commissioner Template", "Bare-bones starting point — short rules for every section to fill in fast.", "Any", {
    "league-setup": "{{team_count}}-team league on {{platform}}. Be active, set lineups, don't be a jerk.",
    scoring: "Scoring per the platform settings. No mid-season changes.",
    rosters: "Standard roster limits per {{platform}}.",
    lineups: "Set a full lineup every week before kickoff.",
    trades: "Trades open until {{trade_deadline}}. Commissioner reviews unfair trades.",
    waivers: "FAAB budget: {{faab_budget}}.",
    tanking: "No tanking. Field a competitive lineup every week.",
    playoffs: "Top {{playoff_teams}} make the playoffs.",
    "draft-picks": "Draft order set before the draft.",
    payments: "Buy-in {{buy_in}}, due {{payment_due_date}}.",
    payouts: "Payouts: {{payouts}}.",
    orphans: "Commissioner covers abandoned teams until replaced.",
    "commissioner-powers": "Commissioner has final say on disputes; big calls go to a vote.",
  }),
];

// ── Per-section snippet libraries ────────────────────────────────────────────

export const SECTION_TEMPLATES: Partial<Record<RulebookSectionKey, SectionSnippet[]>> = {
  "league-setup": [
    { id: "ls-standard", label: "Standard intro", body: COMMON["league-setup"] },
    { id: "ls-short", label: "Short intro", body: "{{league_name}} — {{team_count}} teams on {{platform}}. Stay active, set lineups, follow the rulebook." },
  ],
  scoring: [
    { id: "sc-ppr", label: "Full PPR", body: "Full PPR scoring (1.0 point per reception) plus standard yardage and TD scoring as configured on {{platform}}." },
    { id: "sc-half", label: "Half PPR", body: "Half PPR scoring (0.5 per reception) plus standard yardage and TD scoring as configured on {{platform}}." },
    { id: "sc-te", label: "TE premium", body: "TE-premium scoring: tight ends receive a reception bonus on top of the base PPR setting. All other scoring follows the {{platform}} settings." },
    { id: "sc-lock", label: "No mid-season changes", body: "Scoring is locked once the season begins. Any change must be proposed and voted on in the offseason." },
  ],
  rosters: [
    { id: "ro-dynasty", label: "Dynasty (taxi + IR)", body: "Teams keep their full roster year to year, with taxi slots for rookies/2nd-year players and IR for injured players, per {{platform}} limits." },
    { id: "ro-redraft", label: "Redraft reset", body: "Rosters reset every season — no keepers or carryover." },
    { id: "ro-keeper", label: "Keeper limit", body: "Each team may keep a set number of players into next season; the rest return to the draft pool." },
  ],
  lineups: [
    { id: "li-standard", label: "Standard lineup rule", body: COMMON.lineups },
    { id: "li-bestball", label: "Best ball (auto)", body: "No weekly lineup decisions — {{platform}} scores each team's optimal lineup automatically." },
    { id: "li-strict", label: "Strict scan", body: "Lineups are scanned weekly. Empty slots and inactive starters are logged; two or more violations trigger a formal review." },
  ],
  trades: [
    { id: "tr-veto", label: "Commissioner review", body: "Trades are allowed until {{trade_deadline}}. The commissioner may review and reverse collusive or competitive-imbalance trades with league input." },
    { id: "tr-vote", label: "League veto vote", body: "Trades are allowed until {{trade_deadline}}. A trade is vetoed only if a majority of managers vote against it within 24 hours; otherwise it stands." },
    { id: "tr-none", label: "No veto", body: "All trades are final once accepted on {{platform}}. There is no veto — managers are trusted to act in their own interest." },
  ],
  waivers: [
    { id: "wa-faab", label: "FAAB", body: "Free agents are acquired via a season-long FAAB budget of {{faab_budget}} per team. $0 bids are allowed once a player clears waivers." },
    { id: "wa-rolling", label: "Rolling waivers", body: "Waiver priority is a rolling list (worst record first); claiming a player drops you to the back of the order." },
  ],
  tanking: [
    { id: "tk-standard", label: "Standard anti-tanking rule", body: COMMON.tanking },
    { id: "tk-strict", label: "Strict anti-tanking rule", body: "Zero tolerance for tanking. Starting an OUT/IR/bye player when a healthy option exists, leaving empty slots, or failing to set a lineup triggers commissioner review and may cost a strike, draft position, or removal." },
    { id: "tk-maxpf", label: "Max PF draft order rule", body: "Non-playoff draft order is set by Maximum Points For (highest PF picks last), not by record, removing the incentive to lose for draft position." },
    { id: "tk-review", label: "Commissioner review rule", body: "Suspected tanking is flagged and reviewed by the commissioner, who may consult the league before any action. Decisions and evidence are documented for fairness." },
    { id: "tk-none", label: "No tanking policy", body: "This league does not police tanking. Managers may manage their rosters as they see fit." },
  ],
  playoffs: [
    { id: "pl-standard", label: "Top seeds by record", body: "The top {{playoff_teams}} teams qualify, seeded by record then total points for. Tiebreakers follow the {{platform}} bracket." },
    { id: "pl-bye", label: "Top-2 byes", body: "The top {{playoff_teams}} teams make the playoffs; the top two seeds receive a first-round bye." },
    { id: "pl-twoweek", label: "Two-week finals", body: "Playoff rounds are single-week except the championship, which is a two-week total-points matchup." },
  ],
  "draft-picks": [
    { id: "dp-rookie", label: "Rookie draft (dynasty)", body: "A rookie draft is held each offseason in reverse standings order; future rookie picks up to three years out are tradeable." },
    { id: "dp-snake", label: "Annual snake draft", body: "A full snake draft is held each preseason with randomized order; there are no future-year picks." },
    { id: "dp-maxpf", label: "Max PF order", body: "Non-playoff draft order is determined by Maximum Points For rather than record." },
    { id: "dp-dispersal", label: "Dispersal draft", body: "Orphaned rosters are pooled and redistributed via a dispersal draft, with order set by the commissioner." },
  ],
  payments: [
    { id: "pa-standard", label: "Buy-in + deadline", body: "The buy-in is {{buy_in}} per team, due by {{payment_due_date}}. Unpaid teams may forfeit their spot at the commissioner's discretion." },
    { id: "pa-upfront", label: "Paid before draft", body: "All buy-ins ({{buy_in}}) must be paid in full before the draft. No team drafts until paid." },
  ],
  payouts: [
    { id: "po-standard", label: "Top 3", body: "Payouts: {{payouts}} (1st / 2nd / 3rd). Distributed within two weeks of the season ending." },
    { id: "po-regular", label: "Include regular-season", body: "Payouts: {{payouts}}, including a prize for the regular-season points leader. Distributed within two weeks of the season ending." },
    { id: "po-empire", label: "Empire pot", body: "A growing empire pot is awarded when a champion repeats; otherwise it rolls over. Regular payouts: {{payouts}}." },
  ],
  orphans: [
    { id: "or-neutral", label: "Neutral caretaker", body: COMMON.orphans },
    { id: "or-takeover", label: "Takeover process", body: "Orphaned teams are advertised to vetted candidates; the new manager inherits the roster, picks, and FAAB as-is and owes the standard buy-in ({{buy_in}})." },
    { id: "or-dispersal", label: "Dispersal", body: "Orphaned rosters are dissolved into a dispersal pool and redistributed via a dispersal draft." },
  ],
  "commissioner-powers": [
    { id: "cp-standard", label: "Standard authority", body: COMMON["commissioner-powers"] },
    { id: "cp-vote", label: "Vote on major calls", body: "The commissioner handles day-to-day administration; any decision affecting competitive balance requires a majority league vote." },
    { id: "cp-strict", label: "Enforcement powers", body: "The commissioner may issue strikes, adjust draft order, withhold payouts, or remove a manager for repeated rule or integrity violations, with league notice." },
  ],
};

// ── Custom (commissioner-saved) templates — stored locally ───────────────────

const CUSTOM_KEY = "sc-rulebook-custom-templates";

export function getCustomTemplates(): RulebookTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RulebookTemplate[]).map((t) => ({ ...t, custom: true })) : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplate(t: RulebookTemplate): RulebookTemplate[] {
  const existing = getCustomTemplates().filter((x) => x.id !== t.id);
  const next = [...existing, { ...t, custom: true }];
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function deleteCustomTemplate(id: string): RulebookTemplate[] {
  const next = getCustomTemplates().filter((x) => x.id !== id);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch {}
  return next;
}
