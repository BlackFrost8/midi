import { clamp } from '../utils/math';
import { applyHandmade, fieldGrid } from './Handmade';
import { NoiseField, mixSeed } from './Noise';

/**
 * Whole-picture filters for the thumbnail. Each works in place on a canvas,
 * with its strength measured against a 720-pixel-tall frame, so the preview,
 * the little previews in the Filter tab and a 4K export look alike.
 */

export type FilterId =
  | 'none'
  | 'pixel'
  | 'oil'
  | 'watercolor'
  | 'coloring'
  | 'comic'
  | 'relief'
  | 'duotone'
  | 'neon'
  | 'dreamy'
  | 'sketch'
  | 'glass'
  | 'noir'
  /** Old name for Pixel, kept so saved settings still load. */
  | 'mspaint';

export interface FilterInfo {
  id: FilterId;
  name: string;
  hint: string;
  /** What the Strength slider does for this filter. */
  strength: string;
}

export const FILTERS: FilterInfo[] = [
  { id: 'none', name: 'None', hint: 'The picture as designed', strength: 'Strength' },
  { id: 'pixel', name: 'Pixel', hint: 'Made in MS Paint with a mouse: chunky pixels, wobbly lines, splotches', strength: 'Chunkiness' },
  { id: 'oil', name: 'Oil paint', hint: 'Thick, smeared brush strokes that keep the shapes', strength: 'Brush size' },
  { id: 'watercolor', name: 'Watercolor', hint: 'Soft washes that pool darker at the edges, on paper', strength: 'Wetness' },
  { id: 'coloring', name: 'Coloring book', hint: 'Black outlines on white paper', strength: 'Line weight' },
  { id: 'comic', name: 'Comic', hint: 'Flat colours with bold ink outlines', strength: 'Ink' },
  { id: 'relief', name: '3D', hint: 'Raised, lit and casting shadows, like a paper cut-out', strength: 'Depth' },
  { id: 'duotone', name: 'Duotone', hint: 'Two colours from the palette', strength: 'Intensity' },
  { id: 'neon', name: 'Neon', hint: 'Glowing edges on black', strength: 'Glow' },
  { id: 'dreamy', name: 'Dreamy', hint: 'Soft bloom and haze', strength: 'Bloom' },
  { id: 'sketch', name: 'Sketch', hint: 'Pencil outlines and cross-hatched shading', strength: 'Pressure' },
  { id: 'glass', name: 'Stained glass', hint: 'Cells of flat colour with dark leading', strength: 'Smaller pieces' },
  { id: 'noir', name: 'Noir', hint: 'Hard black and white with a dark vignette', strength: 'Contrast' },
];

export interface FilterSettings {
  id: FilterId;
  /** 0–1: the filter's own control (see FilterInfo.strength). */
  strength: number;
  /** 0–1: how much of the filtered picture shows over the original. Default 1. */
  mix?: number;
  seed: number;
  /** Palette colours for the filters that recolour (duotone). */
  dark: string;
  light: string;
}

export function applyFilter(canvas: HTMLCanvasElement, settings: FilterSettings): void {
  if (settings.id === 'none' || canvas.width < 2 || canvas.height < 2) return;
  const mix = clamp(settings.mix ?? 1, 0, 1);
  if (mix <= 0.001) return;
  if (mix >= 0.999) {
    run(canvas, settings);
    return;
  }
  // Filter a copy, then lay it over the original at the chosen amount.
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  run(copy, settings);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.globalAlpha = mix;
  ctx.drawImage(copy, 0, 0);
  ctx.restore();
}

