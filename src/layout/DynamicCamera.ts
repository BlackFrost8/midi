import type { MidiProject, VisualTrack } from '../models/MidiProject';

/**
 * Dynamic camera: only the tracks that are playing are in frame. Each lane has
 * a presence from 0 to 1; the layout gives lanes height in proportion to it
 * and fades them by it, so the playing lanes fill the frame, lanes that stop
 * shrink and fade away (even between two that keep playing), and a lane about
 * to play fades and grows back in ahead of its first note.
 *
 * The presences are worked out once per song as curves over time, so the
 * preview and every export move identically, frame for frame:
 *
 *  1. a lane counts as playing from LEAD seconds before its notes to HOLD
 *     seconds after, so entrances are anticipated and rests do not twitch;
 *  2. silences (nothing playing anywhere) keep the last set of lanes;
 *  3. each lane's on/off curve is smoothed forwards and backwards in time and
 *     eased, so every move glides in and out.
 */

const RATE = 20; // samples per second

/** How the camera moves: Glide eases in and out, Snap cuts in quickly and settles, Drift is slow and even. */
export type CameraMotion = 'glide' | 'snap' | 'drift';

/**
 * A stretch of the song where you decide what the camera shows, overriding
 * what is playing: Focus shows only these tracks, Include adds them to
 * whatever is playing, Hide keeps them out.
 */
export interface CameraKey {
  id: string;
  /** Seconds. The camera has finished moving by here. */
  start: number;
  end: number;
  trackIds: string[];
  mode: 'focus' | 'include' | 'hide';
}

export interface CameraParams {
  /** 0 slow … 1 fast. */
  speed: number;
  motion: CameraMotion;
  keys?: CameraKey[];
}

function timing(params: CameraParams) {
  const speed = Math.min(1, Math.max(0, params.speed));
  // Slower moves take longer and so start earlier, to land on the entrance.
  const smooth = 1.1 - 0.8 * speed; // seconds, gaussian sigma
  const motion = params.motion;
  return {
    smooth: motion === 'snap' ? smooth * 0.55 : motion === 'drift' ? smooth * 1.35 : smooth,
    lead: (motion === 'snap' ? 0.9 : 1.1) + smooth * 1.1,
    hold: motion === 'drift' ? 3.2 : 2.2,
  };
}

interface Curves {
  /** Presence per lane, frame-major: weights[frame * lanes + lane]. */
  weights: Float32Array;
  frames: number;
  lanes: number;
}

const cache = new WeakMap<MidiProject, Map<string, Curves>>();

/** Presence (0–1) of each lane at a moment, for these lanes in this order. */
export function laneWeights(
  project: MidiProject,
  lanes: VisualTrack[],
  silent: Set<string>,
  seconds: number,
  params: CameraParams = { speed: 0.6, motion: 'glide' },
): Float32Array {
  const n = lanes.length;
  const key =
    `${params.speed.toFixed(2)}:${params.motion}:${JSON.stringify(params.keys ?? [])}:` +
    lanes.map((track) => (silent.has(track.id) ? `-${track.id}` : track.id)).join('|');
  let byKey = cache.get(project);
  if (!byKey) {
    byKey = new Map();
    cache.set(project, byKey);
  }
  let curves = byKey.get(key);
  if (!curves) {
    if (byKey.size > 16) byKey.clear();
    curves = build(project, lanes, silent, params);
    byKey.set(key, curves);
  }
  const f = Math.max(0, seconds * RATE);
  const i = Math.min(curves.frames - 1, Math.floor(f));
  const j = Math.min(curves.frames - 1, i + 1);
  const t = Math.min(1, f - i);
  const out = new Float32Array(n);
  for (let l = 0; l < n; l++) {
    const a = curves.weights[i * n + l];
    const b = curves.weights[j * n + l];
    out[l] = a + (b - a) * t;
  }
  return out;
}

