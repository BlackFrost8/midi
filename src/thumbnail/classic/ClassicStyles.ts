import { clamp } from '../../utils/math';
import { NoiseField, createRandom, mixSeed, type CellSample, type Random } from '../Noise';
import { isWarmHue, lchCss, lchToRgb, oklch, rgbCss, shift, type Lch, type Rgb8 } from '../Oklch';
import { createEnv, type TextZone } from '../render/Kit';
import { groundLayer } from '../render/Grounds';
import { composeRaster } from '../render/Kit';
import type { SongMood } from '../SongMood';
import type { MelodyNote, ThumbnailDesign } from '../ThumbnailDesign';

/**
 * The eight original thumbnail designs, each a complete composition rather
 * than a combination of layers: a colour field, an ink bloom on paper, a tear
 * through black, a neon window, a shard burst, a crack network, an orbiting
 * moon, and the melody as a row of glyphs.
 *
 * They are drawn by the same code as when they were first made, and follow
 * the Colour section: a typed main or accent colour is used as it is, and a
 * black, white or grey main colour fills the background while the accent
 * paints the shapes.
 */

export type ClassicId =
  | 'wash'
  | 'stain'
  | 'stain-streak'
  | 'stain-island'
  | 'stain-corner'
  | 'rift'
  | 'rift-tear'
  | 'rift-mass'
  | 'rift-splash'
  | 'frame'
  | 'shatter'
  | 'shatter-storm'
  | 'shatter-drift'
  | 'shatter-colour'
  | 'fracture'
  | 'orbit'
  | 'glyphs';

/** The original designs; variations below fix one of their choices. */
export type BaseClassicId = 'wash' | 'stain' | 'rift' | 'frame' | 'shatter' | 'fracture' | 'orbit' | 'glyphs';

export const CLASSICS: Array<{ id: ClassicId; name: string; blurb: string }> = [
  { id: 'wash', name: 'Colour Field', blurb: 'One colour, soft stepped clouds' },
  { id: 'stain', name: 'Paper Bloom', blurb: 'A ragged ink bloom on pale paper' },
  { id: 'stain-streak', name: 'Paper Bloom · Streak', blurb: 'A long ink streak across pale paper' },
  { id: 'stain-island', name: 'Paper Bloom · Island', blurb: 'A single floating ink island' },
  { id: 'stain-corner', name: 'Paper Bloom · Corner', blurb: 'Ink spreading in from a corner' },
  { id: 'rift', name: 'Void Rift', blurb: 'A vivid tear through black' },
  { id: 'rift-tear', name: 'Void Rift · Tear', blurb: 'A long diagonal tear through black' },
  { id: 'rift-mass', name: 'Void Rift · Mass', blurb: 'A vivid mass rising from the bottom edge' },
  { id: 'rift-splash', name: 'Void Rift · Splash', blurb: 'A burst of colour hanging in black' },
  { id: 'frame', name: 'Neon Frame', blurb: 'A black window in a lit border' },
  { id: 'shatter', name: 'Shard Burst', blurb: 'Fragments flung from a vortex' },
  { id: 'shatter-storm', name: 'Shard Burst · Storm', blurb: 'A dense, swirling storm of shards' },
  { id: 'shatter-drift', name: 'Shard Burst · Drift', blurb: 'A few long shards drifting from a glow' },
  { id: 'shatter-colour', name: 'Shard Burst · Colour', blurb: 'Shards in your colours rather than white' },
  { id: 'fracture', name: 'Fracture', blurb: 'A crack network, white on black' },
  { id: 'orbit', name: 'Orbit', blurb: 'A moon, its ring and drifting debris' },
  { id: 'glyphs', name: 'Glyph Score', blurb: 'The real melody as a row of glyphs' },
];

interface ClassicDesign {
  palette: { base: Lch; accent: Lch; ground: 'light' | 'dark' | null };
  mood: SongMood;
  melody: MelodyNote[];
  showTitle: boolean;
  title: string;
}

interface Env {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Width in frame units. */
  A: number;
  random: Random;
  noise: NoiseField;
  detail: NoiseField;
  design: ClassicDesign;
  fieldScale: number;
  /** The shapes' colour was typed by the user and is used as it is. */
  exactMain: boolean;
  exactAccent: boolean;
  /** A typed black, white or grey main colour, as the background. */
  groundOverride: [Rgb8, Rgb8] | null;
  /** The variation picked, if any: fixes a choice the design would otherwise roll. */
  variant: string | null;
  /**
   * How many leading colours of a style's first raster are its background.
   * When a custom gradient is set they are left transparent, so the gradient
   * painted underneath shows through.
   */
  clearGround: number;
}

/**
 * How well each classic suits a song, 0–100. Glyph Score needs a melody to
 * draw, so it is ruled out when the song has none.
 */
