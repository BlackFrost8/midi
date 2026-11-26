import { clamp } from '../../utils/math';
import { NoiseField, createRandom, mixSeed, type Random } from '../Noise';
import { isWarmHue, lchToRgb, oklch, rgbCss, type Lch, type Rgb8 } from '../Oklch';
import type { GroundTone } from '../Palette';
import type { ThumbnailDesign } from '../ThumbnailDesign';

/**
 * Shared machinery for the thumbnail layers.
 *
 * Geometry is in frame units: the height is 1 and the width is the aspect
 * ratio, so a 1280×720 preview and a 4K export are the same picture.
 */

export interface Env {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Width in frame units. */
  A: number;
  noise: NoiseField;
  detail: NoiseField;
  design: ThumbnailDesign;
  tone: GroundTone;
  ink: Ink;
  fieldScale: number;
  /** A random stream of its own for each layer, so layers never reshuffle each other. */
  rng: (salt: number) => Random;
}

export type Field = (x: number, y: number) => number;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A per-pixel layer: returns an index into `colors`, or −1 where it is transparent. */
export interface RasterLayer {
  colors: Rgb8[];
  sample: Field;
}

export interface TextZone {
  align: 'left' | 'center' | 'right';
  vertical: 'top' | 'middle' | 'bottom';
  /** Share of the frame width the title may span. */
  maxWidth: number;
  /** Extra inset in frame units, for layouts that keep text inside a border. */
  inset: number;
  /** Centre line for 'middle', in frame units. */
  y?: number;
}

export function createEnv(
  ctx: CanvasRenderingContext2D,
  design: ThumbnailDesign,
  width: number,
  height: number,
  fieldHeight: number,
): Env {
  const tone = design.recipe.tone;
  return {
    ctx,
    W: width,
    H: height,
    A: width / height,
    noise: new NoiseField(mixSeed(design.seed, 1)),
    detail: new NoiseField(mixSeed(design.seed, 2)),
    design,
    tone,
    ink: inkFor(design, tone),
    fieldScale: clamp(fieldHeight / height, 0.2, 1),
    rng: (salt) => createRandom(mixSeed(design.seed, 0x1a7e + salt * 7919)),
  };
}

// ---------------------------------------------------------------------------
// Colour roles
// ---------------------------------------------------------------------------

/**
 * The colours shapes are painted in, chosen to stand off the ground: vivid on
 * dark, deep on light, and on a colour ground whichever way has more contrast.
 */
export interface Ink {
  /** The two ends of the ground. */
  ground: Lch;
  groundFar: Lch;
  main: Lch;
  deep: Lch;
  light: Lch;
  halo: Lch;
  accent: Lch;
  third: Lch;
  /** Thin vector lines and glyphs. */
  line: Rgb8;
}

/**
 * The inks for a design, honouring any colours the user typed.
 *
 *  - A typed main colour is the shapes' colour, exactly — when it stands off
 *    the ground. Black, white or grey, or a colour too close to the ground's
 *    own tone, can't: it becomes the ground itself, and the accent paints the
 *    shapes. So black + cyan gives cyan shapes on black.
 *  - A typed accent is used exactly.
 *  - Everything else (shadows, highlights, the far ground) is derived from the
 *    colour actually used, so a grey stays grey rather than picking up a hue.
 */
function inkFor(design: ThumbnailDesign, tone: GroundTone): Ink {
  const ink = derivedInk(design, tone);
  const { base, accent, exactMain, exactAccent } = design.palette;
  if (exactAccent) ink.accent = accent;
  if (!exactMain) return ink;

  const shade = base.c < 0.035;
  if (!shade && tone === 'colour') return ink;
  if (!shade && Math.abs(base.l - ink.ground.l) >= 0.22) {
    return {
      ...ink,
      main: base,
      deep: { l: clamp(base.l - 0.22, 0.05, 0.95), c: base.c, h: base.h - 6 },
      light: { l: clamp(base.l + 0.12, 0.05, 0.97), c: base.c * 0.7, h: base.h + 8 },
      halo: { l: (base.l + ink.ground.l) / 2, c: base.c * 0.45, h: base.h },
    };
  }
  return groundIsMain(ink, base, ink.accent);
}

