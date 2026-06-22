/**
 * Dispersal-draft order logic. Determines which participant is "on the clock"
 * for a given (1-indexed) pick number under snake / linear / 3rr formats.
 * Ported verbatim from the standalone dispersal-draft app.
 */
export function getOnTheClockId(
  participants: { id: number; draftPosition: number | null; isCommissioner: boolean }[],
  pickNumber: number,
  draftFormat: string,
): number | null {
  const managers = participants
    .filter((p) => !p.isCommissioner && p.draftPosition !== null)
    .sort((a, b) => (a.draftPosition ?? 0) - (b.draftPosition ?? 0));
  if (managers.length === 0) return null;
  const numManagers = managers.length;
  let idx: number;
  if (draftFormat === "snake") {
    const round = Math.ceil(pickNumber / numManagers);
    const posInRound = (pickNumber - 1) % numManagers;
    idx = round % 2 === 0 ? numManagers - 1 - posInRound : posInRound;
  } else if (draftFormat === "3rr") {
    const round = Math.ceil(pickNumber / numManagers);
    const posInRound = (pickNumber - 1) % numManagers;
    const isReversed = round < 3 ? round % 2 === 0 : round % 2 !== 0;
    idx = isReversed ? numManagers - 1 - posInRound : posInRound;
  } else {
    idx = (pickNumber - 1) % numManagers;
  }
  return managers[idx]?.id ?? null;
}