export function rankClassics(mood: SongMood, melodyNotes: number): Array<{ id: ClassicId; fit: number }> {
  const e = mood.energy;
  const v = mood.valence;
  const t = mood.tension;
  const d = mood.density;
  const a = mood.ambience;
  const p = mood.percussive;
  const scores: Record<BaseClassicId, number> = {
    wash: 0.85 - 1.0 * Math.abs(e - 0.4) - 0.4 * t + 0.2 * a + 0.1 * v,
    stain: 0.2 + 0.5 * (1 - e) + 0.5 * (1 - v) - 0.35 * p - 0.15 * d,
    rift: 0.05 + 0.75 * e + 0.6 * (1 - v) + 0.3 * t - 0.25 * a,
    frame: 0.0 + 0.7 * e + 0.55 * p + 0.3 * v - 0.4 * a,
    shatter: -0.4 + 1.05 * e + 0.5 * d + 0.25 * t + 0.2 * p,
    fracture: -0.15 + 1.1 * t + 0.4 * (1 - v) + 0.2 * e - 0.2 * a,
    orbit: 0.08 + 0.8 * a + 0.5 * (1 - e) + 0.15 * v - 0.35 * p,
    glyphs:
      melodyNotes >= 10 ? 0.0 + 0.45 * (1 - d) + 0.45 * mood.keysShare + 0.3 * mood.keyClarity - 0.3 * p - 0.3 * a : -1,
  };
  return (Object.keys(scores) as BaseClassicId[])
    .map((id) => ({ id, fit: Math.round(clamp((scores[id] + 0.15) / 1.25, 0, 1) * 100) }))
    .sort((x, y) => y.fit - x.fit);
}

/** Paints one classic design and says where the title belongs on it. */
export function renderClassicArt(
  ctx: CanvasRenderingContext2D,
  design: ThumbnailDesign,
  style: ClassicId,
  width: number,
  height: number,
  fieldHeight: number,
): TextZone {
  const palette = design.palette;
  // A typed black, white or grey main colour can't be a shape's colour on
  // these designs' grounds, so it becomes the ground and the accent leads.
  const shade = palette.exactMain && palette.base.c < 0.035;
  const tone = design.recipe.tone;
  const classic: ClassicDesign = {
    palette: {
      base: shade ? palette.accent : palette.base,
      accent: palette.accent,
      ground: shade ? (palette.base.l < 0.5 ? 'dark' : 'light') : tone === 'colour' ? null : tone,
    },
    mood: design.mood,
    melody: design.material.melody,
    showTitle: design.showTitle,
    title: design.title,
  };
  const env: Env = {
    ctx,
    W: width,
    H: height,
    A: width / height,
    random: createRandom(mixSeed(design.seed, 3)),
    noise: new NoiseField(mixSeed(design.seed, 1)),
    detail: new NoiseField(mixSeed(design.seed, 2)),
    design: classic,
    fieldScale: clamp(fieldHeight / height, 0.2, 1),
    exactMain: shade ? palette.exactAccent : palette.exactMain,
    exactAccent: palette.exactAccent,
    variant: style.includes('-') ? style.split('-')[1] : null,
    clearGround: 0,
    groundOverride: shade
      ? [lchToRgb(palette.base), lchToRgb(shift(palette.base, palette.base.l < 0.5 ? 0.025 : -0.015))]
      : null,
  };
  // A gradient you set replaces the design's own background. Colour Field is
  // all background, so it keeps its own.
  const base = style.split('-')[0];
  if (palette.gradient.length >= 2 && base !== 'wash') {
    const kit = createEnv(ctx, design, width, height, fieldHeight);
    composeRaster(kit, [groundLayer(kit, 'gradient')]);
    env.clearGround = base === 'fracture' ? 1 : 2;
  }

  ctx.save();
  const zone = STYLE_RENDERERS[style](env);
  ctx.restore();
  return zone;
}

/** The colour a style derived for its main shape, unless the user typed one. */
function mainColour(env: Env, derived: Lch): Lch {
  return env.exactMain ? env.design.palette.base : derived;
}

/** The colour a style derived for its accent, unless the user typed one. */
function accentColour(env: Env, derived: Lch): Lch {
  return env.exactAccent ? env.design.palette.accent : derived;
}

/** A style's ground pair, or the typed black/white main colour. */
function groundFor(env: Env, dark: boolean): [Rgb8, Rgb8] {
  return env.groundOverride ?? groundPair(env.design.palette.base.h, dark);
}

const STYLE_RENDERERS: Record<ClassicId, (env: Env) => TextZone> = {
  wash: drawWash,
  stain: drawStain,
  rift: drawRift,
  frame: drawFrame,
  'stain-streak': drawStain,
  'stain-island': drawStain,
  'stain-corner': drawStain,
  'rift-tear': drawRift,
  'rift-mass': drawRift,
  'rift-splash': drawRift,
  shatter: drawShatter,
  'shatter-storm': drawShatter,
  'shatter-drift': drawShatter,
  'shatter-colour': drawShatter,
  fracture: drawFracture,
  orbit: drawOrbit,
  glyphs: drawGlyphs,
};

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

type Field = (x: number, y: number) => number;

/**
 * Fills the frame from a per-pixel sampler that returns a palette index.
 * Posterising to a handful of flat colours is the look; the faceted high noise
 * octaves keep the boundaries between them ragged rather than smooth.
 */