/** The typed main colour fills the background; the accent paints the shapes. */
function groundIsMain(ink: Ink, ground: Lch, shape: Lch): Ink {
  const dark = ground.l < 0.5;
  const white: Rgb8 = { r: 246, g: 247, b: 249 };
  return {
    ...ink,
    ground,
    groundFar: {
      l: clamp(ground.l + (dark ? 0.07 : -0.06), 0, 1),
      c: Math.max(ground.c, Math.min(shape.c * 0.25, 0.03)),
      h: ground.c < 0.035 ? shape.h : ground.h,
    },
    main: shape,
    deep: { l: clamp(shape.l - 0.22, 0.05, 0.95), c: shape.c, h: shape.h - 6 },
    light: { l: clamp(shape.l + 0.12, 0.05, 0.97), c: shape.c * 0.7, h: shape.h + 8 },
    halo: { l: clamp(ground.l + (dark ? 0.1 : -0.08), 0, 1), c: shape.c * 0.4, h: shape.h },
    accent: shape,
    line: dark ? white : oklch(0.2, Math.min(0.05, shape.c * 0.6), shape.h),
  };
}

function derivedInk(design: ThumbnailDesign, tone: GroundTone): Ink {
  const { base, accent, third } = design.palette;
  const warm = isWarmHue(base.h);
  const red = base.h >= 330 || base.h <= 40;
  const white: Rgb8 = { r: 246, g: 247, b: 249 };
  const darkInk = oklch(0.2, Math.min(0.05, base.c * 0.6), base.h);

  if (tone === 'dark') {
    const vividL = warm ? 0.78 : red ? 0.58 : 0.66;
    const main: Lch = { l: vividL + design.mood.valence * 0.08, c: Math.max(0.15, base.c * 1.3), h: base.h };
    return {
      ground: { l: 0.105, c: 0.012, h: base.h },
      groundFar: { l: 0.22, c: Math.max(0.05, base.c * 0.55), h: base.h },
      main,
      deep: { l: Math.max(main.l - 0.28, 0.28), c: main.c, h: base.h - 6 },
      light: { l: Math.min(main.l + 0.12, 0.94), c: main.c * 0.7, h: base.h + 8 },
      halo: { l: 0.22, c: main.c * 0.45, h: base.h },
      accent: { ...accent, l: Math.max(accent.l, 0.68) },
      third: { ...third, l: Math.max(third.l, 0.6) },
      line: white,
    };
  }

  if (tone === 'light') {
    const main: Lch = { l: warm ? 0.68 : 0.5, c: Math.max(0.1, base.c * 1.1), h: base.h };
    return {
      ground: { l: 0.968, c: 0.008, h: base.h },
      groundFar: { l: 0.86, c: Math.max(0.03, base.c * 0.45), h: base.h },
      main,
      deep: { l: warm ? 0.56 : 0.32, c: base.c * 1.1 + 0.02, h: base.h - 6 },
      light: { l: 0.8, c: base.c * 0.55, h: base.h + 4 },
      halo: { l: 0.9, c: base.c * 0.3, h: base.h },
      accent: { ...accent, l: Math.min(accent.l, 0.62) },
      third: { ...third, l: Math.min(third.l, 0.66) },
      line: darkInk,
    };
  }

  // A colour ground: shapes go darker on a light colour and lighter on a dark
  // one — except on yellows and oranges, where a darker shape turns brown, so
  // they get pale, near-white shapes instead.
  const lightGround = base.l > 0.62;
  const main: Lch = lightGround
    ? warm
      ? { l: 0.95, c: base.c * 0.35, h: base.h + 10 }
      : { l: base.l - 0.28, c: base.c * 1.15 + 0.02, h: base.h - 4 }
    : { l: Math.min(base.l + 0.26, 0.95), c: base.c * 0.9, h: base.h + 6 };
  const awayFrom = (color: Lch): Lch =>
    Math.abs(color.l - base.l) >= 0.16 ? color : { ...color, l: clamp(lightGround ? base.l - 0.22 : base.l + 0.22, 0.05, 0.97) };
  return {
    ground: base,
    groundFar: third,
    main,
    deep: { l: Math.max(base.l - 0.42, 0.14), c: base.c, h: base.h - 8 },
    light: { l: Math.min(base.l + 0.14, 0.97), c: base.c * 0.6, h: base.h + 6 },
    halo: { l: clamp(base.l + (lightGround ? -0.07 : 0.07), 0, 1), c: base.c, h: base.h },
    accent: awayFrom(accent),
    third: awayFrom(third),
    line: lightGround ? darkInk : white,
  };
}

