import { titleFont } from './Fonts';
import type { Random } from './Noise';
import { boxGradient } from './GradientTint';
import { createRecorder, type VectorElement } from './VectorRecorder';
import { contrastRatio, lchHex, lchToRgb, oklch, relativeLuminance, rgbCss, type Rgb8 } from './Oklch';
import type { Recipe, SubjectId } from './Recipe';
import type { ThumbnailDesign } from './ThumbnailDesign';
import { drawDetail } from './render/Details';
import { groundLayer } from './render/Grounds';
import {
  clearance,
  composeRaster,
  composeRasterAlpha,
  createEnv,
  zoneAwayFrom,
  zoneRect,
  type Env,
  type RasterLayer,
  type Rect,
  type TextZone,
} from './render/Kit';
import { buildSubject, type SubjectResult } from './render/Subjects';
import { renderClassicArt } from './classic/ClassicStyles';

export type { TextZone } from './render/Kit';

/**
 * Paints a thumbnail design at any size: background, second shape, main shape,
 * details, then the title.
 */

export interface RenderOptions {
  /** Rows of the per-pixel field. Lower is faster; the preview uses less. */
  fieldHeight?: number;
  /** Also record every drawing operation of each part as its own vector element (for the intro). */
  record?: boolean;
}


/** Art and title together — what an export writes. */
export function renderThumbnail(
  canvas: HTMLCanvasElement,
  design: ThumbnailDesign,
  width: number,
  height: number,
  options: RenderOptions = {},
): void {
  const zone = renderThumbnailArt(canvas, design, width, height, options);
  drawThumbnailTitle(canvas, design, zone);
}

/**
 * Everything the artwork depends on. The preview caches the art under this
 * key, so typing a title redraws only the text.
 */
export function thumbnailArtKey(design: ThumbnailDesign): string {
  const { mood } = design;
  return JSON.stringify([
    design.recipe,
    design.seed,
    design.palette,
    mood.energy,
    mood.valence,
    mood.tension,
    mood.density,
    mood.ambience,
    design.material.melody.length,
    design.material.activity.length,
    design.showTitle,
    design.title.length <= 22,
    Boolean(design.subtitle),
  ]);
}

/** Paints the artwork alone and says where the title belongs on it. */
export function renderThumbnailArt(
  canvas: HTMLCanvasElement,
  design: ThumbnailDesign,
  width: number,
  height: number,
  options: RenderOptions = {},
): TextZone {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a 2D context for the thumbnail.');

  const fieldHeight = options.fieldHeight ?? Math.min(height, 1080);
  const { recipe } = design;
  // The classic compositions are complete designs with their own drawing code.
  if (recipe.style !== 'layered' && recipe.style !== 'moonring') {
    return renderClassicArt(ctx, design, recipe.style, width, height, fieldHeight);
  }

  const env = createEnv(ctx, design, width, height, fieldHeight);
  const { zone, quiet, primary, secondary } = planLayered(env, design);

  ctx.save();
  const layers = [groundLayer(env, recipe.ground), secondary?.raster, primary?.raster].filter(
    (layer): layer is RasterLayer => Boolean(layer),
  );
  composeRaster(env, layers);
  primary?.draw?.();
  secondary?.draw?.();
  recipe.details.forEach((id, i) => drawDetail(env, id, env.rng(40 + i), primary, quiet));
  ctx.restore();
  return zone;
}

/** The generated parts of a design that the editor can move, resize and reorder. */
export type PartKind = 'ground' | 'secondary' | 'primary' | 'details' | 'art';

export interface ThumbPart {
  kind: PartKind;
  canvas: HTMLCanvasElement;
  /** With `record`: everything the part drew, one element per drawing operation. */
  elements?: VectorElement[];
}

/**
 * The artwork as separate layers: background, second shape, main shape and
 * details each on their own transparent canvas. A classic design is one
 * composition, so it comes back as a single layer.
 */