function build(project: MidiProject, lanes: VisualTrack[], silent: Set<string>, params: CameraParams): Curves {
  const { smooth: SMOOTH, lead: LEAD, hold: HOLD } = timing(params);
  const n = lanes.length;
  const frames = Math.ceil((project.durationSeconds + HOLD + 1) * RATE) + 1;
  const on = new Uint8Array(frames * n);
  lanes.forEach((track, l) => {
    if (silent.has(track.id)) return;
    for (const note of track.notes) {
      const a = Math.max(0, Math.floor((note.startSeconds - LEAD) * RATE));
      const b = Math.min(frames - 1, Math.ceil((note.startSeconds + note.durationSeconds + HOLD) * RATE));
      for (let f = a; f <= b; f++) on[f * n + l] = 1;
    }
  });

  groupChanges(on, frames, n, Math.round((1.2 + SMOOTH * 2) * RATE));

  // A frame where nothing plays keeps the lanes of the last frame that had any
  // (or of the first, before the music starts).
  const any = (f: number) => {
    for (let l = 0; l < n; l++) if (on[f * n + l]) return true;
    return false;
  };
  let last = -1;
  let first = -1;
  for (let f = 0; f < frames; f++) {
    if (any(f)) {
      last = f;
      if (first < 0) first = f;
    } else if (last >= 0) {
      on.copyWithin(f * n, last * n, last * n + n);
    }
  }
  if (first < 0) on.fill(1);
  else for (let f = 0; f < first; f++) on.copyWithin(f * n, first * n, first * n + n);

  // Your keyframes win over what is playing. Each starts a little early, so
  // the move has settled by the time you set.
  const index = new Map(lanes.map((track, l) => [track.id, l]));
  for (const camera of params.keys ?? []) {
    const lanesIn = camera.trackIds.map((id) => index.get(id)).filter((l): l is number => l !== undefined);
    if (!lanesIn.length && camera.mode !== 'focus') continue;
    const a = Math.max(0, Math.floor((camera.start - SMOOTH * 1.6) * RATE));
    const b = Math.min(frames - 1, Math.ceil(camera.end * RATE));
    const chosen = new Uint8Array(n);
    for (const l of lanesIn) chosen[l] = 1;
    for (let f = a; f <= b; f++) {
      for (let l = 0; l < n; l++) {
        if (camera.mode === 'focus') on[f * n + l] = chosen[l];
        else if (chosen[l]) on[f * n + l] = camera.mode === 'include' ? 1 : 0;
      }
      // Never leave the frame empty.
      let any = false;
      for (let l = 0; l < n; l++) if (on[f * n + l]) any = true;
      if (!any) for (let l = 0; l < n; l++) on[f * n + l] = 1;
    }
  }

  // Smooth each lane's curve with a zero-phase gaussian, then ease it.
  const weights = new Float32Array(frames * n);
  const series = new Float32Array(frames);
  for (let l = 0; l < n; l++) {
    for (let f = 0; f < frames; f++) series[f] = on[f * n + l];
    const soft = gaussian(series, SMOOTH * RATE);
    for (let f = 0; f < frames; f++) {
      const x = Math.min(1, Math.max(0, soft[f]));
      // Glide: smoothstep. Snap: a steeper S that commits quickly. Drift: even.
      weights[f * n + l] =
        params.motion === 'drift' ? x : params.motion === 'snap' ? x * x * x * (x * (x * 6 - 15) + 10) : x * x * (3 - 2 * x);
    }
  }
  return { weights, frames, lanes: n };
}

function gaussian(values: Float32Array, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = w;
    total += w;
  }
  const out = new Float32Array(values.length);
  const last = values.length - 1;
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k < 0 ? 0 : i + k > last ? last : i + k;
      sum += values[j] * kernel[k + radius];
    }
    out[i] = sum / total;
  }
  return out;
}

/**
 * Entrances (and exits) that come close together become one move: each lane
 * in a group comes in with the earliest of them and leaves with the latest, so
 * the camera makes a single clean zoom instead of a stutter of small ones.
 * A group never stretches past one and a half windows, so a long run of staggered
 * entrances still opens up in steps rather than all at once.
 */
function groupChanges(on: Uint8Array, frames: number, n: number, window: number): void {
  const rises: Array<[number, number]> = [];
  const falls: Array<[number, number]> = [];
  for (let l = 0; l < n; l++) {
    for (let f = 1; f < frames; f++) {
      const was = on[(f - 1) * n + l];
      const is = on[f * n + l];
      if (!was && is) rises.push([f, l]);
      else if (was && !is) falls.push([f, l]);
    }
  }
  const clusters = (edges: Array<[number, number]>) => {
    edges.sort((a, b) => a[0] - b[0]);
    const groups: Array<Array<[number, number]>> = [];
    for (const edge of edges) {
      const group = groups[groups.length - 1];
      if (group && edge[0] - group[group.length - 1][0] <= window && edge[0] - group[0][0] <= window * 1.5) group.push(edge);
      else groups.push([edge]);
    }
    return groups;
  };
  for (const group of clusters(rises)) {
    const first = group[0][0];
    for (const [f, l] of group) for (let g = first; g < f; g++) on[g * n + l] = 1;
  }
  for (const group of clusters(falls)) {
    const last = group[group.length - 1][0];
    for (const [f, l] of group) for (let g = f; g < last && g < frames; g++) on[g * n + l] = 1;
  }
}