export function lineCss(env: Env, alpha = 1): string {
  return rgbCss(env.ink.line, alpha);
}

// ---------------------------------------------------------------------------
// Rasterising
// ---------------------------------------------------------------------------

/**
 * Fills the frame from per-pixel layers, top layer first: each pixel takes the
 * colour of the highest layer that is not transparent there. The first layer
 * must cover everything.
 *
 * Posterising to a handful of flat colours is the look; the faceted high noise
 * octaves keep the boundaries between them ragged rather than smooth.
 */
export function composeRaster(env: Env, layers: RasterLayer[]): void {
  const fw = Math.max(2, Math.round(env.W * env.fieldScale));
  const fh = Math.max(2, Math.round(env.H * env.fieldScale));
  const field = document.createElement('canvas');
  field.width = fw;
  field.height = fh;
  const fctx = field.getContext('2d');
  if (!fctx) return;
  const image = fctx.createImageData(fw, fh);
  const data = image.data;

  const offsets: number[] = [];
  const all: Rgb8[] = [];
  for (const layer of layers) {
    offsets.push(all.length);
    all.push(...layer.colors);
  }
  const lut = new Uint8Array(all.length * 3);
  all.forEach((color, i) => {
    lut[i * 3] = color.r;
    lut[i * 3 + 1] = color.g;
    lut[i * 3 + 2] = color.b;
  });

  const top = layers.length - 1;
  for (let j = 0; j < fh; j++) {
    const y = (j + 0.5) / fh;
    let o = j * fw * 4;
    for (let i = 0; i < fw; i++) {
      const x = ((i + 0.5) / fw) * env.A;
      let index = 0;
      for (let l = top; l >= 0; l--) {
        const layer = layers[l];
        const k = layer.sample(x, y);
        if (k >= 0 || l === 0) {
          index = offsets[l] + Math.min(Math.max(k | 0, 0), layer.colors.length - 1);
          break;
        }
      }
      const c = index * 3;
      data[o] = lut[c];
      data[o + 1] = lut[c + 1];
      data[o + 2] = lut[c + 2];
      data[o + 3] = 255;
      o += 4;
    }
  }
  fctx.putImageData(image, 0, 0);
  env.ctx.imageSmoothingEnabled = true;
  env.ctx.imageSmoothingQuality = 'high';
  env.ctx.drawImage(field, 0, 0, env.W, env.H);
  field.width = 0;
  field.height = 0;
}

/**
 * Thresholds at the given area fractions of a field, measured on a coarse
 * grid. Lets a layer say "the lightest cloud covers 6% of the frame" whatever
 * the noise happened to do for this seed.
 */
export function quantiles(env: Env, field: Field, fractions: number[]): number[] {
  const values: number[] = [];
  const cols = 96;
  const rows = 54;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) values.push(field(((i + 0.5) / cols) * env.A, (j + 0.5) / rows));
  }
  values.sort((a, b) => a - b);
  return fractions.map((q) => values[Math.min(values.length - 1, Math.floor(q * values.length))]);
}

export function level(value: number, thresholds: number[]): number {
  let k = 0;
  while (k < thresholds.length && value >= thresholds[k]) k++;
  return k;
}

/** Low, broad texture used by grounds for their faint second tone. */
export function textureField(env: Env, offset = 0): Field {
  return (x, y) => env.noise.fbm(x * 1.7 + 31.3 + offset, y * 1.7 - 12.1, 5, 0.55, 2);
}

export function rgb(colors: Lch[]): Rgb8[] {
  return colors.map(lchToRgb);
}

// ---------------------------------------------------------------------------
// Blooms
// ---------------------------------------------------------------------------

export interface Bloom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  /** Large-scale raggedness of the outline. */
  warp: number;
  /** Fine, faceted raggedness. */
  detail: number;
  /** Offsets the noise so two blooms in one frame differ. */
  offset?: number;
}

/**
 * Positive inside a ragged elliptical bloom, zero at its edge. The noise
 * scales with the bloom, so a small fragment is as torn as a large one rather
 * than a smooth egg.
 */