function run(canvas: HTMLCanvasElement, settings: FilterSettings): void {
  const id = settings.id === 'mspaint' ? 'pixel' : settings.id;
  const s = clamp(settings.strength, 0, 1);
  switch (id) {
    case 'pixel':
      return applyHandmade(canvas, settings.seed, 0.3 + 0.7 * s, 1 + 1.6 * s);
    case 'dreamy':
      return dreamy(canvas, s);
    case 'oil':
      return atWorkingSize(canvas, 1080, (image) => oil(image, s, settings.seed));
    case 'watercolor':
      return atWorkingSize(canvas, 1080, (image) => watercolor(image, s, settings.seed));
    default:
      break;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  switch (id) {
    case 'coloring':
      coloring(image, s);
      break;
    case 'comic':
      comic(image, s);
      break;
    case 'relief':
      relief(image, s);
      break;
    case 'duotone':
      duotone(image, s, hexRgb(settings.dark), hexRgb(settings.light));
      break;
    case 'neon':
      neon(image, s);
      break;
    case 'sketch':
      sketch(image, s, settings.seed);
      break;
    case 'glass':
      glass(image, s, settings.seed);
      break;
    case 'noir':
      noir(image, s);
      break;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Runs a heavy filter at no more than `maxHeight` pixels tall and scales the
 * result back up: a 4K export then costs no more than a 1080p one, and brush
 * marks stay the same size relative to the frame.
 */
function atWorkingSize(canvas: HTMLCanvasElement, maxHeight: number, filter: (image: ImageData) => void): void {
  const scale = Math.min(1, maxHeight / canvas.height);
  const w = Math.max(2, Math.round(canvas.width * scale));
  const h = Math.max(2, Math.round(canvas.height * scale));
  const work = scale < 1 ? document.createElement('canvas') : canvas;
  if (work !== canvas) {
    work.width = w;
    work.height = h;
    const wctx = work.getContext('2d');
    if (!wctx) return;
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(canvas, 0, 0, w, h);
  }
  const ctx = work.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, w, h);
  filter(image);
  ctx.putImageData(image, 0, 0);
  if (work !== canvas) {
    const out = canvas.getContext('2d');
    if (!out) return;
    out.save();
    out.imageSmoothingQuality = 'high';
    out.clearRect(0, 0, canvas.width, canvas.height);
    out.drawImage(work, 0, 0, canvas.width, canvas.height);
    out.restore();
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Black outlines on white paper, the shapes left for you to colour in. */
function coloring(image: ImageData, s: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const edges = colourEdges(blurRgb(data, W, H, Math.max(1, Math.round(1.5 * k))), W, H);
  const mask = dilate(threshold(edges, 0.055 - 0.03 * s), W, H, Math.max(0, Math.round((0.2 + 1.5 * s) * k)));
  const ink = softLines(mask, W, H, k);
  for (let p = 0, i = 0; p < ink.length; p++, i += 4) {
    const a = ink[p];
    data[i] = 252 - a * 232;
    data[i + 1] = 251 - a * 231;
    data[i + 2] = 246 - a * 226;
    data[i + 3] = 255;
  }
}

/** Flattened, saturated colour in a few steps, with bold ink outlines. */
function comic(image: ImageData, s: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const flat = blurRgb(data, W, H, Math.max(1, Math.round(2 * k)));
  const bands = Math.round(6 - 2.5 * s);
  const mask = dilate(threshold(colourEdges(flat, W, H), 0.085 - 0.035 * s), W, H, Math.max(1, Math.round((1 + 1.8 * s) * k)));
  const ink = softLines(mask, W, H, k);
  for (let p = 0, i = 0; p < ink.length; p++, i += 4) {
    const line = ink[p];
    let r = flat[i];
    let g = flat[i + 1];
    let b = flat[i + 2];
    // Punchier colour, then the lightness snapped to a few cel-shading bands.
    const grey = (r + g + b) / 3;
    const sat = 1.3 + 0.4 * s;
    r = clamp(grey + (r - grey) * sat, 0, 255);
    g = clamp(grey + (g - grey) * sat, 0, 255);
    b = clamp(grey + (b - grey) * sat, 0, 255);
    const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    const banded = (Math.floor(l * bands) + 0.65) / bands;
    const scale = l > 0.01 ? banded / l : 1;
    const keep = 1 - line;
    data[i] = clamp(r * scale, 0, 255) * keep + 14 * line;
    data[i + 1] = clamp(g * scale, 0, 255) * keep + 14 * line;
    data[i + 2] = clamp(b * scale, 0, 255) * keep + 18 * line;
  }
}

/**
 * Brightness read as height, lit from the top left, with every raised shape
 * casting a soft shadow down and to the right: a layered paper cut-out.
 */
function relief(image: ImageData, s: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const raw = heightField(data, W, H);
  const height = blur(raw, W, H, Math.max(1, Math.round(2 * k)));
  const soft = blur(raw, W, H, Math.max(2, Math.round((5 + 7 * s) * k)));
  const depth = (14 + 34 * s) * k;
  const offset = Math.max(1, Math.round((5 + 12 * s) * k));
  const lx = -0.6;
  const ly = -0.7;
  const lz = 0.4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const dx = (height[y * W + Math.min(W - 1, x + 1)] - height[y * W + Math.max(0, x - 1)]) * depth;
      const dy = (height[Math.min(H - 1, y + 1) * W + x] - height[Math.max(0, y - 1) * W + x]) * depth;
      const len = Math.hypot(dx, dy, 1);
      const light = (-dx * lx - dy * ly + lz) / len;
      // Anything higher up and to the top left throws its shadow here.
      const caster = soft[Math.max(0, y - offset) * W + Math.max(0, x - offset)];
      const cast = Math.max(0, caster - soft[p]) * (1.6 + 1.6 * s);
      const shade = (0.55 + light * 1.15) * (1 - Math.min(0.6, cast));
      const i = p * 4;
      // Highlights go toward white, shadows toward black, so it reads as lit, not tinted.
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        data[i + c] = shade >= 1 ? v + (255 - v) * Math.min(1, (shade - 1) * 1.4) : v * shade;
      }
    }
  }
}

function duotone(image: ImageData, s: number, dark: Rgb, light: Rgb): void {
  const { data } = image;
  const mix = 0.55 + 0.45 * s;
  for (let i = 0; i < data.length; i += 4) {
    const l = Math.pow((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255, 0.9);
    const r = dark.r + (light.r - dark.r) * l;
    const g = dark.g + (light.g - dark.g) * l;
    const b = dark.b + (light.b - dark.b) * l;
    data[i] = data[i] + (r - data[i]) * mix;
    data[i + 1] = data[i + 1] + (g - data[i + 1]) * mix;
    data[i + 2] = data[i + 2] + (b - data[i + 2]) * mix;
  }
}

/** Every edge glows in its own colour, brightened, on black. */
function neon(image: ImageData, s: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const lum = blur(luminance(data, W, H), W, H, Math.max(1, Math.round(1.2 * k)));
  const edges = sobel(lum, W, H);
  const glow = blur(edges, W, H, Math.max(2, Math.round((4 + 8 * s) * k)));
  const colour = blurRgb(data, W, H, Math.max(1, Math.round(3 * k)));
  for (let p = 0, i = 0; p < edges.length; p++, i += 4) {
    const line = Math.min(1, edges[p] * 7);
    const halo = Math.min(1, glow[p] * (5 + 6 * s));
    const amount = Math.max(line, halo * 0.75);
    let r = colour[i];
    let g = colour[i + 1];
    let b = colour[i + 2];
    // Push the colour to full brightness so dark shapes still glow.
    const peak = Math.max(r, g, b, 1);
    r = (r / peak) * 255;
    g = (g / peak) * 255;
    b = (b / peak) * 255;
    const core = line * line * 0.6;
    data[i] = clamp(r * amount + 255 * core, 0, 255);
    data[i + 1] = clamp(g * amount + 255 * core, 0, 255);
    data[i + 2] = clamp(b * amount + 255 * core, 0, 255);
  }
}

/** A blurred, brightened copy laid over the picture in screen mode. */
function dreamy(canvas: HTMLCanvasElement, s: number): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const copy = document.createElement('canvas');
  copy.width = W;
  copy.height = H;
  const cctx = copy.getContext('2d', { willReadFrequently: true });
  if (!cctx) return;
  cctx.drawImage(canvas, 0, 0);
  const image = cctx.getImageData(0, 0, W, H);
  const soft = blurRgb(image.data, W, H, Math.max(2, Math.round((8 + 16 * s) * (H / 720))));
  for (let i = 0; i < soft.length; i += 4) {
    image.data[i] = soft[i];
    image.data[i + 1] = soft[i + 1];
    image.data[i + 2] = soft[i + 2];
  }
  cctx.putImageData(image, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.45 + 0.4 * s;
  ctx.drawImage(copy, 0, 0);
  // A pale haze lifts the shadows.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.06 + 0.1 * s;
  ctx.fillStyle = '#fff6f0';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * Pencil on warm paper: outlines that press harder on strong edges, and
 * shading built up in layers of hatching — one direction for midtones, crossed
 * for shadows, a third for the deepest darks — each line wavering a little.
 */
function sketch(image: ImageData, s: number, seed: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const lum = blur(luminance(data, W, H), W, H, Math.max(1, Math.round(1.4 * k)));
  const tone = blur(lum, W, H, Math.max(1, Math.round(3 * k)));
  const edges = sobel(lum, W, H);
  const noise = new NoiseField(mixSeed(seed, 0x5e7));
  const waver = fieldGrid(64, 36, W, H, (u, v) => [noise.fbm(u * 6, v * 6, 2) - 0.5, noise.fbm(u * 6 + 17, v * 6 - 3, 2) - 0.5]);
  const pressure = fieldGrid(32, 18, W, H, (u, v) => [noise.fbm(u * 3 + 5, v * 3, 3) - 0.5, 0]);
  const gap = (10 - 3 * s) * k;
  const width = 0.26;
  const sample = { x: 0, y: 0 };
  // A pencil line across the hatch direction: 1 on the line, fading at its sides.
  const stroke = (t: number) => {
    const f = t - Math.floor(t);
    const d = Math.min(f, 1 - f);
    return d < width / 2 ? 1 : d < width ? 1 - (d - width / 2) / (width / 2) : 0;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      waver.at(x, y, sample);
      const wx = x + sample.x * 2.5 * k;
      const wy = y + sample.y * 2.5 * k;
      pressure.at(x, y, sample);
      const press = 0.85 + sample.x * 0.3;
      const dark = clamp((1 - tone[p]) * (0.9 + 0.5 * s), 0, 1);
      let shade = 0;
      if (dark > 0.3) shade = Math.max(shade, stroke((wx + wy) / gap) * Math.min(1, (dark - 0.3) * 4) * 0.6);
      if (dark > 0.55) shade = Math.max(shade, stroke((wx - wy) / gap) * Math.min(1, (dark - 0.55) * 4) * 0.7);
      if (dark > 0.78) shade = Math.max(shade, stroke(wy / (gap * 0.7)) * Math.min(1, (dark - 0.78) * 4) * 0.8);
      const line = Math.min(1, Math.pow(edges[p] * (5 + 6 * s), 1.3));
      const graphite = clamp((line * 0.9 + shade * (1 - line * 0.5)) * press, 0, 1);
      const i = p * 4;
      data[i] = 246 - graphite * 196;
      data[i + 1] = 242 - graphite * 194;
      data[i + 2] = 232 - graphite * 186;
      data[i + 3] = 255;
    }
  }
}

/** Jittered cells, each one flat colour from its centre, with dark leading between them. */
function glass(image: ImageData, s: number, seed: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const cell = Math.max(3, (34 - 20 * s) * k);
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  const sx = new Float32Array(cols * rows);
  const sy = new Float32Array(cols * rows);
  let state = mixSeed(seed, 0x61a55) >>> 0;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      sx[r * cols + c] = (c + 0.15 + rand() * 0.7) * cell;
      sy[r * cols + c] = (r + 0.15 + rand() * 0.7) * cell;
    }
  }
  const source = new Uint8ClampedArray(data);
  const lead = Math.max(0.5, 1.6 * k);
  for (let y = 0; y < H; y++) {
    const cr = Math.floor(y / cell);
    for (let x = 0; x < W; x++) {
      const cc = Math.floor(x / cell);
      let best = Infinity;
      let second = Infinity;
      let bi = 0;
      for (let r = Math.max(0, cr - 1); r <= Math.min(rows - 1, cr + 1); r++) {
        for (let c = Math.max(0, cc - 1); c <= Math.min(cols - 1, cc + 1); c++) {
          const j = r * cols + c;
          const d = Math.hypot(x - sx[j], y - sy[j]);
          if (d < best) {
            second = best;
            best = d;
            bi = j;
          } else if (d < second) {
            second = d;
          }
        }
      }
      const i = (y * W + x) * 4;
      if (second - best < lead) {
        data[i] = 18;
        data[i + 1] = 16;
        data[i + 2] = 20;
        continue;
      }
      const px = Math.min(W - 1, Math.max(0, Math.round(sx[bi])));
      const py = Math.min(H - 1, Math.max(0, Math.round(sy[bi])));
      const o = (py * W + px) * 4;
      // Glass is lit from behind: a touch brighter toward each cell's middle.
      const glow = 1.08 - Math.min(0.16, best / cell / 4);
      data[i] = clamp(source[o] * glow, 0, 255);
      data[i + 1] = clamp(source[o + 1] * glow, 0, 255);
      data[i + 2] = clamp(source[o + 2] * glow, 0, 255);
    }
  }
}