function rasterize(env: Env, colors: Rgb8[], sample: Field): void {
  const fw = Math.max(2, Math.round(env.W * env.fieldScale));
  const fh = Math.max(2, Math.round(env.H * env.fieldScale));
  const field = document.createElement('canvas');
  field.width = fw;
  field.height = fh;
  const fctx = field.getContext('2d');
  if (!fctx) return;
  const image = fctx.createImageData(fw, fh);
  const data = image.data;
  const lut = new Uint8Array(colors.length * 3);
  colors.forEach((color, i) => {
    lut[i * 3] = color.r;
    lut[i * 3 + 1] = color.g;
    lut[i * 3 + 2] = color.b;
  });
  const last = colors.length - 1;

  for (let j = 0; j < fh; j++) {
    const y = (j + 0.5) / fh;
    let o = j * fw * 4;
    for (let i = 0; i < fw; i++) {
      const index = Math.min(Math.max(sample(((i + 0.5) / fw) * env.A, y) | 0, 0), last);
      const k = index * 3;
      data[o] = lut[k];
      data[o + 1] = lut[k + 1];
      data[o + 2] = lut[k + 2];
      data[o + 3] = index < env.clearGround ? 0 : 255;
      o += 4;
    }
  }
  fctx.putImageData(image, 0, 0);
  // Only the first raster carries the background.
  env.clearGround = 0;
  env.ctx.imageSmoothingEnabled = true;
  env.ctx.imageSmoothingQuality = 'high';
  env.ctx.drawImage(field, 0, 0, env.W, env.H);
  field.width = 0;
  field.height = 0;
}

/**
 * Thresholds at the given area fractions of a field, measured on a coarse
 * grid. Lets a style say "the lightest cloud covers 6% of the frame" whatever
 * the noise happened to do for this seed.
 */
function quantiles(env: Env, field: Field, fractions: number[]): number[] {
  const values: number[] = [];
  const cols = 96;
  const rows = 54;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) values.push(field(((i + 0.5) / cols) * env.A, (j + 0.5) / rows));
  }
  values.sort((a, b) => a - b);
  return fractions.map((q) => values[Math.min(values.length - 1, Math.floor(q * values.length))]);
}

function level(value: number, thresholds: number[]): number {
  let k = 0;
  while (k < thresholds.length && value >= thresholds[k]) k++;
  return k;
}

/** Paper or void, each with a faint second tone for texture. */
function groundPair(hue: number, dark: boolean): [Rgb8, Rgb8] {
  return dark
    ? [oklch(0.105, 0.012, hue), oklch(0.125, 0.016, hue)]
    : [oklch(0.968, 0.008, hue), oklch(0.955, 0.012, hue)];
}

function paperField(env: Env): Field {
  return (x, y) => env.noise.fbm(x * 1.7 + 31.3, y * 1.7 - 12.1, 5, 0.55, 2);
}

interface Bloom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  /** Large-scale raggedness of the outline. */
  warp: number;
  /** Fine, faceted raggedness. */
  detail: number;
}

/** Positive inside a ragged elliptical bloom, zero at its edge. */
function blobField(env: Env, blob: Bloom): Field {
  const cos = Math.cos(blob.angle);
  const sin = Math.sin(blob.angle);
  return (x, y) => {
    const dx = x - blob.cx;
    const dy = y - blob.cy;
    const lx = (dx * cos + dy * sin) / blob.rx;
    const ly = (-dx * sin + dy * cos) / blob.ry;
    const q = Math.sqrt(lx * lx + ly * ly);
    const warp = (env.noise.fbm(x * 2.1 + 4.4, y * 2.1 - 8.2, 5, 0.58, 2) - 0.5) * blob.warp;
    const fine = (env.detail.fbm(x * 8.5, y * 8.5, 3, 0.55, 0) - 0.5) * blob.detail;
    return 1 - q + warp + fine;
  };
}

function mirrorBlob(env: Env, blob: Bloom): Bloom {
  return { ...blob, cx: env.A - blob.cx, angle: -blob.angle };
}

/**
 * Puts the title on the far side of the focal point. Never bottom-right:
 * YouTube lays the duration badge over that corner.
 */
function zoneAwayFrom(env: Env, fx: number, fy: number, maxWidth = 0.5): TextZone {
  const textLeft = fx >= env.A / 2;
  if (!textLeft) return { align: 'right', vertical: 'top', maxWidth, inset: 0 };
  return { align: 'left', vertical: fy < 0.42 ? 'bottom' : fy > 0.62 ? 'top' : 'bottom', maxWidth, inset: 0 };
}

