import { clamp } from '../utils/math';
import { NoiseField, mixSeed } from './Noise';

/**
 * The hand-made finish: the picture redrawn as if someone made it in
 * Microsoft Paint with a mouse.
 *
 *  - chunky pixels: the image is resampled in square cells with no smoothing,
 *    so every curve steps and every edge is hard;
 *  - mouse wobble: a slow warp plus a shakier tremor, so lines and outlines
 *    never run quite straight or round;
 *  - flat fills: colours are posterised a little, and soft alpha edges become
 *    hard cut-outs, the way the paint bucket and pencil leave them;
 *  - splotches: blotchy lighter and darker patches with hard edges, their
 *    borders broken up into spray-can speckle.
 *
 * It is the Pixel filter; `cellScale` makes the pixels chunkier. Everything is
 * measured against a 720-pixel-tall frame, so the preview and a 4K export
 * carry the same marks in the same places.
 */
export function applyHandmade(canvas: HTMLCanvasElement, seed: number, amount: number, cellScale = 1): void {
  if (amount <= 0.001) return;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 2 || H < 2) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const k = H / 720;
  const a = clamp(amount, 0, 1);
  const noise = new NoiseField(mixSeed(seed, 0x4a4d));

  // Smooth fields on coarse grids, sampled bilinearly: far cheaper than
  // evaluating noise for every pixel of a 4K frame.
  const wobble = fieldGrid(40, 23, W, H, (u, v) => [noise.fbm(u * 1.3 + 3.1, v * 1.3, 3) - 0.5, noise.fbm(u * 1.3 - 7.7, v * 1.3 + 5.3, 3) - 0.5]);
  const tremor = fieldGrid(140, 79, W, H, (u, v) => [noise.value(u * 9 + 1.3, v * 9) - 0.5, noise.value(u * 9 - 4.1, v * 9 + 2.6) - 0.5]);
  // Two sizes of splotch: broad patches and smaller dabs inside them.
  const splotch = fieldGrid(96, 54, W, H, (u, v) => [noise.fbm(u * 2.4 + 11, v * 2.4 - 2, 3) - 0.5, noise.fbm(u * 6 - 5, v * 6 + 9, 2) - 0.5]);

  const cell = Math.max(1, Math.round(k * (1 + 2.2 * a) * cellScale));
  const wobblePx = 11 * k * a;
  const tremorPx = 3.2 * k * a;
  const splotchGain = 0.16 * a;
  const hardness = clamp(a * 1.8, 0, 1);
  const levels = Math.round(48 - 34 * a);
  const step = 255 / (levels - 1);
  const salt = mixSeed(seed, 0x6a1) | 0;

  const src = ctx.getImageData(0, 0, W, H).data;
  const out = ctx.createImageData(W, H);
  const dst = out.data;
  const sample = { x: 0, y: 0 };
  const colour = [0, 0, 0, 0];

  for (let by = 0; by < H; by += cell) {
    for (let bx = 0; bx < W; bx += cell) {
      // One colour per cell, worked out at its centre.
      const cx = Math.min(W - 1, bx + (cell >> 1));
      const cy = Math.min(H - 1, by + (cell >> 1));
      wobble.at(cx, cy, sample);
      let dx = sample.x * wobblePx;
      let dy = sample.y * wobblePx;
      tremor.at(cx, cy, sample);
      dx += sample.x * tremorPx;
      dy += sample.y * tremorPx;
      const i = index(cx + dx, cy + dy, W, H);

      // Splotches: a hard step up or down past a threshold, with the edge of
      // each patch sprayed rather than cut.
      splotch.at(cx, cy, sample);
      const spray = hash((bx / cell) | 0, (by / cell) | 0, salt);
      const level = patch(sample.x, 0.28, spray) + 0.6 * patch(sample.y, 0.42, hash((by / cell) | 0, (bx / cell) | 0, salt ^ 0x5c));
      const gain = level * splotchGain;

      for (let c = 0; c < 3; c++) {
        let v = src[i + c];
        v = v * (1 + gain) + gain * 36;
        v = Math.round(clamp(v, 0, 255) / step) * step;
        colour[c] = v;
      }
      const alpha = src[i + 3];
      colour[3] = alpha + ((alpha >= 128 ? 255 : 0) - alpha) * hardness;

      const yEnd = Math.min(H, by + cell);
      const xEnd = Math.min(W, bx + cell);
      for (let y = by; y < yEnd; y++) {
        let o = (y * W + bx) * 4;
        for (let x = bx; x < xEnd; x++, o += 4) {
          dst[o] = colour[0];
          dst[o + 1] = colour[1];
          dst[o + 2] = colour[2];
          dst[o + 3] = colour[3];
        }
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

/**
 * +1 above the threshold, −1 below its mirror, 0 between; near either edge a
 * random pick between the two sides, which reads as spray-can speckle.
 */
function patch(value: number, threshold: number, random: number): number {
  const band = 0.09;
  const side = (edge: number, sign: number) => {
    const t = (sign * value - edge + band) / (band * 2);
    if (t <= 0) return 0;
    if (t >= 1) return sign;
    return random < t ? sign : 0;
  };
  return side(threshold, 1) || side(threshold, -1);
}

/** Byte offset of the nearest pixel, clamped to the frame. */
function index(x: number, y: number, W: number, H: number): number {
  const px = x < 0 ? 0 : x >= W - 1 ? W - 1 : Math.round(x);
  const py = y < 0 ? 0 : y >= H - 1 ? H - 1 : Math.round(y);
  return (py * W + px) * 4;
}

/** Fast integer hash to 0–1, stable per cell and seed. */
function hash(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + salt) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface FieldGrid {
  /** Writes the two field values at pixel (x, y) into `out`. */
  at: (x: number, y: number, out: { x: number; y: number }) => void;
}

/** A two-channel field evaluated on a coarse grid and interpolated across the frame. */
export function fieldGrid(
  cols: number,
  rows: number,
  W: number,
  H: number,
  value: (u: number, v: number) => [number, number],
): FieldGrid {
  const aspect = W / H;
  const gx = new Float32Array((cols + 1) * (rows + 1));
  const gy = new Float32Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [vx, vy] = value((c / cols) * aspect, r / rows);
      gx[r * (cols + 1) + c] = vx;
      gy[r * (cols + 1) + c] = vy;
    }
  }
  // Noise clusters round its middle, so stretch each channel to span −1…1:
  // the strengths above are then the real displacement and variation.
  normalise(gx);
  normalise(gy);
  const sx = cols / W;
  const sy = rows / H;
  return {
    at(x, y, out) {
      const fx = x * sx;
      const fy = y * sy;
      const c = Math.min(cols - 1, fx | 0);
      const r = Math.min(rows - 1, fy | 0);
      const tx = fx - c;
      const ty = fy - r;
      const i = r * (cols + 1) + c;
      const j = i + cols + 1;
      out.x = (gx[i] * (1 - tx) + gx[i + 1] * tx) * (1 - ty) + (gx[j] * (1 - tx) + gx[j + 1] * tx) * ty;
      out.y = (gy[i] * (1 - tx) + gy[i + 1] * tx) * (1 - ty) + (gy[j] * (1 - tx) + gy[j + 1] * tx) * ty;
    },
  };
}

/** Centres a field on zero and scales it so its largest excursion is 1. */
function normalise(values: Float32Array): void {
  let mean = 0;
  for (let i = 0; i < values.length; i++) mean += values[i];
  mean /= values.length;
  let peak = 1e-6;
  for (let i = 0; i < values.length; i++) peak = Math.max(peak, Math.abs(values[i] - mean));
  for (let i = 0; i < values.length; i++) values[i] = (values[i] - mean) / peak;
}
