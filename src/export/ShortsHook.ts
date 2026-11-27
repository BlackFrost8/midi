import type { MidiProject, TrackState } from '../models/MidiProject';

/** Shorts are vertical full HD. */
export const SHORTS_SIZE = { width: 1080, height: 1920 };

const BIN = 0.25;

/**
 * Where a Short of `length` seconds should start to hook a viewer: on the
 * downbeat where the song hits hardest. Each moment is scored by how much is
 * going on (onsets weighted by velocity, plus held notes), and a start is
 * favoured when the window is full, its first few seconds are fullest, and it
 * lands on a jump in energy (a drop, a chorus coming in). Muted and hidden
 * tracks don't count, so it follows what you hear.
 */
export function findHook(project: MidiProject, length: number, trackStates?: Map<string, TrackState>): number {
  const duration = project.durationSeconds;
  if (duration <= length + 0.5) return 0;
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
  const overall = Math.max(mean(0, duration), 1e-6);

  const downbeats = project.bars.filter((bar) => bar.isDownbeat).map((bar) => bar.seconds);
  const candidates = downbeats.length ? downbeats : Array.from({ length: Math.floor(duration) }, (_, i) => i);
  let best = 0;
  let bestScore = -Infinity;
  for (const start of candidates) {
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