/** Black and white with deep blacks, a soft S-curve, a cool cast in the shadows and a dark vignette. */
function noir(image: ImageData, s: number): void {
  const { width: W, height: H, data } = image;
  const contrast = 1.2 + 1.8 * s;
  const cx = W / 2;
  const cy = H / 2;
  const reach = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      // An S-curve around the middle grey, steeper with strength.
      const c = clamp((l - 0.5) * contrast, -0.5, 0.5);
      let v = 0.5 + c * (1.5 - 2 * c * c * (contrast > 2 ? 1 : 0.6));
      const r = Math.hypot(x - cx, y - cy) / reach;
      v *= 1 - (0.25 + 0.35 * s) * Math.pow(Math.max(0, r - 0.35) / 0.65, 1.6);
      v = clamp(v, 0, 1);
      // Shadows lean slightly blue, highlights stay pure.
      const cool = (1 - v) * 0.06;
      data[i] = clamp((v - cool) * 255, 0, 255);
      data[i + 1] = clamp(v * 255, 0, 255);
      data[i + 2] = clamp((v + cool * 0.8) * 255, 0, 255);
    }
  }
}

/**
 * Oil paint: each pixel takes the average colour of whichever of the four
 * squares around it is most even (a Kuwahara filter), so colours smear into
 * flat dabs while shapes keep their edges; then a little light catches the
 * ridges of the paint.
 */
