/**
 * Lines a recording up with the MIDI it was made from by matching note
 * attacks, across the whole song.
 *
 * Every note the MIDI says should start is compared against the attacks
 * actually heard in the audio. The result is the straight-line mapping
 *
 *     audio seconds = offset + midi seconds / tempoScale
 *
 * that makes the two agree best. Fitting both terms from hundreds of notes
 * spread over the song is what keeps the end as tight as the start: a tempo
 * estimate from the pulse alone is easily a few percent out (or locked onto
 * half or double time), and lining up only the first note fixes the start
 * while letting every later bar slide.
 *
 * Steps:
 *  1. An onset envelope for the audio — how much new sound arrives in each
 *     ~12 ms slice — from log-magnitude spectral flux.
 *  2. A coarse global search over speed (0.5×–2×) and offset, cross-correlating
 *     the MIDI's note train against that envelope with FFTs.
 *  3. Refinement with checkpoints every few seconds across the song. Each finds
 *     its local timing near the current fit, then a robust line through all of
 *     them gives the final speed and offset. The fit grows outward from where
 *     the coarse match was made, so it never jumps to a neighbouring beat.
 */
import type { InstrumentFamily, MidiProject } from '../models/MidiProject';
import { ANALYSIS_RATE, fft, toMonoAnalysisRate } from './AudioAnalyzer';

const FRAME = 512;
const HOP = 128;
/** Envelope frames per second (~86, so ~11.6 ms apart). */
const FPS = ANALYSIS_RATE / HOP;
/** A frame is timed at the centre of its analysis window. */
const FRAME_CENTRE = FRAME / 2 / ANALYSIS_RATE;
/** Decimation of the envelope for the global search. */
const COARSE = 4;

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
/** Coarse speed step: 0.2%, fine enough that a 30 s window stays aligned. */
const SCALE_STEP = 1.002;
/** Length of MIDI used for the coarse search. */
const SEARCH_WINDOW = 30;
/** Length of each refinement checkpoint, in MIDI seconds. */
const CHECKPOINT = 4;

/** A note start, in MIDI seconds at the file's own tempo, with how audible its attack is. */
export interface SyncNote {
  seconds: number;
  weight: number;
}

export interface SyncFit {
  /** Audio seconds at MIDI time zero. */
  offset: number;
  /** Multiply the MIDI tempo by this to match the recording. */
  tempoScale: number;
  /** Checkpoints that agreed with the final line. */
  checkpoints: number;
  /** Checkpoints that had enough notes to measure. */
  totalCheckpoints: number;
  /** Typical disagreement between a checkpoint and the line, in milliseconds. */
  residualMs: number;
  /** 0–1. How much of the song the fit actually explains. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Audio onset envelope
// ---------------------------------------------------------------------------

/**
 * Log-magnitude spectral flux. Log compression lets a quiet pluck register
 * next to a loud drum, and only rising energy counts, so held notes and pads
 * contribute nothing between their attacks.
 */
export function onsetEnvelope(samples: Float32Array): Float32Array {
  const frames = Math.max(Math.floor((samples.length - FRAME) / HOP) + 1, 1);
  const bins = FRAME / 2;

  const window = new Float32Array(FRAME);
  const cos = new Float32Array(FRAME);
  const sin = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
    cos[i] = Math.cos((-2 * Math.PI * i) / FRAME);
    sin[i] = Math.sin((-2 * Math.PI * i) / FRAME);
  }

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const previous = new Float32Array(bins);
  const flux = new Float32Array(frames);

  for (let frame = 0; frame < frames; frame++) {
    const start = frame * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = (samples[start + i] ?? 0) * window[i];
      im[i] = 0;
    }
    fft(re, im, cos, sin);

    let sum = 0;
    for (let k = 1; k < bins; k++) {
      const magnitude = Math.log1p(Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      const rise = magnitude - previous[k];
      if (rise > 0) sum += rise;
      previous[k] = magnitude;
    }
    flux[frame] = sum;
  }

