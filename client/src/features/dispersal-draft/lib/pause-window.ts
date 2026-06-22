/**
 * Client-side pause-window utilities — mirrors the server-side version in
 * artifacts/api-server/src/lib/pause-window.ts.
 */

function localTimeToMs(refMs: number, hour: number, minute: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(refMs));
  const year = parseInt(parts.find((p) => p.type === "year")!.value);
  const month = parseInt(parts.find((p) => p.type === "month")!.value);
  const day = parseInt(parts.find((p) => p.type === "day")!.value);

  let t = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i++) {
    const localStr = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(t));
    const localMs = new Date(localStr.replace(" ", "T") + "Z").getTime();
    const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    t += targetMs - localMs;
  }
  return t;
}

function computePauseOverlapMs(
  fromMs: number,
  toMs: number,
  pauseStart: string,
  pauseEnd: string,
  timezone: string,
): number {
  const [sh, sm] = pauseStart.split(":").map(Number);
  const [eh, em] = pauseEnd.split(":").map(Number);
  const crossesMidnight = sh * 60 + (sm || 0) > eh * 60 + (em || 0);

  let totalOverlap = 0;
  let ref = fromMs - 2 * 86_400_000;
  const limit = toMs + 86_400_000;
  while (ref <= limit) {
    const pauseFrom = localTimeToMs(ref, sh, sm, timezone);
    const pauseTo = crossesMidnight
      ? localTimeToMs(ref + 86_400_000, eh, em, timezone)
      : localTimeToMs(ref, eh, em, timezone);

    if (pauseTo > pauseFrom) {
      const overlapFrom = Math.max(pauseFrom, fromMs);
      const overlapTo = Math.min(pauseTo, toMs);
      if (overlapTo > overlapFrom) totalOverlap += overlapTo - overlapFrom;
    }
    ref += 86_400_000;
  }
  return totalOverlap;
}

export function computeEffectiveElapsedSeconds(
  fromMs: number,
  toMs: number,
  pauseStart: string | null | undefined,
  pauseEnd: string | null | undefined,
  timezone: string | null | undefined,
): number {
  const totalMs = Math.max(0, toMs - fromMs);
  if (!pauseStart || !pauseEnd || totalMs === 0) return totalMs / 1000;
  const tz = timezone || "America/New_York";
  const overlapMs = computePauseOverlapMs(fromMs, toMs, pauseStart, pauseEnd, tz);
  return Math.max(0, totalMs - overlapMs) / 1000;
}

export function isInPauseWindow(
  nowMs: number,
  pauseStart: string | null | undefined,
  pauseEnd: string | null | undefined,
  timezone: string | null | undefined,
): boolean {
  if (!pauseStart || !pauseEnd) return false;
  const tz = timezone || "America/New_York";
  const [sh, sm] = pauseStart.split(":").map(Number);
  const [eh, em] = pauseEnd.split(":").map(Number);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const hour = parseInt(parts.find((p) => p.type === "hour")!.value);
  const min = parseInt(parts.find((p) => p.type === "minute")!.value);
  const currentMins = hour * 60 + min;
  const startMins = sh * 60 + (sm || 0);
  const endMins = eh * 60 + (em || 0);
  const crossesMidnight = startMins > endMins;

  return crossesMidnight
    ? currentMins >= startMins || currentMins < endMins
    : currentMins >= startMins && currentMins < endMins;
}