function oil(image: ImageData, s: number, seed: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const half = Math.max(2, Math.round((3 + 6 * s) * k));
  const n = W * H;
  const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    channels[0][p] = data[i];
    channels[1][p] = data[i + 1];
    channels[2][p] = data[i + 2];
    channels[3][p] = l;
    channels[4][p] = l * l;
  }
  // Means over a square of side 2·half+1 centred on each pixel; the four
  // quadrant squares are those centred half a square away.
  const mean = channels.map((c) => boxPass(boxPass(c, W, H, half, true), W, H, half, false));
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = Infinity;
      let q = 0;
      for (let dy = -1; dy <= 1; dy += 2) {
        const yy = Math.min(H - 1, Math.max(0, y + dy * half));
        for (let dx = -1; dx <= 1; dx += 2) {
          const xx = Math.min(W - 1, Math.max(0, x + dx * half));
          const j = yy * W + xx;
          const variance = mean[4][j] - mean[3][j] * mean[3][j];
          if (variance < best) {
            best = variance;
            q = j;
          }
        }
      }
      const o = (y * W + x) * 4;
      out[o] = mean[0][q];
      out[o + 1] = mean[1][q];
      out[o + 2] = mean[2][q];
      out[o + 3] = data[o + 3];
    }
  }
  // Fine lines the dabs would swallow (a contour, a thin ring) are painted
  // back on top, as a painter would pick them out with a small brush.
  for (let i = 0; i < out.length; i += 4) {
    const diff = Math.abs(data[i] - out[i]) + Math.abs(data[i + 1] - out[i + 1]) + Math.abs(data[i + 2] - out[i + 2]);
    const t = clamp((diff - 70) / 120, 0, 1) * 0.8;
    if (t > 0) for (let c = 0; c < 3; c++) out[i + c] = out[i + c] + (data[i + c] - out[i + c]) * t;
  }
  // Brush strokes: streaks running in a direction that swirls slowly across
  // the canvas, read as a height so light from the top left catches each ridge.
  const noise = new NoiseField(mixSeed(seed, 0x011));
  const angle = fieldGrid(24, 14, W, H, (u, v) => [noise.fbm(u * 1.6 + 4, v * 1.6, 3) - 0.5, 0]);
  const along = (28 + 22 * s) * k;
  const across = (3.5 + 2.5 * s) * k;
  const sample = { x: 0, y: 0 };
  const paint = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      angle.at(x, y, sample);
      const a = sample.x * Math.PI;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      paint[y * W + x] = noise.value((x * c + y * sn) / along + 50, (y * c - x * sn) / across);
    }
  }
  const lift = 0.8 + 0.6 * s;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const ridge = (paint[p - W - 1] - paint[p + W + 1]) * lift;
      const o = p * 4;
      // Richer colour, as oils are, then the light on the ridge.
      const grey = (out[o] + out[o + 1] + out[o + 2]) / 3;
      for (let c = 0; c < 3; c++) {
        const v = grey + (out[o + c] - grey) * 1.18;
        out[o + c] = clamp(v * (1 + ridge * 0.3) + ridge * 14, 0, 255);
      }
    }
  }
  data.set(out);
}