/** Rough rectangle the title will occupy, in frame units, so busy styles can leave it clear. */
function zoneRect(env: Env, zone: TextZone): { x0: number; x1: number; y0: number; y1: number } {
  const margin = 0.06 + zone.inset;
  const w = zone.maxWidth * env.A;
  const h = 0.3;
  const x0 = zone.align === 'left' ? margin : zone.align === 'right' ? env.A - margin - w : (env.A - w) / 2;
  const y0 = zone.vertical === 'top' ? margin : zone.vertical === 'bottom' ? 1 - margin - h : (zone.y ?? 0.5) - h / 2;
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** One colour, with soft stepped clouds and a lighter band drifting across it. */
function drawWash(env: Env): TextZone {
  const { design, random, noise, detail } = env;
  const base = design.palette.base;
  // Close steps: the clouds should read as texture in one colour, not as a map.
  const colors = [
    shift(base, -0.028, 1.02, -2),
    base,
    shift(base, 0.022, 0.96, 2),
    shift(base, 0.045, 0.9, 4),
    shift(base, 0.085, 0.72, 7),
  ].map(lchToRgb);

  const angle = random.range(-0.42, 0.18);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const bandCentre = random.range(0.3, 0.7);
  const bandWidth = random.range(0.1, 0.18);
  const bandGain = random.range(0.1, 0.2);
  const warp = 0.7 + design.mood.ambience * 0.7;
  const midX = env.A / 2;

  const field: Field = (x, y) => {
    const wx = noise.fbm(x * 0.9 + 5.2, y * 0.9 + 1.3, 3) - 0.5;
    const wy = noise.fbm(x * 0.9 - 3.1, y * 0.9 + 7.7, 3) - 0.5;
    const cloud = noise.fbm((x + wx * warp) * 1.5, (y + wy * warp) * 1.5, 6, 0.56, 3);
    const across = -sin * (x - midX) + cos * (y - 0.5) + 0.5;
    const band = Math.exp(-((across - bandCentre) ** 2) / (bandWidth * bandWidth));
    return cloud + band * bandGain + (detail.fbm(x * 10, y * 10, 2, 0.5, 0) - 0.5) * 0.04;
  };
  const thresholds = quantiles(env, field, [0.07, 0.78, 0.9, 0.965]);
  rasterize(env, colors, (x, y) => level(field(x, y), thresholds));

  // No focal point here, so the title is the subject.
  return design.title.length <= 22 && random.chance(0.5)
    ? { align: 'center', vertical: 'middle', maxWidth: 0.78, inset: 0 }
    : { align: 'left', vertical: 'bottom', maxWidth: 0.62, inset: 0 };
}

/** A single ragged ink bloom on pale paper, darker at its heart, with stray drops. */
function drawStain(env: Env): TextZone {
  const { design, random, detail } = env;
  const base = design.palette.base;
  const mood = design.mood;
  const rolled = random.pick(mood.energy > 0.5 ? ['streak', 'streak', 'island', 'corner'] : ['island', 'corner', 'streak']);
  const kind = env.variant ?? rolled;

  let blob: Bloom =
    kind === 'streak'
      ? {
          cx: env.A * random.range(0.6, 0.7),
          cy: random.range(0.42, 0.55),
          rx: random.range(0.5, 0.64),
          ry: random.range(0.12, 0.17),
          angle: random.range(-0.65, -0.35),
          warp: 1.4,
          detail: 0.35,
        }
      : kind === 'island'
        ? {
            cx: env.A * random.range(0.6, 0.68),
            cy: random.range(0.45, 0.55),
            rx: random.range(0.3, 0.38),
            ry: random.range(0.25, 0.31),
            angle: random.range(-0.5, 0.5),
            warp: 1.6,
            detail: 0.4,
          }
        : {
            cx: env.A * random.range(0.84, 0.95),
            cy: random.range(0.06, 0.2),
            rx: random.range(0.58, 0.7),
            ry: random.range(0.38, 0.46),
            angle: random.range(-0.6, -0.2),
            warp: 1.5,
            detail: 0.35,
          };
  if (random.chance(0.3)) blob = mirrorBlob(env, blob);

  const [paper, paper2] = groundFor(env, false);
  const warm = isWarmHue(base.h);
  const body: Lch = mainColour(env, { l: clamp(base.l - 0.12, warm ? 0.64 : 0.42, warm ? 0.74 : 0.62), c: base.c * 1.05 + 0.02, h: base.h });
  // A dark heart reads as ink in reds, blues and greens; in ambers it reads as
  // coffee, so warm blooms (and happy songs) brighten toward the centre instead.
  const core: Lch =
    mood.valence > 0.55 || warm
      ? shift(body, 0.07, 0.85, 4)
      : { l: 0.32, c: base.c * 1.1 + 0.02, h: base.h - 6 };
  const colors = [
    paper,
    paper2,
    oklch(0.9, base.c * 0.3, base.h),
    oklch(0.8, base.c * 0.55, base.h + 4),
    lchToRgb(body),
    lchToRgb(core),
  ];

  const bloom = blobField(env, blob);
  const paperTex = paperField(env);
  const [paperT] = quantiles(env, paperTex, [0.72]);

  rasterize(env, colors, (x, y) => {
    const f = bloom(x, y);
    if (f > 0.5) return 5;
    if (f > 0.22) return 4;
    if (f > 0.06) return 3;
    if (f > -0.06 && detail.value(x * 34, y * 34, true) > 0.55) return 2;
    if (f > -0.28 && detail.fbm(x * 15 + 3.3, y * 15 - 1.7, 3, 0.5, 0) > 0.8 - (f + 0.28) * 0.14) return 4;
    return paperTex(x, y) > paperT ? 1 : 0;
  });

  return zoneAwayFrom(env, blob.cx, blob.cy);
}

/** A vivid ragged tear through black, sometimes ringed with thin white arcs. */
function drawRift(env: Env): TextZone {
  const { design, random, detail } = env;
  const base = design.palette.base;
  const rolled = random.pick(['tear', 'mass', 'splash']);
  const kind = env.variant ?? rolled;

  let blob: Bloom =
    kind === 'tear'
      ? {
          cx: env.A * random.range(0.62, 0.74),
          cy: random.range(0.3, 0.42),
          rx: random.range(0.7, 0.85),
          ry: random.range(0.12, 0.18),
          angle: random.range(-0.62, -0.4),
          warp: 1.5,
          detail: 0.35,
        }
      : kind === 'mass'
        ? {
            cx: env.A * random.range(0.66, 0.76),
            cy: random.range(0.95, 1.05),
            rx: random.range(0.55, 0.68),
            ry: random.range(0.42, 0.5),
            angle: random.range(-0.35, -0.1),
            warp: 1.7,
            detail: 0.4,
          }
        : {
            cx: env.A * random.range(0.62, 0.7),
            cy: random.range(0.44, 0.56),
            rx: random.range(0.32, 0.42),
            ry: random.range(0.22, 0.3),
            angle: random.range(-0.7, 0.7),
            warp: 1.9,
            detail: 0.45,
          };
  if (random.chance(0.25)) blob = mirrorBlob(env, blob);

  // Reds lighten into salmon and ambers darken into rust; each family has its own vivid lightness.
  const red = base.h >= 330 || base.h <= 40;
  const vividL = isWarmHue(base.h) ? 0.78 : red ? 0.58 : 0.66;
  const vivid: Lch = mainColour(env, { l: vividL + design.mood.valence * 0.1, c: Math.max(0.16, base.c * 1.3), h: base.h });
  const [voidColor, void2] = groundFor(env, true);
  const colors = [
    voidColor,
    void2,
    oklch(0.22, vivid.c * 0.45, base.h),
    lchToRgb(vivid),
    lchToRgb(shift(vivid, 0.06, 0.88, 7)),
  ];

  const tear = blobField(env, blob);
  const groundTex = paperField(env);
  const [groundT] = quantiles(env, groundTex, [0.75]);

  rasterize(env, colors, (x, y) => {
    const f = tear(x, y);
    // Flat colour, with only the odd fleck of a lighter tone near the edge.
    if (f > 0 && f < 0.12 && detail.value(x * 22, y * 22, true) > 0.78) return 4;
    if (f > 0) return 3;
    if (f > -0.08 && detail.value(x * 30, y * 30, true) > 0.6) return 2;
    if (f > -0.3 && detail.fbm(x * 16 - 5.1, y * 16 + 2.2, 3, 0.5, 0) > 0.81 - (f + 0.3) * 0.14) return 3;
    return groundTex(x, y) > groundT ? 1 : 0;
  });

  if (design.mood.tension > 0.35 || random.chance(0.45)) drawEdgeArcs(env, tear, blob, random.int(3, 5));
  return zoneAwayFrom(env, blob.cx, Math.min(blob.cy, 0.75));
}

/** Thin white circle arcs hung on the outline of the main shape (not its stray drops). */
function drawEdgeArcs(env: Env, field: Field, shape: Bloom, count: number): void {
  const { ctx, random, H, A } = env;
  const points: Array<{ x: number; y: number }> = [];
  for (let attempt = 0; attempt < 2500 && points.length < count; attempt++) {
    const x = random.range(0.08, A - 0.08);
    const y = random.range(0.08, 0.92);
    if (Math.abs(field(x, y)) > 0.025) continue;
    // A step toward the centre must land well inside, or this is a droplet's edge.
    const toward = Math.hypot(shape.cx - x, shape.cy - y) || 1;
    if (field(x + ((shape.cx - x) / toward) * 0.06, y + ((shape.cy - y) / toward) * 0.06) < 0.05) continue;
    if (points.some((p) => Math.hypot(p.x - x, p.y - y) < 0.2)) continue;
    points.push({ x, y });
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.lineWidth = Math.max(1, 0.0028 * H);
  ctx.lineCap = 'round';
  for (const p of points) {
    const radius = random.range(0.06, 0.16) * H;
    const start = random.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.arc(p.x * H, p.y * H, radius, start, start + random.range(2.2, 4.6));
    ctx.stroke();
  }
  ctx.restore();
}

/** A black window inside a lit double border, its colour clouded like the washes. */
function drawFrame(env: Env): TextZone {
  const { ctx, design, random, noise, W, H, A } = env;
  const base = design.palette.base;
  const lit: Lch = mainColour(env, { l: 0.68, c: Math.max(0.17, base.c * 1.3), h: base.h });
  const colors = [
    ...(env.groundOverride ?? [oklch(0.055, 0.008, base.h), oklch(0.07, 0.012, base.h)]),
    lchToRgb(shift(lit, -0.07, 1.04, -10)),
    lchToRgb(lit),
    lchToRgb(shift(lit, 0.06, 0.95, 10)),
    lchToRgb(shift(lit, 0.13, 0.78, 20)),
  ];

  const margin = random.range(0.065, 0.085);
  const band = random.range(0.026, 0.034);
  const gap = band * random.range(0.4, 0.55);
  const line = band * random.range(0.26, 0.34);
  const inner = band + gap + line;
  const tilt = random.range(0.3, 0.7);

  const glow: Field = (x, y) =>
    (x / A) * tilt + y * (1 - tilt) + (noise.fbm(x * 3, y * 3, 5, 0.55, 2) - 0.5) * 0.9;
  const thresholds = quantiles(env, glow, [0.3, 0.64, 0.88]);
  const groundTex = paperField(env);
  const [groundT] = quantiles(env, groundTex, [0.8]);

  rasterize(env, colors, (x, y) => {
    const d = Math.min(x - margin, A - margin - x, y - margin, 1 - margin - y);
    if (d >= 0 && (d < band || (d >= band + gap && d < inner))) return 2 + level(glow(x, y), thresholds);
    return groundTex(x, y) > groundT ? 1 : 0;
  });

  // Light spill: stroke just outside a clip so only the blur lands inside.
  const spill = lchCss(lit, 0.55);
  const outer = { x: margin * H, y: margin * H, w: W - 2 * margin * H, h: H - 2 * margin * H };
  ctx.save();
  ctx.beginPath();
  ctx.rect(outer.x + inner * H, outer.y + inner * H, outer.w - 2 * inner * H, outer.h - 2 * inner * H);
  ctx.clip();
  ctx.shadowColor = spill;
  ctx.shadowBlur = 0.06 * H;
  ctx.strokeStyle = spill;
  ctx.lineWidth = 0.01 * H;
  const s = (inner - 0.006) * H;
  ctx.strokeRect(outer.x + s, outer.y + s, outer.w - 2 * s, outer.h - 2 * s);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(outer.x, outer.y, outer.w, outer.h);
  ctx.clip('evenodd');
  ctx.shadowColor = spill;
  ctx.shadowBlur = 0.05 * H;
  ctx.strokeStyle = spill;
  ctx.lineWidth = 0.01 * H;
  ctx.strokeRect(outer.x + 0.006 * H, outer.y + 0.006 * H, outer.w - 0.012 * H, outer.h - 0.012 * H);
  ctx.restore();

  return { align: 'center', vertical: 'middle', maxWidth: 0.72, inset: margin + inner };
}

/** Shards flung outward from a vortex, small and dense at the eye, long at the rim. */
function drawShatter(env: Env): TextZone {
  const { ctx, design, random, noise, W, H, A } = env;
  const accent = design.palette.accent;
  const mood = design.mood;

  const [ground, ground2] = groundFor(env, true);
  const groundTex = paperField(env);
  const [groundT] = quantiles(env, groundTex, [0.78]);
  rasterize(env, [ground, ground2], (x, y) => (groundTex(x, y) > groundT ? 1 : 0));

  let cx = A * random.range(0.6, 0.7);
  const cy = random.range(0.4, 0.58);
  if (random.chance(0.25)) cx = A - cx;
  const zone = zoneAwayFrom(env, cx, cy, 0.46);
  const quiet = zoneRect(env, zone);

  const eye = ctx.createRadialGradient(cx * H, cy * H, 0, cx * H, cy * H, 0.42 * H);
  eye.addColorStop(0, lchCss(accent, 0.36));
  eye.addColorStop(1, lchCss(accent, 0));
  ctx.fillStyle = eye;
  ctx.fillRect(0, 0, W, H);

  const [voidT] = quantiles(env, (x, y) => noise.fbm(x * 1.3 + 7, y * 1.3, 4), [0.22]);
  const variant = env.variant;
  const countScale = variant === 'storm' ? 1.9 : variant === 'drift' ? 0.32 : 1;
  const count = Math.round((420 + mood.density * 650 + mood.energy * 350) * countScale);
  const reach = Math.hypot(Math.max(cx, A - cx), Math.max(cy, 1 - cy)) * 1.05;
  const tintChance = variant === 'colour' ? 0.75 : 0.1 + mood.tension * 0.12;
  const swirlRoll = random.range(-0.9, 0.9);
  const swirl = variant === 'storm' ? Math.sign(swirlRoll || 1) * (1.3 + Math.abs(swirlRoll)) : variant === 'drift' ? swirlRoll * 0.15 : swirlRoll;
  const lengthScale = variant === 'drift' ? 1.9 : variant === 'storm' ? 1.2 : 1;

  ctx.save();
  for (let i = 0; i < count; i++) {
    const r = Math.pow(random.next(), 1.5) * reach;
    const theta = random.range(0, Math.PI * 2) + r * swirl;
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r;
    // Draw every random number before any early exit, so a different frame size never reshuffles the rest.
    const lengthRoll = random.range(0.4, 1.35);
    const widthRoll = random.range(0.16, 0.36);
    const alphaRoll = random.next();
    const tint = random.chance(tintChance);
    const skew = random.range(-0.25, 0.25);
    if (x < -0.1 || x > A + 0.1 || y < -0.1 || y > 1.1) continue;
    if (r > 0.12 && noise.fbm(x * 1.3 + 7, y * 1.3, 4) < voidT) continue;
    if (x > quiet.x0 && x < quiet.x1 && y > quiet.y0 && y < quiet.y1 && alphaRoll > 0.08) continue;

    const length = (0.005 + r * 0.1) * lengthRoll * lengthScale;
    const width = length * widthRoll * (variant === 'drift' ? 0.6 : 1);
    const direction = theta + skew * 0.4;
    const dx = Math.cos(direction);
    const dy = Math.sin(direction);
    const px = -dy;
    const py = dx;
    const alpha = (0.3 + 0.7 * alphaRoll) * (r < 0.06 ? 0.6 : 1);

    ctx.fillStyle = tint ? lchCss(accentColour(env, { l: 0.78, c: accent.c, h: accent.h }), alpha) : `rgba(245, 246, 248, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo((x + dx * length * 0.5) * H, (y + dy * length * 0.5) * H);
    ctx.lineTo((x - dx * length * 0.1 + px * width * 0.5) * H, (y - dy * length * 0.1 + py * width * 0.5) * H);
    ctx.lineTo((x - dx * length * 0.5) * H, (y - dy * length * 0.5) * H);
    ctx.lineTo((x - dx * length * 0.05 - px * width * 0.5) * H, (y - dy * length * 0.05 - py * width * 0.5) * H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (random.chance(0.5)) {
    const inset = 0.045 * H;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(1, 0.0024 * H);
    ctx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
  }
  return zone;
}

/** A white crack network over black, a few cells lit in the song's colour. */
function drawFracture(env: Env): TextZone {
  const { ctx, design, random, noise, detail, W, H, A } = env;
  const base = design.palette.base;
  const accent = design.palette.accent;
  const mood = design.mood;

  let cx = A * random.range(0.58, 0.66);
  if (random.chance(0.25)) cx = A - cx;
  const region: Bloom = {
    cx,
    cy: random.range(0.45, 0.55),
    rx: A * random.range(0.3, 0.36),
    ry: random.range(0.38, 0.46),
    angle: random.range(-0.4, 0.4),
    warp: 1.3,
    detail: 0.2,
  };
  const mask = blobField(env, region);
  const scale = 7 + mood.density * 4 + random.range(0, 1.5);
  // A few lit cells give the network its colour; many turn it into stained glass.
  const fillChance = 0.03 + mood.tension * 0.03;
  const cell: CellSample = { f1: 0, f2: 0, id: 0 };

  const zone: TextZone = { ...zoneAwayFrom(env, cx, region.cy, 0.44), inset: 0.02 };
  const quiet = zoneRect(env, zone);
  // How far a point sits outside the title's rectangle (0 inside it).
  const clearance = (x: number, y: number) =>
    Math.hypot(Math.max(quiet.x0 - x, 0, x - quiet.x1), Math.max(quiet.y0 - y, 0, y - quiet.y1));

  const colors = [
    env.groundOverride?.[0] ?? oklch(0.06, 0.008, base.h),
    { r: 244, g: 245, b: 247 },
    lchToRgb(mainColour(env, { l: 0.7, c: Math.max(0.14, base.c * 1.2), h: base.h })),
    lchToRgb(accentColour(env, { l: 0.66, c: Math.max(0.12, accent.c), h: accent.h })),
  ];

  rasterize(env, colors, (x, y) => {
    let m = mask(x, y);
    if (m < -0.15) return 0;
    // The cracks run out before they reach the title, along a ragged edge.
    m = Math.min(m, clearance(x, y) * 3 - 0.3 + (detail.fbm(x * 4, y * 4, 3) - 0.5) * 0.2);
    if (m < -0.15) return 0;
    const wx = x + (noise.fbm(x * 1.5 + 2.2, y * 1.5, 4) - 0.5) * 0.45;
    const wy = y + (noise.fbm(x * 1.5, y * 1.5 + 9.1, 4) - 0.5) * 0.45;
    noise.cellular(wx * scale, wy * scale, cell);
    const width = 0.035 + 0.055 * detail.fbm(x * 3, y * 3, 3, 0.5, 1);
    const edge = cell.f2 - cell.f1;
    if (m < 0) return edge < width * 0.55 && detail.fbm(x * 6, y * 6, 2) > 0.55 ? 1 : 0;
    if (edge < width) return 1;
    if (cell.id < fillChance) return cell.id < fillChance * 0.45 ? 3 : 2;
    return 0;
  });

  const inset = 0.045 * H;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = Math.max(1, 0.0026 * H);
  ctx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
  return zone;
}

/** A moon with stepped shading, shedding fragments, sometimes wearing a ring. */
function drawOrbit(env: Env): TextZone {
  const { ctx, design, random, noise, detail, H, A } = env;
  const base = design.palette.base;
  const accent = design.palette.accent;
  const mood = design.mood;
  const dark = design.palette.ground === 'dark' || (design.palette.ground !== 'light' && mood.valence < 0.45);

  let cx = A * random.range(0.6, 0.68);
  const cy = random.range(0.44, 0.54);
  if (random.chance(0.25)) cx = A - cx;
  const radius = random.range(0.24, 0.3);
  const streamAngle = random.range(0.2, 1.2) * (cx > A / 2 ? 1 : -1) + (cx > A / 2 ? 0 : Math.PI);
  const sdx = Math.cos(streamAngle);
  const sdy = Math.sin(streamAngle);

  const moon: Lch = mainColour(env, dark
    ? { l: 0.62, c: Math.max(0.1, base.c), h: base.h }
    : isWarmHue(base.h)
      ? { l: 0.68, c: Math.max(0.13, base.c * 1.2), h: base.h }
      : { l: 0.36, c: Math.max(0.1, base.c * 1.1), h: base.h });
  const [ground, ground2] = groundFor(env, dark);
  const colors = [ground, ground2, lchToRgb(shift(moon, -0.12, 1.05, -8)), lchToRgb(moon), lchToRgb(shift(moon, 0.14, 0.8, 10))];

  const groundTex = paperField(env);
  const [groundT] = quantiles(env, groundTex, [0.74]);
  const lx = -0.55;
  const ly = -0.6;
  const lz = 0.58;

  rasterize(env, colors, (x, y) => {
    const dx = (x - cx) / radius;
    const dy = (y - cy) / radius;
    const r = Math.sqrt(dx * dx + dy * dy);
    const rim = 1 + (detail.fbm(x * 12, y * 12, 3, 0.5, 0) - 0.5) * 0.09;
    if (r < rim) {
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(r, 1) ** 2));
      const light = dx * lx + dy * ly + nz * lz;
      const value = light * 0.7 + (noise.fbm(x * 4.5, y * 4.5, 5, 0.55, 2) - 0.5) * 1.1;
      return value < 0.02 ? 2 : value < 0.5 ? 3 : 4;
    }
    // Debris drifting off along the stream direction.
    const ox = x - cx;
    const oy = y - cy;
    const along = ox * sdx + oy * sdy;
    const across = -ox * sdy + oy * sdx;
    if (along > radius * 0.6) {
      const spread = 0.08 + (along - radius) * 0.35;
      const stream = Math.exp(-(across * across) / (spread * spread)) * Math.exp(-Math.max(along - radius, 0) / 0.55);
      if (stream * detail.fbm(x * 18, y * 18, 3, 0.5, 0) > 0.42 - stream * 0.12) return along < radius * 1.5 ? 3 : 2;
    }
    return groundTex(x, y) > groundT ? 1 : 0;
  });

  if (dark || random.chance(0.45)) {
    const rx = radius * random.range(1.65, 1.9) * H;
    const ry = radius * random.range(0.26, 0.36) * H;
    const tilt = random.range(-0.38, -0.12) * (cx > A / 2 ? 1 : -1);
    const ringColor = dark ? 'rgba(248, 248, 252, 0.92)' : lchCss({ l: 0.45, c: accent.c, h: accent.h }, 0.9);
    const glowColor = lchCss(accent, dark ? 0.8 : 0.35);
    const drawRing = (from: number, to: number) => {
      ctx.beginPath();
      ctx.ellipse(cx * H, cy * H, rx, ry, tilt, from, to);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineWidth = Math.max(1.2, 0.0045 * H);
    ctx.strokeStyle = ringColor;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 0.025 * H;
    // The far half of the ring passes behind the moon.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, env.W, H);
    ctx.arc(cx * H, cy * H, radius * H * 1.01, 0, Math.PI * 2);
    ctx.clip('evenodd');
    drawRing(Math.PI, Math.PI * 2);
    ctx.restore();
    drawRing(0, Math.PI);
    ctx.restore();
  }

  return zoneAwayFrom(env, cx, cy, 0.46);
}

/**
 * The song's own melody, written as a row of glyphs in a thin frame: loud
 * notes solid, soft ones hollow, long ones larger, downbeats boxed.
 */
function drawGlyphs(env: Env): TextZone {
  const { ctx, design, random, H, A, W } = env;
  const accent = design.palette.accent;
  const [ground, ground2] = groundFor(env, true);
  const groundTex = paperField(env);
  const [groundT] = quantiles(env, groundTex, [0.8]);
  rasterize(env, [ground, ground2], (x, y) => (groundTex(x, y) > groundT ? 1 : 0));

  const inset = 0.055;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = Math.max(1, 0.0026 * H);
  ctx.strokeRect(inset * H, inset * H, W - 2 * inset * H, H - 2 * inset * H);

  const notes = design.melody;
  if (!notes.length) return { align: 'center', vertical: 'middle', maxWidth: 0.7, inset };

  const rows = notes.length > 24 ? 3 : notes.length > 12 ? 2 : 1;
  const cols = Math.ceil(notes.length / rows);
  const left = inset + 0.09;
  const right = A - inset - 0.09;
  const top = design.showTitle ? 0.2 : 0.26;
  const bottom = design.showTitle ? 0.6 : 0.74;
  const rowHeight = (bottom - top) / rows;
  const cell = (right - left) / Math.max(cols - 1, 1);
  const glyph = Math.min(cell * 0.3, rowHeight * 0.22, 0.04);
  const ink = 'rgba(246, 247, 250, 0.95)';
  const lit = lchCss(accentColour(env, { l: 0.76, c: Math.max(0.14, accent.c), h: accent.h }));
  const lineWidth = Math.max(1, 0.0026 * H);

  for (let row = 0; row < rows; row++) {
    const slice = notes.slice(row * cols, (row + 1) * cols);
    if (!slice.length) continue;
    const pitches = slice.map((note) => note.pitch).sort((a, b) => a - b);
    const median = pitches[Math.floor(pitches.length / 2)];
    const loudest = slice.reduce((best, note, i) => (note.velocity > slice[best].velocity ? i : best), 0);
    const centreY = top + rowHeight * (row + 0.5);
    const positions = slice.map((note, i) => ({
      x: left + i * cell,
      y: centreY - clamp((note.pitch - median) / 12, -1, 1) * rowHeight * 0.26,
    }));

    ctx.strokeStyle = 'rgba(246, 247, 250, 0.4)';
    ctx.lineWidth = lineWidth * 0.8;
    ctx.beginPath();
    positions.forEach((p, i) => (i ? ctx.lineTo(p.x * H, p.y * H) : ctx.moveTo(p.x * H, p.y * H)));
    ctx.stroke();

    slice.forEach((note, i) => {
      const { x, y } = positions[i];
      const r = glyph * (0.55 + 0.45 * note.length) * H;
      const colour = i === loudest ? lit : ink;
      // Clear the connecting line behind the glyph.
      ctx.fillStyle = rgbCss(ground);
      ctx.beginPath();
      ctx.arc(x * H, y * H, r * 1.25, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = lineWidth;
      if (note.velocity > 0.78) {
        ctx.beginPath();
        ctx.arc(x * H, y * H, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x * H, y * H, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (note.velocity > 0.55) {
        ctx.beginPath();
        ctx.arc(x * H, y * H, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x * H, y * H, Math.max(r * 0.2, lineWidth), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x * H, y * H, r * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (note.downbeat) {
        const box = r * 1.45;
        ctx.lineWidth = lineWidth * 0.8;
        ctx.strokeRect(x * H - box, y * H - box, box * 2, box * 2);
      }
    });
  }

  // A few stray marks, like the scratches on a contact sheet.
  ctx.fillStyle = 'rgba(246, 247, 250, 0.5)';
  for (let i = 0; i < 3; i++) {
    const size = random.range(0.004, 0.008) * H;
    ctx.fillRect(random.range(left, right) * H, random.range(0.1, 0.16) * H, size, size);
  }

  return design.showTitle
    ? { align: 'center', vertical: 'middle', maxWidth: 0.7, inset, y: 0.76 }
    : { align: 'center', vertical: 'middle', maxWidth: 0.7, inset };
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------
