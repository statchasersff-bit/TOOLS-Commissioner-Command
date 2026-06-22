let ctx: AudioContext | null = null;

async function getCtx(): Promise<AudioContext | null> {
  try {
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx.state === "running" ? ctx : null;
  } catch {
    return null;
  }
}

function sine(
  ac: AudioContext,
  freq: number,
  startFreq: number | null,
  vol: number,
  startTime: number,
  duration: number,
  type: OscillatorType = "sine"
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  if (startFreq != null) {
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq, startTime + duration * 0.6);
  } else {
    osc.frequency.setValueAtTime(freq, startTime);
  }
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(vol, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

/** Soft digital "lock-in" — pick submitted */
export async function playPickSound() {
  const ac = await getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  sine(ac, 280, 560, 0.22, t, 0.18);
  sine(ac, 420, 840, 0.08, t, 0.14);
}

/** Rising double-ping — you're now on the clock */
export async function playOnClockSound() {
  const ac = await getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  sine(ac, 540, null, 0.18, t, 0.22);
  sine(ac, 810, null, 0.22, t + 0.13, 0.28);
}

/** Ascending 4-note arpeggio — draft started */
export async function playDraftStartSound() {
  const ac = await getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const notes = [261, 330, 392, 523];
  notes.forEach((freq, i) => {
    sine(ac, freq, null, 0.2, t + i * 0.11, 0.3);
  });
}

/** Soft rising pop — manager joined */
export async function playJoinSound() {
  const ac = await getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  sine(ac, 520, 360, 0.12, t, 0.14);
}

/**
 * NFL-style brass fanfare — plays once when a manager opens the draft room.
 * Short triumphant 5-note motif with sawtooth (brass) timbre + harmonic layer.
 */
export async function playRoomOpenFanfare() {
  const ac = await getCtx();
  if (!ac) return;
  const t = ac.currentTime;

  // Main brass line: G4 → C5 → E5 → G5 → C6 (ascending triumphant)
  const melody: [number, number, number][] = [
    [392, 0.00, 0.14],  // G4
    [523, 0.12, 0.14],  // C5
    [659, 0.24, 0.14],  // E5
    [784, 0.36, 0.22],  // G5
    [1047, 0.52, 0.55], // C6 — held finish
  ];
  melody.forEach(([freq, offset, dur]) => {
    sine(ac, freq, null, 0.28, t + offset, dur, "sawtooth");
    // Octave-down harmonic for body
    sine(ac, freq / 2, null, 0.10, t + offset, dur, "sawtooth");
  });

  // Punchy kick-drum thump on the downbeat
  const kick = ac.createOscillator();
  const kickGain = ac.createGain();
  kick.connect(kickGain);
  kickGain.connect(ac.destination);
  kick.type = "sine";
  kick.frequency.setValueAtTime(160, t);
  kick.frequency.exponentialRampToValueAtTime(40, t + 0.08);
  kickGain.gain.setValueAtTime(0.5, t);
  kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  kick.start(t);
  kick.stop(t + 0.13);
}

/**
 * Call this from a click/touch handler (user gesture) to prime the AudioContext.
 * Must be triggered by real interaction — browsers block audio without it.
 */
export function unlockAudio() {
  getCtx().catch(() => {});
}