/**
 * Watercolour: the picture softened into washes, lighter and more transparent
 * than paint, with pigment pooling darker along every edge where a wash dried,
 * blooms of uneven colour, wandering wet edges, and paper showing through.
 */
function watercolor(image: ImageData, s: number, seed: number): void {
  const { width: W, height: H, data } = image;
  const k = H / 720;
  const noise = new NoiseField(mixSeed(seed, 0x3a7e));
  const flow = fieldGrid(72, 40, W, H, (u, v) => [noise.fbm(u * 4 + 2, v * 4, 3) - 0.5, noise.fbm(u * 4 - 9, v * 4 + 4, 3) - 0.5]);
  const bloom = fieldGrid(48, 27, W, H, (u, v) => [noise.fbm(u * 2.5 + 31, v * 2.5, 4) - 0.5, noise.fbm(u * 9, v * 9 - 13, 2) - 0.5]);
  const soft = blurRgb(data, W, H, Math.max(1, Math.round((1.5 + 3 * s) * k)));
  const edges = colourEdges(blurRgb(data, W, H, Math.max(1, Math.round(1.2 * k))), W, H);
  const rim = blur(edges, W, H, Math.max(1, Math.round((1.5 + 1.5 * s) * k)));
  const reach = (3 + 7 * s) * k;
  const sample = { x: 0, y: 0 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      // The wash wanders: sample from a little way off, so edges run and feather.
      flow.at(x, y, sample);
      const sx = Math.min(W - 1, Math.max(0, Math.round(x + sample.x * reach)));
      const sy = Math.min(H - 1, Math.max(0, Math.round(y + sample.y * reach)));
      const j = (sy * W + sx) * 4;
      bloom.at(x, y, sample);
      // Pigment density: thin, uneven washes with paper breaking through where
      // the brush ran dry, much heavier where a wash dried at an edge.
      const dry = clamp((sample.x + 0.55) / 0.35, 0, 1);
      const pool = Math.min(0.75, rim[p] * (7 + 6 * s));
      // The wash stops short of the frame in a ragged, unpainted paper border.
      const border = Math.min(x, y, W - 1 - x, H - 1 - y) / (H * (0.035 + 0.03 * s)) + sample.y * 0.9;
      const painted = clamp(border, 0, 1);
      const density = clamp((0.3 + 0.36 * dry + sample.y * 0.08) * (0.9 + 0.2 * s) + pool, 0.1, 1.3) * painted;
      const i = p * 4;
      for (let c = 0; c < 3; c++) {
        // Transparent pigment over white paper: absorb a share of the light.
        const absorb = (255 - soft[j + c]) * density;
        data[i + c] = clamp(253 - absorb, 0, 255);
      }
      data[i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Luminance 0–1 per pixel. */
function luminance(data: ArrayLike<number>, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  return out;
}

/** Separable box blur of one channel, run twice for a softer falloff. */
function blur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    a = boxPass(a, W, H, r, true);
    a = boxPass(a, W, H, r, false);
  }
  return a;
}

function boxPass(src: Float32Array, W: number, H: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const n = horizontal ? W : H;
  const lines = horizontal ? H : W;
  const stride = horizontal ? 1 : W;
  const size = r * 2 + 1;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * W : l;
    let sum = 0;
    for (let t = -r; t <= r; t++) sum += src[base + clampIndex(t, n) * stride];
    for (let t = 0; t < n; t++) {
      out[base + t * stride] = sum / size;
      sum += src[base + clampIndex(t + r + 1, n) * stride] - src[base + clampIndex(t - r, n) * stride];
    }
  }
  return out;
}