  // Subtract the local average so only attacks that stand out from their
  // surroundings remain, then scale so the strongest attacks sit near 1.
  const out = new Float32Array(frames);
  const radius = 9;
  let running = 0;
  let count = 0;
  for (let i = 0; i < Math.min(radius, frames); i++) {
    running += flux[i];
    count++;
  }
  for (let i = 0; i < frames; i++) {
    const add = i + radius;
    const drop = i - radius - 1;
    if (add < frames) {
      running += flux[add];
      count++;
    }
    if (drop >= 0) {
      running -= flux[drop];
      count--;
    }
    const value = flux[i] - running / Math.max(count, 1);
    out[i] = value > 0 ? value : 0;
  }

  const scale = percentile(out, 0.995);
  if (scale > 0) {
    for (let i = 0; i < frames; i++) out[i] = Math.min(out[i] / scale, 1.5);
  }
  return out;
}

function percentile(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

/** Envelope value at a time in seconds, linearly interpolated. */
function envelopeAt(envelope: Float32Array, seconds: number): number {
  const position = (seconds - FRAME_CENTRE) * FPS;
  if (position < 0 || position >= envelope.length - 1) return 0;
  const index = Math.floor(position);
  const frac = position - index;
  return envelope[index] * (1 - frac) + envelope[index + 1] * frac;
}

// ---------------------------------------------------------------------------
// Coarse global search
// ---------------------------------------------------------------------------

interface Candidate {
  scale: number;
  offset: number;
  strength: number;
}

class Correlator {
  readonly size: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly audioRe: Float32Array;
  private readonly audioIm: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(audio: Float32Array, maxTrainLength: number) {
    let size = 1;
    while (size < audio.length + maxTrainLength) size <<= 1;
    this.size = size;
    this.cos = new Float32Array(size);
    this.sin = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.audioRe = new Float32Array(size);
    this.audioIm = new Float32Array(size);
    this.audioRe.set(audio);
    fft(this.audioRe, this.audioIm, this.cos, this.sin);
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /**
   * Cross-correlation of the audio with a note train. Index ℓ (or size + ℓ
   * for negative ℓ) holds Σ train[j] · audio[j + ℓ].
   */
  correlate(train: Float32Array): Float32Array {
    const { re, im, size } = this;
    re.fill(0);
    im.fill(0);
    re.set(train.subarray(0, Math.min(train.length, size)));
    fft(re, im, this.cos, this.sin);
    // audio · conj(train), conjugated again so a forward FFT acts as the inverse.
    for (let k = 0; k < size; k++) {
      const ar = this.audioRe[k];
      const ai = this.audioIm[k];
      const tr = re[k];
      const ti = im[k];
      re[k] = ar * tr + ai * ti;
      im[k] = -(ai * tr - ar * ti);
    }
    fft(re, im, this.cos, this.sin);
    for (let k = 0; k < size; k++) re[k] /= size;
    return re;
  }
}

/** Note starts splatted onto a frame grid, saturating so a big chord counts as one strong attack. */
function noteTrain(notes: SyncNote[], scale: number, origin: number, rate: number, length: number): Float32Array {
  const train = new Float32Array(length);
  for (const note of notes) {
    const position = ((note.seconds - origin) / scale) * rate;
    const index = Math.floor(position);
    if (index < 0 || index + 1 >= length) continue;
    const frac = position - index;
    train[index] += note.weight * (1 - frac);
    train[index + 1] += note.weight * frac;
  }
  for (let i = 0; i < length; i++) train[i] = 1 - Math.exp(-train[i]);
  return train;
}

/** The stretch of MIDI with the most attack weight, which anchors the coarse search best. */
function busiestWindow(notes: SyncNote[], length: number): [number, number] {
  if (!notes.length) return [0, length];
  const last = notes[notes.length - 1].seconds;
  if (last <= length) return [0, Math.max(last, 1)];
  let best = 0;
  let bestStart = 0;
  let sum = 0;
  let tail = 0;
  for (let head = 0; head < notes.length; head++) {
    sum += notes[head].weight;
    while (notes[head].seconds - notes[tail].seconds > length) sum -= notes[tail++].weight;
    if (sum > best) {
      best = sum;
      bestStart = notes[tail].seconds;
    }
  }
  return [bestStart, bestStart + length];
}

async function coarseSearch(
  envelope: Float32Array,
  notes: SyncNote[],
  onProgress?: (fraction: number) => void,
): Promise<Candidate[]> {
  // Max-pool to the coarse grid so a slightly-off speed still overlaps.
  const length = Math.ceil(envelope.length / COARSE);
  const coarse = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let peak = 0;
    for (let j = i * COARSE; j < Math.min((i + 1) * COARSE, envelope.length); j++) peak = Math.max(peak, envelope[j]);
    coarse[i] = peak;
  }
  const rate = FPS / COARSE;
  const firstTime = (COARSE - 1) / 2 / FPS + FRAME_CENTRE;

  const [from, to] = busiestWindow(notes, SEARCH_WINDOW);
  const windowNotes = notes.filter((note) => note.seconds >= from && note.seconds <= to);
  const maxTrain = Math.ceil(((to - from) / MIN_SCALE) * rate) + 4;
  const correlator = new Correlator(coarse, maxTrain);

  const scales: number[] = [];
  for (let s = MIN_SCALE; s <= MAX_SCALE * 1.0001; s *= SCALE_STEP) scales.push(s);

  const results: Candidate[] = [];
  for (let i = 0; i < scales.length; i++) {
    const scale = scales[i];
    const trainLength = Math.ceil(((to - from) / scale) * rate) + 4;
    const train = noteTrain(windowNotes, scale, from, rate, trainLength);
    const c = correlator.correlate(train);

    // Score the best lag against the spread of all lags: how far the right
    // alignment stands above chance, which is comparable across speeds.
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    let best = -Infinity;
    let bestLag = 0;
    const minLag = -(trainLength - 1);
    const maxLag = coarse.length - 1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const value = c[lag >= 0 ? lag : correlator.size + lag];
      sum += value;
      sumSq += value * value;
      n++;
      if (value > best) {
        best = value;
        bestLag = lag;
      }
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(sumSq / n - mean * mean, 1e-12));
    // The window's first note at `from` lands at this audio time.
    const offset = bestLag / rate + firstTime - from / scale;
    results.push({ scale, offset, strength: (best - mean) / std });

    if (i % 24 === 0) {
      onProgress?.(i / scales.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Keep a few distinct peaks: refinement decides between them.
  results.sort((a, b) => b.strength - a.strength);
  const picked: Candidate[] = [];
  for (const candidate of results) {
    const distinct = picked.every(
      (p) => Math.abs(Math.log(p.scale / candidate.scale)) > 0.01 || Math.abs(p.offset - candidate.offset) > 0.08,
    );
    if (distinct) picked.push(candidate);
    if (picked.length >= 4) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Refinement
// ---------------------------------------------------------------------------

interface Anchor {
  /** Weighted centre of the checkpoint, MIDI seconds. */
  x: number;
  /** Where that moment is heard, audio seconds. */
  y: number;
  weight: number;
}

interface Line {
  offset: number;
  slope: number;
}

/** Splits note starts into checkpoint windows of roughly equal length. */
function checkpoints(notes: SyncNote[]): SyncNote[][] {
  const groups: SyncNote[][] = [];
  let current: SyncNote[] = [];
  let start = notes[0]?.seconds ?? 0;
  for (const note of notes) {
    if (note.seconds - start >= CHECKPOINT && current.length) {
      groups.push(current);
      current = [];
      start = note.seconds;
    }
    current.push(note);
  }
  if (current.length) groups.push(current);
  return groups.filter((group) => group.length >= 3);
}

/** Best local shift for one checkpoint near the current line. */
function measure(envelope: Float32Array, group: SyncNote[], line: Line, radius: number): Anchor | null {
  const step = 1 / FPS / 2;
  const steps = Math.ceil(radius / step);
  const scores = new Float64Array(steps * 2 + 1);
  for (let k = -steps; k <= steps; k++) {
    const shift = k * step;
    let score = 0;
    for (const note of group) score += note.weight * envelopeAt(envelope, line.offset + note.seconds * line.slope + shift);
    scores[k + steps] = score;
  }

  let bestIndex = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIndex]) bestIndex = i;
  const peak = scores[bestIndex];
  const median = Float64Array.from(scores).sort()[Math.floor(scores.length / 2)];
  // A peak no better than the typical shift means this stretch has no clear
  // attacks to lock onto (a held pad, a silence): leave it out.
  if (peak <= 0 || peak - median < 0.15 * peak) return null;

  let refined = bestIndex;
  if (bestIndex > 0 && bestIndex < scores.length - 1) {
    const left = scores[bestIndex - 1];
    const right = scores[bestIndex + 1];
    const denominator = left - 2 * peak + right;
    if (denominator < 0) refined = bestIndex + (0.5 * (left - right)) / denominator;
  }
  const shift = (refined - steps) * step;

  let weightSum = 0;
  let x = 0;
  for (const note of group) {
    weightSum += note.weight;
    x += note.seconds * note.weight;
  }
  x /= weightSum;
  return { x, y: line.offset + x * line.slope + shift, weight: peak - median };
}

/** Weighted least squares with outlier rejection. Returns the line and the anchors it kept. */
function robustFit(anchors: Anchor[], fixedSlope?: number): { line: Line; kept: Anchor[]; rms: number } | null {
  let kept = anchors.filter((anchor) => anchor.weight > 0);
  let line: Line | null = null;

  for (let iteration = 0; iteration < 4 && kept.length >= 2; iteration++) {
    let w = 0;
    let wx = 0;
    let wy = 0;
    for (const a of kept) {
      w += a.weight;
      wx += a.weight * a.x;
      wy += a.weight * a.y;
    }
    const mx = wx / w;
    const my = wy / w;
    let slope = fixedSlope;
    if (slope === undefined) {
      let sxx = 0;
      let sxy = 0;
      for (const a of kept) {
        sxx += a.weight * (a.x - mx) * (a.x - mx);
        sxy += a.weight * (a.x - mx) * (a.y - my);
      }
      if (sxx <= 1e-9) return null;
      slope = sxy / sxx;
    }
    line = { slope, offset: my - slope * mx };

    const residuals = kept.map((a) => Math.abs(a.y - (line!.offset + line!.slope * a.x)));
    const sorted = [...residuals].sort((a, b) => a - b);
    const mad = sorted[Math.floor(sorted.length / 2)] * 1.4826;
    const limit = Math.max(3 * mad, 0.02);
    const next = kept.filter((_, i) => residuals[i] <= limit);
    if (next.length === kept.length) break;
    kept = next;
  }
  if (!line || kept.length < 2) return null;

  let w = 0;
  let sq = 0;
  for (const a of kept) {
    const r = a.y - (line.offset + line.slope * a.x);
    w += a.weight;
    sq += a.weight * r * r;
  }
  return { line, kept, rms: Math.sqrt(sq / Math.max(w, 1e-9)) };
}

/** How well a line explains the notes: average envelope value at the predicted attacks. */
function matchScore(envelope: Float32Array, notes: SyncNote[], line: Line): number {
  let score = 0;
  let total = 0;
  for (const note of notes) {
    score += note.weight * envelopeAt(envelope, line.offset + note.seconds * line.slope);
    total += note.weight;
  }
  return total > 0 ? score / total : 0;
}

interface Refined {
  line: Line;
  kept: number;
  total: number;
  rms: number;
  score: number;
}

function refine(envelope: Float32Array, notes: SyncNote[], groups: SyncNote[][], start: Candidate): Refined | null {
  let line: Line = { offset: start.offset, slope: 1 / start.scale };
  const [from, to] = busiestWindow(notes, SEARCH_WINDOW);
  let lo = from;
  let hi = to;
  const first = notes[0].seconds;
  const last = notes[notes.length - 1].seconds;

  // Grow outward from the stretch the coarse search matched, refitting as it
  // goes, so the line is always accurate where the next checkpoints are measured.
  for (let pass = 0; pass < 12; pass++) {
    const anchors = groups
      .filter((group) => group[group.length - 1].seconds >= lo && group[0].seconds <= hi)
      .map((group) => measure(envelope, group, line, 0.1))
      .filter((anchor): anchor is Anchor => anchor !== null);
    const fit = robustFit(anchors);
    if (fit) line = fit.line;
    if (lo <= first && hi >= last) break;
    const span = Math.max(hi - lo, CHECKPOINT);
    lo -= span;
    hi += span;
  }

  // Final pass over the whole song with a tight search radius.
  const anchors = groups
    .map((group) => measure(envelope, group, line, 0.06))
    .filter((anchor): anchor is Anchor => anchor !== null);
  const fit = robustFit(anchors);
  if (!fit) return null;
  return {
    line: fit.line,
    kept: fit.kept.length,
    total: groups.length,
    rms: fit.rms,
    score: matchScore(envelope, notes, fit.line),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * How clearly an instrument's notes show up as attacks in a mix. Struck and
 * plucked sounds start sharply; bowed strings, choirs and pads swell in and
 * barely register, so they get a small say in the alignment.
 */
const ATTACK: Record<InstrumentFamily, number> = {
  drums: 1,
  percussion: 1,
  piano: 1,
  guitar: 0.9,
  arpeggio: 0.9,
  bass: 0.75,
  synth: 0.7,
  brass: 0.5,
  woodwinds: 0.45,
  organ: 0.45,
  strings: 0.35,
  violin: 0.35,
  viola: 0.35,
  cello: 0.35,
  choir: 0.25,
  voice: 0.3,
  pad: 0.15,
  unknown: 0.6,
};

/** Every note start in the project, weighted by how audible its attack is. */
export function syncNotesFromProject(project: MidiProject): SyncNote[] {
  const notes: SyncNote[] = [];
  for (const track of project.tracks) {
    const attack = ATTACK[track.family] ?? 0.6;
    for (const note of track.notes) {
      notes.push({ seconds: note.startSeconds, weight: attack * (0.4 + 0.6 * note.velocity) });
    }
  }
  return notes;
}

/**
 * Collapses attacks closer together than an envelope frame into one, so a
 * ten-note chord is one strong event rather than ten votes for the same frame.
 */
export function mergeNotes(notes: SyncNote[]): SyncNote[] {
  const sorted = [...notes].filter((n) => n.weight > 0).sort((a, b) => a.seconds - b.seconds);
  const merged: SyncNote[] = [];
  let group: SyncNote[] = [];
  const flush = () => {
    if (!group.length) return;
    const total = group.reduce((sum, n) => sum + n.weight, 0);
    const seconds = group.reduce((sum, n) => sum + n.seconds * n.weight, 0) / total;
    merged.push({ seconds, weight: 1 - Math.exp(-total) });
    group = [];
  };
  for (const note of sorted) {
    if (group.length && note.seconds - group[0].seconds > 0.015) flush();
    group.push(note);
  }
  flush();
  return merged;
}

export async function solveSync(
  buffer: AudioBuffer,
  rawNotes: SyncNote[],
  onProgress?: (fraction: number) => void,
): Promise<SyncFit | null> {
  const notes = mergeNotes(rawNotes);
  if (notes.length < 4) return null;

  const samples = await toMonoAnalysisRate(buffer);
  onProgress?.(0.1);
  const envelope = onsetEnvelope(samples);
  onProgress?.(0.25);

  const candidates = await coarseSearch(envelope, notes, (f) => onProgress?.(0.25 + f * 0.6));
  const groups = checkpoints(notes);
  if (!groups.length) return null;

  let best: Refined | null = null;
  for (const candidate of candidates) {
    const refined = refine(envelope, notes, groups, candidate);
    if (refined && (!best || refined.score > best.score)) best = refined;
  }
  onProgress?.(0.95);
  if (!best) return null;

  let { line } = best;
  let rms = best.rms;
  let kept = best.kept;

  // A speed this close to 1 would shift the last note by less than a few
  // milliseconds — the recording came from this MIDI at its own tempo, and
  // the difference is measurement noise. Hold the tempo exactly and refit
  // the offset alone.
  const duration = notes[notes.length - 1].seconds - notes[0].seconds;
  if (Math.abs(line.slope - 1) * duration < 0.008) {
    const anchors = groups
      .map((group) => measure(envelope, group, { offset: line.offset, slope: 1 }, 0.06))
      .filter((anchor): anchor is Anchor => anchor !== null);
    const fixed = robustFit(anchors, 1);
    if (fixed) {
      line = fixed.line;
      rms = fixed.rms;
      kept = fixed.kept.length;
    } else {
      line = { offset: line.offset, slope: 1 };
    }
  }

  const coverage = kept / Math.max(best.total, 1);
  const tightness = Math.max(0, Math.min(1, 1 - rms / 0.04));
  onProgress?.(1);
  return {
    offset: line.offset,
    tempoScale: 1 / line.slope,
    checkpoints: kept,
    totalCheckpoints: best.total,
    residualMs: rms * 1000,
    confidence: coverage * tightness,
  };
}