export function renderThumbnailParts(
  design: ThumbnailDesign,
  width: number,
  height: number,
  options: RenderOptions = {},
): { parts: ThumbPart[]; zone: TextZone } {
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  // With `record`, each part's context is wrapped so its drawing is also kept as elements.
  const recorded = new Map<HTMLCanvasElement, VectorElement[]>();
  const context = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a 2D context for the thumbnail.');
    if (!options.record) return ctx;
    const recorder = createRecorder(ctx);
    recorded.set(canvas, recorder.elements);
    return recorder.ctx;
  };
  const withElements = (parts: ThumbPart[]) => parts.map((part) => ({ ...part, elements: recorded.get(part.canvas) }));
  const fieldHeight = options.fieldHeight ?? Math.min(height, 1080);
  const { recipe } = design;

  if (recipe.style !== 'layered' && recipe.style !== 'moonring') {
    const art = make();
    const zone = renderClassicArt(context(art), design, recipe.style, width, height, fieldHeight);
    return { parts: withElements([{ kind: 'art', canvas: art }]), zone };
  }

  const ground = make();
  const env = createEnv(context(ground), design, width, height, fieldHeight);
  const { zone, quiet, primary, secondary } = planLayered(env, design);
  composeRaster(env, [groundLayer(env, recipe.ground)]);
  const parts: ThumbPart[] = [{ kind: 'ground', canvas: ground }];

  const shapeLayer = (kind: PartKind, shape: SubjectResult | null) => {
    if (!shape) return;
    const canvas = make();
    env.ctx = context(canvas);
    if (shape.raster) composeRasterAlpha(env, shape.raster);
    shape.draw?.();
    parts.push({ kind, canvas });
  };
  shapeLayer('secondary', secondary);
  shapeLayer('primary', primary);
  if (recipe.details.length) {
    const canvas = make();
    env.ctx = context(canvas);
    recipe.details.forEach((id, i) => drawDetail(env, id, env.rng(40 + i), primary, quiet));
    parts.push({ kind: 'details', canvas });
  }
  return { parts: withElements(parts), zone };
}

/** The title on its own transparent layer; its colour is chosen against `backdrop`. */
export function renderTitlePart(
  design: ThumbnailDesign,
  zone: TextZone,
  width: number,
  height: number,
  backdrop: HTMLCanvasElement,
  record?: VectorElement[],
): HTMLCanvasElement | null {
  if (!design.showTitle) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const sample = backdrop.getContext('2d', { willReadFrequently: true });
  if (!ctx || !sample) return null;
  if (record) {
    // The title's letters as vector elements too, so it stays sharp as it flies at the camera.
    const recorder = createRecorder(ctx);
    drawTitle(recorder.ctx, design, zone, sample);
    record.push(...recorder.elements);
  } else drawTitle(ctx, design, zone, sample);
  return canvas;
}

/** Where everything goes on a layered design, decided before anything is drawn. */
function planLayered(env: Env, design: ThumbnailDesign) {
  const { recipe } = design;
  const layout = env.rng(1);
  const anchor = anchorPoint(env, recipe, layout);
  const zone = plannedZone(env, recipe, anchor, layout);
  const quiet = design.showTitle ? zoneRect(env, zone) : null;

  const primary = buildSubject(env, recipe.subject, {
    anchor,
    scale: recipe.scale,
    mirror: recipe.mirror,
    bounds: primaryBounds(env, recipe.subject, design.showTitle),
    quiet,
    primary: null,
    random: env.rng(20),
  });

  let secondary: SubjectResult | null = null;
  if (recipe.secondary !== 'none') {
    const host: SubjectResult = primary ?? { focal: { x: env.A / 2, y: 0.5, r: 0 } };
    const random = env.rng(30);
    secondary = buildSubject(env, recipe.secondary, {
      anchor: secondaryAnchor(env, recipe.secondary, host, quiet, random),
      scale: 1,
      mirror: recipe.mirror,
      bounds: secondaryBounds(env, host, quiet),
      quiet,
      primary: host,
      random,
    });
  }
  return { zone, quiet, primary, secondary };
}