function clampIndex(t: number, n: number): number {
  return t < 0 ? 0 : t >= n ? n - 1 : t;
}

/** Box blur of the RGB channels, returned as an RGBA float array. */
function blurRgb(data: ArrayLike<number>, W: number, H: number, r: number): Float32Array {
  const out = new Float32Array(W * H * 4);
  const channel = new Float32Array(W * H);
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < channel.length; p++) channel[p] = data[p * 4 + c];
    const soft = blur(channel, W, H, r);
    for (let p = 0; p < channel.length; p++) out[p * 4 + c] = soft[p];
  }
  for (let p = 0; p < channel.length; p++) out[p * 4 + 3] = 255;
  return out;
}

/** Height for the 3D filter: brightness plus a share of saturation, 0–1. */
function heightField(data: ArrayLike<number>, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    out[p] = ((r * 0.299 + g * 0.587 + b * 0.114) / 255) * 0.7 + ((max - min) / 255) * 0.3;
  }
  return out;
}

/** Edge strength from colour difference (strongest channel), 0 to about 1. */
function colourEdges(rgba: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const channel = new Float32Array(W * H);
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < channel.length; p++) channel[p] = rgba[p * 4 + c] / 255;
    const edges = sobel(channel, W, H);
    for (let p = 0; p < out.length; p++) if (edges[p] > out[p]) out[p] = edges[p];
  }
  return out;
}

