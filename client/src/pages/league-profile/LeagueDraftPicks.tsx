/**
 * Draft Picks — future pick ownership by team (from the hydrated Sleeper
 * league), with acquired-via-trade flags, pick movement (from recorded trade
 * assets), and editable commissioner notes/protections per pick.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Layers, ArrowRightLeft } from "lucide-react";
import type { League, Pick } from "@/types";
import { pickNotesApi, type PickNote } from "@/lib/leagueProfileApi";

function rosterIdOf(teamId: string): number | null {
  const n = Number(teamId);
  return Number.isFinite(n) ? n : null;
}

function noteKey(season: number, round: number, originalRosterId: number) {
  return `${season}-${round}-${originalRosterId}`;
}

export function LeagueDraftPicks({ leagueId, league }: { leagueId: string; league: League }) {
  const { toast } = useToast();

  const notesQ = useQuery({ queryKey: ["pick-notes", leagueId], queryFn: () => pickNotesApi.list(leagueId) });
  const moveQ = useQuery({ queryKey: ["pick-movement", leagueId], queryFn: () => pickNotesApi.movement(leagueId) });

  const noteByKey = useMemo(() => {
    const m = new Map<string, PickNote>();
    for (const n of notesQ.data?.notes ?? []) m.set(noteKey(Number(n.pickSeason), n.round, n.originalRosterId), n);
    return m;
  }, [notesQ.data]);

  const teamByRosterId = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of league.teams) { const r = rosterIdOf(t.id); if (r != null) m.set(r, t.name); }
    return m;
  }, [league.teams]);

  const upsertMut = useMutation({
    mutationFn: (n: { pickSeason: string; round: number; originalRosterId: number; note?: string; protection?: string }) =>
      pickNotesApi.upsert({ leagueId, ...n }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pick-notes", leagueId] }),
    onError: (e: any) => toast({ title: "Couldn’t save note", description: e?.message, variant: "destructive" }),
  });

  // Only future seasons (picks for past drafts have already been used).
  const currentYear = new Date().getFullYear();
  const teamsWithPicks = league.teams
    .map(t => ({ team: t, picks: [...t.picks].filter(p => p.year >= currentYear).sort((a, b) => a.year - b.year || a.round - b.round) }))
    .filter(t => t.picks.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
        <h3 className="text-sm font-bold text-foreground">Draft Picks</h3>
        <span className="text-xs text-muted-foreground">Future picks by team</span>
      </div>

      {teamsWithPicks.length === 0 ? (
        <Card className="border-border/60">
          <div className="flex flex-col items-center justify-center text-center py-14 px-4">
            <Layers className="w-8 h-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-semibold text-foreground">No future picks found</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">This league has no tracked future draft picks, or picks haven’t loaded yet.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {teamsWithPicks.map(({ team, picks }) => {
            const ownRosterId = rosterIdOf(team.id);
            return (
              <Card key={team.id} className="p-4">
                <p className="text-sm font-bold text-foreground mb-2 truncate">{team.name}</p>
                <div className="space-y-1.5">
                  {picks.map((p: Pick, i) => {
                    const acquired = p.originalRosterId != null && ownRosterId != null && p.originalRosterId !== ownRosterId;
                    const fromName = p.originalRosterId != null ? teamByRosterId.get(p.originalRosterId) : undefined;
                    const keyRosterId = p.originalRosterId ?? ownRosterId;
                    const existing = keyRosterId != null ? noteByKey.get(noteKey(p.year, p.round, keyRosterId)) : undefined;
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs border-b border-border/30 last:border-0 py-1.5">
                        <span className="font-semibold text-foreground w-24 flex-shrink-0">{p.year} R{p.round}</span>
                        {acquired && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-[#d4af37] flex-shrink-0" title={fromName ? `from ${fromName}` : "acquired via trade"}>
                            <ArrowRightLeft className="w-3 h-3" />{fromName ? `from ${fromName}` : "acquired"}
                          </span>
                        )}
                        {p.value > 0 && <span className="text-muted-foreground tabular-nums flex-shrink-0">{Math.round(p.value)}</span>}
                        {keyRosterId != null && (
                          <Input
                            defaultValue={existing?.note ?? ""}
                            placeholder="Note / protection…"
                            className="h-7 text-xs ml-auto max-w-[55%]"
                            onBlur={(e) => {
                              const val = e.target.value.trim();
                              if (val !== (existing?.note ?? "")) {
                                upsertMut.mutate({ pickSeason: String(p.year), round: p.round, originalRosterId: keyRosterId, note: val });
                              }
                            }}
                            data-testid={`pick-note-${team.id}-${p.year}-${p.round}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pick movement */}
      <Card className="p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Pick Movement</p>
        {moveQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (moveQ.data?.movements?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No traded picks recorded yet. Ingest trades in the Trades tab to populate movement.</p>
        ) : (
          <ul className="space-y-1.5">
            {moveQ.data!.movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-xs border-b border-border/30 last:border-0 py-1.5">
                <span className="font-semibold text-foreground">{m.pickSeason} R{m.pickRound}</span>
                <span className="text-muted-foreground">
                  {teamByRosterId.get(m.fromRosterId ?? -1) ?? `Roster ${m.fromRosterId}`} → {teamByRosterId.get(m.toRosterId ?? -1) ?? `Roster ${m.toRosterId}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
