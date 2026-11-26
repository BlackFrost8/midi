/**
 * Onset and tempo analysis, used to line a rendered audio file up with the MIDI
 * automatically.
 *
 * The approach is the standard one for this job: resample to mono, take a
 * spectral-flux onset envelope, find where the music actually starts, and
 * autocorrelate the envelope to estimate tempo. Everything runs offline on a
 * decoded buffer — nothing here touches playback.
 */

/** Analysis sample rate. Onsets live well below 5 kHz, so this is plenty. */
export const ANALYSIS_RATE = 11025;
const FRAME_SIZE = 1024;
const HOP_SIZE = 256;

/** Plausible musical tempo range for the autocorrelation search. */
const MIN_BPM = 50;
const MAX_BPM = 210;

export interface AudioAnalysis {
  /** Seconds from the start of the file to the first musical onset. */
  firstOnset: number;
  /** Best tempo estimate in BPM, before octave disambiguation. */
  rawBpm: number;
  /** 0-1. Low values mean the tempo estimate should not be trusted. */
  tempoConfidence: number;
  /** Onset times in seconds. */
  onsets: number[];
  duration: number;
  /** Downsampled peak envelope for drawing a waveform. */
  peaks: Float32Array;
}

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. Length must be a power of two.
 * The twiddle tables are built once per analysis and passed in, since the
 * per-frame cost is what dominates here.
 */
export function fft(re: Float32Array, im: Float32Array, cos: Float32Array, sin: Float32Array): void {
  const n = re.length;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len;
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const twiddle = k * step;
        const wr = cos[twiddle];
        const wi = sin[twiddle];
        const a = i + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Mixes to mono and resamples to the analysis rate using the audio engine. */
export async function toMonoAnalysisRate(buffer: AudioBuffer): Promise<Float32Array> {
  const frames = Math.max(Math.ceil(buffer.duration * ANALYSIS_RATE), 1);
  const offline = new OfflineAudioContext(1, frames, ANALYSIS_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function analyzeAudio(
  buffer: AudioBuffer,
  onProgress?: (fraction: number) => void,
): Promise<AudioAnalysis> {
  const samples = await toMonoAnalysisRate(buffer);
  onProgress?.(0.2);

  const frameCount = Math.max(Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1, 1);
  const bins = FRAME_SIZE / 2;
  const secondsPerFrame = HOP_SIZE / ANALYSIS_RATE;

  const window = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
  }
  const cos = new Float32Array(FRAME_SIZE);
  const sin = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / FRAME_SIZE);
    sin[i] = Math.sin((-2 * Math.PI * i) / FRAME_SIZE);
  }

  const re = new Float32Array(FRAME_SIZE);
  const im = new Float32Array(FRAME_SIZE);
  const previous = new Float32Array(bins);
  const flux = new Float32Array(frameCount);
  const rms = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * HOP_SIZE;
    let energy = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const sample = samples[start + i] ?? 0;
      energy += sample * sample;
      re[i] = sample * window[i];
      im[i] = 0;
    }
    rms[frame] = Math.sqrt(energy / FRAME_SIZE);

    fft(re, im, cos, sin);

    // Spectral flux: total rise in magnitude since the previous frame. Only
    // increases count, so a sustained tone contributes nothing and an attack
    // contributes a lot.
    let sum = 0;
    for (let k = 0; k < bins; k++) {
      const magnitude = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const rise = magnitude - previous[k];
      if (rise > 0) sum += rise;
      previous[k] = magnitude;
    }
    flux[frame] = sum;

    if (onProgress && frame % 512 === 0) onProgress(0.2 + 0.7 * (frame / frameCount));
  }

  const envelope = normalizeEnvelope(flux);
  const firstOnset = detectStart(samples, rms, envelope);
  const onsets = pickOnsets(samples, envelope, secondsPerFrame);
  const { bpm, confidence } = estimateTempo(envelope, secondsPerFrame);
  onProgress?.(1);

  return {
    firstOnset,
    rawBpm: bpm,
    tempoConfidence: confidence,
    onsets,
    duration: buffer.duration,
    peaks: buildPeaks(samples, 1400),
  };
}

/**
 * Subtracts a local moving average and half-wave rectifies, which removes slow
 * loudness drift so a quiet intro and a loud chorus are judged on equal terms.
 */
function normalizeEnvelope(flux: Float32Array): Float32Array {
  const n = flux.length;
  const out = new Float32Array(n);
  const window = 16;
  let peak = 0;

  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(n - 1, i + window); j++) {
      sum += flux[j];
      count++;
    }
    const value = flux[i] - sum / Math.max(count, 1);
    out[i] = value > 0 ? value : 0;
    if (out[i] > peak) peak = out[i];
  }

  if (peak > 0) {
    for (let i = 0; i < n; i++) out[i] /= peak;
  }
  return out;
}

/**
 * Converts a frame index to the true attack time in seconds.
 *
 * A frame's flux rises as soon as the attack enters its analysis window, which
 * puts the frame up to a full window early. Rather than applying a blanket
 * half-window correction — which would overshoot a sound that starts at zero —
 * this looks at the raw samples around the frame and finds where the waveform
 * actually departs from the noise floor.
 */