/** Gradient magnitude, 0 to about 1. */
function sobel(lum: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const gx = lum[p - W + 1] + 2 * lum[p + 1] + lum[p + W + 1] - lum[p - W - 1] - 2 * lum[p - 1] - lum[p + W - 1];
      const gy = lum[p + W - 1] + 2 * lum[p + W] + lum[p + W + 1] - lum[p - W - 1] - 2 * lum[p - W] - lum[p - W + 1];
      out[p] = Math.hypot(gx, gy) / 4;
    }
  }
  return out;
}

function threshold(src: Float32Array, t: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let p = 0; p < src.length; p++) out[p] = src[p] > t ? 1 : 0;
  return out;
}

/** A hard line mask softened by a pixel or so, so ink lines are smooth rather than stair-stepped. */
function softLines(mask: Uint8Array, W: number, H: number, k: number): Float32Array {
  const f = new Float32Array(mask.length);
  for (let p = 0; p < mask.length; p++) f[p] = mask[p];
  const soft = blur(f, W, H, Math.max(1, Math.round(0.8 * k)));
  for (let p = 0; p < soft.length; p++) {
    const t = clamp((soft[p] - 0.2) / 0.6, 0, 1);
    soft[p] = t * t * (3 - 2 * t);
  }
  return soft;
}

/** Thickens a line mask by r pixels (square neighbourhood, separable). */
function dilate(mask: Uint8Array, W: number, H: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < H; y++) {
    let run = -1e9;
    for (let x = 0; x < W + r; x++) {
      if (x < W && mask[y * W + x]) run = x;
      const target = x - r;
      if (target >= 0 && target < W && x - run <= 2 * r) tmp[y * W + target] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < W; x++) {
    let run = -1e9;
    for (let y = 0; y < H + r; y++) {
      if (y < H && tmp[y * W + x]) run = y;
      const target = y - r;
      if (target >= 0 && target < H && y - run <= 2 * r) out[target * W + x] = 1;
    }
  }
  return out;
}