/** Sets the title over art already on the canvas. */
export function drawThumbnailTitle(canvas: HTMLCanvasElement, design: ThumbnailDesign, zone: TextZone): void {
  if (!design.showTitle) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  drawTitle(ctx, design, zone);
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function anchorPoint(env: Env, recipe: Recipe, random: Random): { x: number; y: number } {
  const A = env.A;
  let x: number;
  let y: number;
  switch (recipe.anchor) {
    case 'left':
      x = A * random.range(0.3, 0.4);
      y = random.range(0.42, 0.56);
      break;
    case 'centre':
      x = A * random.range(0.47, 0.53);
      y = random.range(0.38, 0.48);
      break;
    case 'corner':
      x = A * random.range(0.82, 0.94);
      y = random.range(0.06, 0.2);
      break;
    case 'low':
      x = A * random.range(0.55, 0.7);
      y = random.range(0.84, 0.96);
      break;
    default:
      x = A * random.range(0.6, 0.7);
      y = random.range(0.42, 0.56);
  }
  return { x: recipe.mirror ? A - x : x, y };
}

/** Where the title goes, decided before any shape is drawn so shapes can keep it clear. */
function plannedZone(env: Env, recipe: Recipe, anchor: { x: number; y: number }, random: Random): TextZone {
  switch (recipe.subject) {
    case 'frame':
      return recipe.secondary !== 'none'
        ? { align: 'center', vertical: 'middle', maxWidth: 0.6, inset: 0.1, y: 0.75 }
        : { align: 'center', vertical: 'middle', maxWidth: 0.7, inset: 0.13 };
    case 'glyphs':
      return { align: 'center', vertical: 'middle', maxWidth: 0.7, inset: 0.05, y: 0.77 };
    case 'contour':
      return { align: 'left', vertical: 'bottom', maxWidth: 0.55, inset: 0 };
    case 'skyline':
      return { align: 'left', vertical: 'top', maxWidth: 0.55, inset: 0 };
    case 'none':
      return recipe.secondary === 'none' && env.design.title.length <= 22 && random.chance(0.5)
        ? { align: 'center', vertical: 'middle', maxWidth: 0.78, inset: 0 }
        : { align: 'left', vertical: 'bottom', maxWidth: 0.62, inset: 0 };
    default:
      return zoneAwayFrom(env, anchor.x, anchor.y);
  }
}

/** The region the shapes that draw the music itself are laid out in. */
function primaryBounds(env: Env, subject: SubjectId, titled: boolean): Rect {
  const A = env.A;
  switch (subject) {
    case 'glyphs':
      return { x0: 0.14, x1: A - 0.14, y0: 0.18, y1: titled ? 0.6 : 0.78 };
    case 'contour':
      return { x0: 0.1, x1: A - 0.1, y0: 0.14, y1: titled ? 0.62 : 0.86 };
    case 'skyline':
      return { x0: 0.08, x1: A - 0.08, y0: titled ? 0.42 : 0.22, y1: 0.9 };
    default:
      return { x0: 0.07, x1: A - 0.07, y0: 0.08, y1: 0.92 };
  }
}

/** Room for a second shape: inside a frame, or the half of the picture the main shape leaves free. */
function secondaryBounds(env: Env, host: SubjectResult, quiet: Rect | null): Rect {
  const A = env.A;
  const m = 0.08;
  if (host.inner) {
    const inner = host.inner;
    return { ...inner, y1: quiet ? Math.min(inner.y1, quiet.y0 - 0.02) : inner.y1 };
  }
  let x0 = m;
  let x1 = A - m;
  if (host.focal.r > 0) {
    const right = host.focal.x < A / 2;
    x0 = right ? A * 0.52 : m;
    x1 = right ? A - m : A * 0.48;
  }
  let y0 = m;
  let y1 = 1 - m;
  if (quiet && quiet.x1 > x0 && quiet.x0 < x1) {
    if (quiet.y0 > 0.5) y1 = quiet.y0 - 0.03;
    else y0 = quiet.y1 + 0.03;
  }
  return { x0, x1, y0, y1: Math.max(y1, y0 + 0.2) };
}

/** A spot for a second shape: hugging the main one, or as far from it as the title allows. */
function secondaryAnchor(
  env: Env,
  id: SubjectId,
  host: SubjectResult,
  quiet: Rect | null,
  random: Random,
): { x: number; y: number } {
  if (id === 'ring' || id === 'islands') return { x: host.focal.x, y: host.focal.y };
  let best = { x: env.A * 0.25, y: 0.25 };
  let bestScore = -Infinity;
  for (let i = 0; i < 60; i++) {
    const x = random.range(0.24, env.A - 0.24);
    const y = random.range(0.15, 0.55);
    // Keep the whole shape (not just its centre) clear of the title.
    const room = clearance(quiet, x, y);
    const score = Math.hypot(x - host.focal.x, y - host.focal.y) - host.focal.r - (room < 0.22 ? 10 + (0.22 - room) * 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function setTracking(ctx: CanvasRenderingContext2D, px: number): void {
  const withSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in withSpacing) withSpacing.letterSpacing = `${px}px`;
}

/** Breaks a title into at most two lines of similar length. */
function splitLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text];
  let best = [text];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Sets the title in clean display type, sized to fit its zone, in the chosen
 * colour — or, on Auto, whichever of white or deep ink reads better on what is
 * actually underneath it.
 */
function drawTitle(
  ctx: CanvasRenderingContext2D,
  design: ThumbnailDesign,
  zone: TextZone,
  sampleFrom: CanvasRenderingContext2D = ctx,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const title = design.title;
  const upper = /[A-Z]/.test(title) && title === title.toUpperCase();
  const margin = (0.075 + zone.inset) * H;
  const maxWidth = Math.min(zone.maxWidth * W, W - margin * 2);

  const face = titleFont(design.font);
  const font = (size: number, weight = face.weight) => `${weight} ${size}px ${face.stack}`;
  const tracking = (size: number) => (upper ? face.tracking.upper : face.tracking.mixed) * size;
  const widest = (lines: string[], size: number) => {
    ctx.font = font(size);
    setTracking(ctx, tracking(size));
    return Math.max(...lines.map((line) => ctx.measureText(line).width));
  };

  // A centred title is the subject of the frame and can be bigger than one tucked in a corner.
  const centred = zone.align === 'center';
  let lines = [title];
  let size = (centred ? 0.15 : 0.12) * H * face.scale;
  while (widest(lines, size) > maxWidth && size > 0.072 * H) size *= 0.95;
  if (widest(lines, size) > maxWidth) {
    lines = splitLines(title);
    size = (centred ? 0.13 : 0.11) * H * face.scale;
    while (widest(lines, size) > maxWidth && size > 0.04 * H) size *= 0.95;
  }

  const subSize = 0.034 * H;
  const cap = size * 0.72;
  const lineHeight = size * 1.02;
  const titleHeight = cap + (lines.length - 1) * lineHeight;
  const subGap = design.subtitle ? size * 0.42 : 0;
  const blockHeight = titleHeight + (design.subtitle ? subGap + subSize * 0.72 : 0);
  const blockWidth = Math.max(widest(lines, size), design.subtitle ? subSize * design.subtitle.length * 0.85 : 0);

  const top =
    zone.vertical === 'top'
      ? margin
      : zone.vertical === 'bottom'
        ? H - margin - blockHeight
        : (zone.y ?? 0.5) * H - blockHeight / 2;
  const anchorX = zone.align === 'left' ? margin : zone.align === 'right' ? W - margin : W / 2;
  const boxX = zone.align === 'left' ? anchorX : zone.align === 'right' ? anchorX - blockWidth : anchorX - blockWidth / 2;

  // Read what is under the text before choosing its colour.
  const background = sampleLuminance(sampleFrom, boxX, top - cap * 0.2, blockWidth, blockHeight + cap * 0.4);
  const light: Rgb8 = { r: 250, g: 250, b: 252 };
  const deep = oklch(0.19, Math.min(0.06, design.palette.base.c * 0.6), design.palette.base.h);
  const accent = lchToRgb(design.palette.accent);
  const contrastOf = (color: Rgb8) => contrastRatio(relativeLuminance(color), background);
  const ink =
    design.textColour === 'white'
      ? light
      : design.textColour === 'dark'
        ? deep
        : design.textColour === 'accent'
          ? accent
          : design.textColour === 'custom'
            ? hexRgb(design.titleEffects.customColor)
            : contrastOf(light) >= contrastOf(deep)
            ? light
            : deep;
  const contrast = contrastOf(ink);

  ctx.save();
  ctx.textAlign = zone.align;
  ctx.textBaseline = 'alphabetic';
  const stops = design.palette.gradientStops.map(lchHex);
  ctx.fillStyle =
    design.gradientTargets.includes('title') && stops.length >= 2
      ? boxGradient(ctx, stops, design.gradientDirection, boxX, top, blockWidth, blockHeight)
      : rgbCss(ink);
  const fx = design.titleEffects;
  const inkIsLight = relativeLuminance(ink) > 0.35;
  const fill = ctx.fillStyle;
  // Draws the title (and subtitle) once with whatever paint is set: fill or stroke.
  const text = (paint: 'fill' | 'stroke') => {
    ctx.font = font(size);
    setTracking(ctx, tracking(size));
    lines.forEach((line, i) =>
      paint === 'fill' ? ctx.fillText(line, anchorX, top + cap + i * lineHeight) : ctx.strokeText(line, anchorX, top + cap + i * lineHeight),
    );
    if (design.subtitle) {
      ctx.font = font(subSize, face.subWeight);
      setTracking(ctx, subSize * 0.3);
      const y = top + titleHeight + subGap + subSize * 0.72;
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * 0.8;
      if (paint === 'fill') ctx.fillText(design.subtitle, anchorX, y);
      else ctx.strokeText(design.subtitle, anchorX, y);
      ctx.globalAlpha = alpha;
    }
  };

  // Glow: a wide soft light round the letters, built up in two passes.
  if (fx.glow > 0.01) {
    const colour = fx.glowColor ?? rgbCss(accent);
    ctx.save();
    ctx.shadowColor = colour;
    ctx.fillStyle = colour;
    for (const blur of [0.05, 0.02]) {
      ctx.shadowBlur = blur * H * (0.4 + fx.glow);
      ctx.globalAlpha = Math.min(1, 0.45 + 0.55 * fx.glow);
      text('fill');
    }
    ctx.restore();
  }
  // Drop shadow: offset down and right, a little soft.
  if (fx.shadow > 0.01) {
    const colour = fx.shadowColor ?? (inkIsLight ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.6)');
    ctx.save();
    ctx.fillStyle = colour;
    const offset = (0.004 + 0.014 * fx.shadow) * H;
    ctx.translate(offset, offset);
    ctx.shadowColor = colour;
    ctx.shadowBlur = 0.006 * H * fx.shadow;
    text('fill');
    ctx.restore();
  }
  // Outline: drawn under the fill, so the letters keep their shape and the line sits outside them.
  if (fx.outline > 0.01) {
    ctx.save();
    ctx.strokeStyle = fx.outlineColor ?? (inkIsLight ? 'rgba(8, 10, 14, 0.95)' : 'rgba(255, 255, 255, 0.95)');
    ctx.lineWidth = (0.004 + 0.022 * fx.outline) * H;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    text('stroke');
    ctx.restore();
  }

  ctx.fillStyle = fill;
  // With no effects chosen, a faint halo keeps a low-contrast title readable.
  if (contrast < 3.2 && fx.outline <= 0.01 && fx.shadow <= 0.01 && fx.glow <= 0.01) {
    ctx.shadowColor = inkIsLight ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.5)';
    ctx.shadowBlur = 0.03 * H;
  }
  text('fill');
  ctx.restore();
}

/** Mean relative luminance of a region of the canvas (sparsely sampled). */
function sampleLuminance(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(x + w));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return 0;
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const step = Math.max(1, Math.floor(((x1 - x0) * (y1 - y0)) / 4000)) * 4;
  let total = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += step) {
    total += relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] });
    count++;
  }
  return count ? total / count : 0;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Encodes for YouTube: PNG when it fits the 2 MB limit, high-quality JPEG when not. */
export async function encodeForYouTube(canvas: HTMLCanvasElement): Promise<{ blob: Blob; extension: string }> {
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (png && png.size <= 2 * 1024 * 1024) return { blob: png, extension: 'png' };
  for (const quality of [0.95, 0.9, 0.85]) {
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (jpeg && jpeg.size <= 2 * 1024 * 1024) return { blob: jpeg, extension: 'jpg' };
  }
  const fallback = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!fallback) throw new Error('The browser could not encode the thumbnail.');
  return { blob: fallback, extension: 'jpg' };
}

export async function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('The browser could not encode the thumbnail.');
  return png;
}

function hexRgb(hex: string): Rgb8 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
