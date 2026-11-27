import type { MidiProject, TrackState } from '../models/MidiProject';

/** Shorts are vertical full HD. */
export const SHORTS_SIZE = { width: 1080, height: 1920 };

/** A pop-up text in a Short: `at` seconds into the Short. */
export interface ShortsCue {
  at: number;
  text: string;
}

const BIN = 0.25;

/** How much is going on, every quarter second: onsets weighted by velocity, plus held notes. Muted and hidden tracks don't count. */
function energyCurve(project: MidiProject, trackStates?: Map<string, TrackState>) {
  const duration = project.durationSeconds;
  const bins = Math.ceil(duration / BIN) + 1;
  const energy = new Float32Array(bins);
  const anySolo = trackStates ? [...trackStates.values()].some((state) => state.solo) : false;
  for (const track of project.tracks) {
    const state = trackStates?.get(track.id);
    if (state && (!state.visible || state.muted || (anySolo && !state.solo))) continue;
    for (const note of track.notes) {
      const start = Math.floor(note.startSeconds / BIN);
      if (start >= bins) continue;
      energy[start] += 0.4 + note.velocity;
      const end = Math.min(bins - 1, Math.floor((note.startSeconds + note.durationSeconds) / BIN));
      for (let b = start + 1; b <= end; b++) energy[b] += 0.12 * (0.5 + note.velocity);
    }
  }
  // Prefix sums, for any window's mean in constant time.
  const sum = new Float64Array(bins + 1);
  for (let b = 0; b < bins; b++) sum[b + 1] = sum[b] + energy[b];
  const mean = (from: number, to: number) => {
    const a = Math.max(0, Math.min(bins, Math.round(from / BIN)));
    const z = Math.max(0, Math.min(bins, Math.round(to / BIN)));
    return z > a ? (sum[z] - sum[a]) / (z - a) : 0;
  };
  const downbeats = project.bars.filter((bar) => bar.isDownbeat).map((bar) => bar.seconds);
  return { mean, duration, downbeats: downbeats.length ? downbeats : Array.from({ length: Math.floor(duration) }, (_, i) => i) };
}

/**
 * Where a Short of `length` seconds should start to hook a viewer: on the
 * downbeat where the song hits hardest. A start is favoured when the window
 * is full, its first few seconds are fullest, and it lands on a jump in
 * energy (a drop, a chorus coming in).
 */
export function findHook(project: MidiProject, length: number, trackStates?: Map<string, TrackState>): number {
  const { mean, duration, downbeats } = energyCurve(project, trackStates);
  if (duration <= length + 0.5) return 0;
  const overall = Math.max(mean(0, duration), 1e-6);
  let best = 0;
  let bestScore = -Infinity;
  for (const start of downbeats) {
    if (start + length > duration + 0.01) break;
    const whole = mean(start, start + length);
    const opening = mean(start, start + 4);
    const jump = Math.max(0, mean(start, start + 2) - mean(start - 2, start));
    const score = (whole + 0.8 * opening + 0.6 * jump) / overall;
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return best;
}

/**
 * Pop-up texts that keep a viewer watching, timed to the music: "Wait for
 * it…" in the build before the biggest jump in energy inside the Short, a
 * shout on the hit itself, nudges in long stretches without one, and a
 * replay prompt just before it loops. Times are seconds into the Short.
 */
export function suggestCues(project: MidiProject, start: number, length: number, trackStates?: Map<string, TrackState>): ShortsCue[] {
  const { mean, downbeats } = energyCurve(project, trackStates);
  const end = start + length;
  // Downbeats inside the Short, leaving room for a build before and text after.
  const jumps = downbeats
    .filter((t) => t > start + 4 && t < end - 3)
    .map((t) => ({ t, size: mean(t, t + 2) - mean(t - 2, t) }))
    .filter((jump) => jump.size > 0)
    .sort((a, b) => b.size - a.size);
  const cues: ShortsCue[] = [];
  const round = (t: number) => Math.round((t - start) * 2) / 2;
  const drop = jumps[0];
  if (drop) {
    cues.push({ at: round(Math.max(start + 1, drop.t - 3)), text: 'Wait for it…' });
    cues.push({ at: round(drop.t), text: 'HERE IT IS 🔥' });
  }
  // Something every ~9 seconds at most, so attention never drifts.
  const nudges = ['Keep watching 👀', 'It gets better…', 'Listen to this part 🎧', 'Not done yet…'];
  let n = 0;
  for (let t = 3; t < length - 8; t += 0.5) {
    const near = cues.some((cue) => Math.abs(cue.at - t) < 7);
    if (near) continue;
    cues.push({ at: t, text: nudges[n++ % nudges.length] });
  }
  if (length >= 12) cues.push({ at: Math.max(0, Math.round((length - 2.5) * 2) / 2), text: 'Replay it 🔁' });
  return cues.sort((a, b) => a.at - b.at);
}