function refineOnset(samples: Float32Array, frame: number): number {
  const centre = frame * HOP_SIZE;
  const from = Math.max(0, centre - FRAME_SIZE);
  const to = Math.min(samples.length, centre + FRAME_SIZE * 2);
  if (to <= from) return centre / ANALYSIS_RATE;

  let peak = 0;
  for (let i = from; i < to; i++) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  if (peak <= 0) return centre / ANALYSIS_RATE;

  const threshold = peak * 0.2;
  for (let i = from; i < to; i++) {
    if (Math.abs(samples[i]) >= threshold) return i / ANALYSIS_RATE;
  }
  return centre / ANALYSIS_RATE;
}

/**
 * Where the music starts. Uses loudness rather than flux to find the region (a
 * fade-in has no sharp attack), then snaps to the strongest nearby onset.
 */
function detectStart(
  samples: Float32Array,
  rms: Float32Array,
  envelope: Float32Array,
): number {
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const threshold = floor + (loud - floor) * 0.08;

  // Require the level to hold, so a click or a blip of noise is not the start.
  const hold = 3;
  let startFrame = 0;
  for (let i = 0; i < rms.length - hold; i++) {
    let sustained = true;
    for (let j = 0; j < hold; j++) {
      if (rms[i + j] <= threshold) {
        sustained = false;
        break;
      }
    }
    if (sustained) {
      startFrame = i;
      break;
    }
  }

  // Snap to the biggest attack in the neighbourhood of that crossing.
  let best = startFrame;
  let bestValue = -1;
  for (let i = Math.max(0, startFrame - 8); i <= Math.min(envelope.length - 1, startFrame + 8); i++) {
    if (envelope[i] > bestValue) {
      bestValue = envelope[i];
      best = i;
    }
  }
  return refineOnset(samples, best);
}

/** Adaptive peak-picking over the onset envelope. */
function pickOnsets(
  samples: Float32Array,
  envelope: Float32Array,
  secondsPerFrame: number,
): number[] {
  const onsets: number[] = [];
  const window = 10;
  // Roughly 60 ms, so a fast roll is not smeared into a single onset.
  const minGapFrames = Math.ceil(0.06 / secondsPerFrame);
  let lastOnset = -Infinity;

  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] <= envelope[i - 1] || envelope[i] < envelope[i + 1]) continue;

    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(envelope.length - 1, i + window); j++) {
      sum += envelope[j];
      count++;
    }
    const local = sum / Math.max(count, 1);
    if (envelope[i] < local * 2.2 + 0.03) continue;
    if (i - lastOnset < minGapFrames) continue;

    lastOnset = i;
    onsets.push(refineOnset(samples, i));
    if (onsets.length > 20000) break;
  }
  return onsets;
}

/**
 * Autocorrelates the onset envelope and picks the strongest periodicity in the
 * musical range. A log-normal prior around 120 BPM discourages the usual
 * half/double-time confusion; the caller resolves any remaining octave error
 * against the known MIDI tempo.
 */
function estimateTempo(
  envelope: Float32Array,
  secondsPerFrame: number,
): { bpm: number; confidence: number } {
  const minLag = Math.max(1, Math.round(60 / MAX_BPM / secondsPerFrame));
  const maxLag = Math.min(envelope.length - 1, Math.round(60 / MIN_BPM / secondsPerFrame));
  if (maxLag <= minLag) return { bpm: 120, confidence: 0 };

  const scores = new Float64Array(maxLag + 1);
  let best = minLag;
  let bestScore = -Infinity;
  let total = 0;
  let count = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < envelope.length; i++) sum += envelope[i] * envelope[i - lag];
    const normalized = sum / (envelope.length - lag);

    const bpm = 60 / (lag * secondsPerFrame);
    // Gaussian in log-tempo, centred on 120 BPM.
    const prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / 120) / 0.55, 2));
    const score = normalized * prior;

    scores[lag] = score;
    total += score;
    count++;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }

  // Sub-bin refinement. At 140 BPM the period spans about 18.5 frames, so
  // whole-lag resolution alone is ~2.5% out — several seconds of drift across
  // a track. Fitting a parabola through the peak and its neighbours recovers
  // the fractional lag.
  let refinedLag = best;
  if (best > minLag && best < maxLag) {
    const left = scores[best - 1];
    const centre = scores[best];
    const right = scores[best + 1];
    const denominator = left - 2 * centre + right;
    if (denominator !== 0) {
      const shift = (0.5 * (left - right)) / denominator;
      if (Math.abs(shift) <= 1) refinedLag = best + shift;
    }
  }

  const mean = total / Math.max(count, 1);
  // How far the winner stands above the average lag. A flat curve means the
  // material has no clear pulse and the estimate should not be trusted.
  const confidence = mean > 0 ? Math.max(0, Math.min(1, (bestScore / mean - 1) / 2)) : 0;
  return { bpm: 60 / (refinedLag * secondsPerFrame), confidence };
}

/** Peak envelope for the waveform strip. */
function buildPeaks(samples: Float32Array, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(samples.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const start = b * size;
    const end = Math.min(start + size, samples.length);
    for (let i = start; i < end; i++) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }
    peaks[b] = peak;
  }
  return peaks;
}
