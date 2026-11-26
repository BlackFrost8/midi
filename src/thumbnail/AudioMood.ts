import { ANALYSIS_RATE, fft, toMonoAnalysisRate } from '../audio/AudioAnalyzer';
import { clamp } from '../utils/math';
import type { AudioMood } from './SongMood';

const FRAME = 1024;
const HOP = 256;
/** Short runs sampled across the song — plenty for averages, cheap on a long mix. */
const MAX_RUNS = 400;
/** Consecutive frames per run: ~190 ms, long enough to catch an attack. */
const RUN_FRAMES = 8;

/**
 * Loudness, brightness and punch of the loaded recording.
 *
 * Short runs of frames are spread evenly across the song rather than reading
 * it end to end: these are whole-song averages, so a few hundred windows say
 * as much as every one. Within a run the strongest frame-to-frame rise in the
 * spectrum is kept, so a run that contains a hit registers it even when most
 * of the run is the note dying away.
 */
export async function analyzeAudioMood(buffer: AudioBuffer): Promise<AudioMood> {
  const samples = await toMonoAnalysisRate(buffer);
  const usable = samples.length - FRAME - HOP * RUN_FRAMES;
  if (usable <= 0) return { loudness: 0.5, brightness: 0.5, punch: 0.5 };

  const count = Math.min(MAX_RUNS, Math.max(1, Math.floor(usable / (HOP * RUN_FRAMES))));
  const bins = FRAME / 2;
  const binHz = ANALYSIS_RATE / FRAME;

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
  const first = new Float32Array(bins);

  const rmsValues: number[] = [];
  const centroids: number[] = [];
  const fluxRatios: number[] = [];

  const spectrum = (start: number, into: Float32Array): number => {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const sample = samples[start + i] ?? 0;
      energy += sample * sample;
      re[i] = sample * window[i];
      im[i] = 0;
    }
    fft(re, im, cos, sin);
    for (let k = 0; k < bins; k++) into[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    return Math.sqrt(energy / FRAME);
  };

  let previous = first;
  let current = new Float32Array(bins);
  for (let run = 0; run < count; run++) {
    const start = Math.floor((run / count) * usable);
    const rms = spectrum(start, previous);
    // Skip silence: intros and tails would read as "quiet, dull".
    if (rms < 1e-3) continue;

    let magnitude = 0;
    let weighted = 0;
    for (let k = 1; k < bins; k++) {
      magnitude += previous[k];
      weighted += previous[k] * k * binHz;
    }
    rmsValues.push(rms);
    if (magnitude > 0) centroids.push(weighted / magnitude);

    let strongest = 0;
    for (let step = 1; step < RUN_FRAMES; step++) {
      spectrum(start + step * HOP, current);
      let rise = 0;
      let before = 0;
      for (let k = 1; k < bins; k++) {
        before += previous[k];
        const delta = current[k] - previous[k];
        if (delta > 0) rise += delta;
      }
      if (before > 0) strongest = Math.max(strongest, rise / before);
      [previous, current] = [current, previous];
    }
    fluxRatios.push(strongest);
  }

  if (!rmsValues.length) return { loudness: 0.2, brightness: 0.5, punch: 0.2 };

  const meanRms = rmsValues.reduce((sum, v) => sum + v, 0) / rmsValues.length;
  const db = 20 * Math.log10(Math.max(meanRms, 1e-6));
  centroids.sort((a, b) => a - b);
  const centroid = centroids[Math.floor(centroids.length / 2)] ?? 1200;
  // Log-compressed so one hit out of silence cannot outweigh a steady beat:
  // how often the music attacks matters as much as how hard.
  const punch =
    fluxRatios.length > 0 ? fluxRatios.reduce((sum, ratio) => sum + Math.log1p(ratio), 0) / fluxRatios.length : 0.1;

  return {
    loudness: clamp((db + 32) / 24, 0, 1),
    brightness: clamp((centroid - 450) / 1800, 0, 1),
    punch: clamp(punch / 1.1, 0, 1),
  };
}