export function bloomField(env: Env, bloom: Bloom): Field {
  const cos = Math.cos(bloom.angle);
  const sin = Math.sin(bloom.angle);
  const o = bloom.offset ?? 0;
  const f = Math.min(Math.max(0.3 / Math.max(bloom.rx, bloom.ry), 1), 6);
  return (x, y) => {
    const dx = x - bloom.cx;
    const dy = y - bloom.cy;
    const lx = (dx * cos + dy * sin) / bloom.rx;
    const ly = (-dx * sin + dy * cos) / bloom.ry;
    const q = Math.sqrt(lx * lx + ly * ly);
    const warp = (env.noise.fbm(x * 2.1 * f + 4.4 + o, y * 2.1 * f - 8.2, 5, 0.58, 2) - 0.5) * bloom.warp;
    const fine = (env.detail.fbm(x * 8.5 * f + o, y * 8.5 * f, 3, 0.55, 0) - 0.5) * bloom.detail;
    return 1 - q + warp + fine;
  };
}

// ---------------------------------------------------------------------------
// Title placement
// ---------------------------------------------------------------------------

/**
 * Puts the title on the far side of the focal point. Never bottom-right:
 * YouTube lays the duration badge over that corner.
 */
export function zoneAwayFrom(env: Env, fx: number, fy: number, maxWidth = 0.5): TextZone {
  if (Math.abs(fx - env.A / 2) < env.A * 0.1) {
    return { align: 'center', vertical: fy < 0.5 ? 'bottom' : 'top', maxWidth: 0.6, inset: 0 };
  }
  const textLeft = fx >= env.A / 2;
  if (!textLeft) return { align: 'right', vertical: 'top', maxWidth, inset: 0 };
  return { align: 'left', vertical: fy > 0.62 ? 'top' : 'bottom', maxWidth, inset: 0 };
}

/** Rough rectangle the title will occupy, in frame units, so busy layers can leave it clear. */
export function zoneRect(env: Env, zone: TextZone): Rect {
  const margin = 0.06 + zone.inset;
  const w = zone.maxWidth * env.A;
  const h = env.design.subtitle ? 0.3 : 0.24;
  const x0 = zone.align === 'left' ? margin : zone.align === 'right' ? env.A - margin - w : (env.A - w) / 2;
  const y0 = zone.vertical === 'top' ? margin : zone.vertical === 'bottom' ? 1 - margin - h : (zone.y ?? 0.5) - h / 2;
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

export function inside(rect: Rect | null, x: number, y: number): boolean {
  return Boolean(rect && x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1);
}

/** Distance from a point to a rectangle, 0 inside it. */
export function clearance(rect: Rect | null, x: number, y: number): number {
  if (!rect) return Infinity;
  return Math.hypot(Math.max(rect.x0 - x, 0, x - rect.x1), Math.max(rect.y0 - y, 0, y - rect.y1));
}

/**
 * One raster layer on its own: pixels the layer does not cover stay
 * transparent, so a shape can be drawn on a separate, movable layer.
 */
export function composeRasterAlpha(env: Env, layer: RasterLayer): void {
  const fw = Math.max(2, Math.round(env.W * env.fieldScale));
  const fh = Math.max(2, Math.round(env.H * env.fieldScale));
  const field = document.createElement('canvas');
  field.width = fw;
  field.height = fh;
  const fctx = field.getContext('2d');
  if (!fctx) return;
  const image = fctx.createImageData(fw, fh);
  const data = image.data;
  const last = layer.colors.length - 1;
  for (let j = 0; j < fh; j++) {
    const y = (j + 0.5) / fh;
    let o = j * fw * 4;
    for (let i = 0; i < fw; i++) {
      const k = layer.sample(((i + 0.5) / fw) * env.A, y);
      if (k >= 0) {
        const color = layer.colors[Math.min(Math.max(k | 0, 0), last)];
        data[o] = color.r;
        data[o + 1] = color.g;
        data[o + 2] = color.b;
        data[o + 3] = 255;
      }
      o += 4;
    }
  }
  fctx.putImageData(image, 0, 0);
  env.ctx.imageSmoothingEnabled = true;
  env.ctx.imageSmoothingQuality = 'high';
  env.ctx.drawImage(field, 0, 0, env.W, env.H);
  field.width = 0;
  field.height = 0;
}
