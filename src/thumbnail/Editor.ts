import { NoiseField, createRandom, mixSeed } from './Noise';
import type { PartKind, ThumbPart } from './ThumbnailRenderer';

/**
 * The hand-editable side of a thumbnail: the generated parts and the title as
 * layers you can move, resize, hide and reorder, plus your own paint layers
 * and shape stamps.
 *
 * Everything is stored in frame units — the frame is 1 tall and 16/9 wide —
 * so the same edits reproduce exactly on the preview and on a 4K export.
 */

export type BrushId = 'round' | 'ink' | 'dry' | 'chalk' | 'spray' | 'marker' | 'eraser';
export type StampShape = 'land' | 'blob' | 'circle' | 'moon' | 'ring' | 'shard' | 'sparkle' | 'drop';
export type EditTool = 'select' | 'paint';
/** Anything the Paint tool can put down: a brush stroke or a shape. */
export type PaintBrush = BrushId | StampShape;
export type TextureId = 'none' | 'canvas' | 'paper' | 'sponge' | 'hatch' | 'dots' | 'grit';

export const TEXTURES: Array<{ id: TextureId; name: string }> = [
  { id: 'none', name: 'Smooth' },
  { id: 'canvas', name: 'Canvas' },
  { id: 'paper', name: 'Paper' },
  { id: 'sponge', name: 'Sponge' },
  { id: 'hatch', name: 'Hatch' },
  { id: 'dots', name: 'Dots' },
  { id: 'grit', name: 'Grit' },
];

export const BRUSHES: Array<{ id: BrushId; name: string }> = [
  { id: 'round', name: 'Round' },
  { id: 'ink', name: 'Ink' },
  { id: 'dry', name: 'Dry brush' },
  { id: 'chalk', name: 'Chalk' },
  { id: 'spray', name: 'Spray' },
  { id: 'marker', name: 'Marker' },
  { id: 'eraser', name: 'Eraser' },
];

export const STAMPS: Array<{ id: StampShape; name: string }> = [
  { id: 'land', name: 'Land' },
  { id: 'blob', name: 'Blob' },
  { id: 'circle', name: 'Circle' },
  { id: 'moon', name: 'Moon' },
  { id: 'ring', name: 'Ring' },
  { id: 'shard', name: 'Shard' },
  { id: 'sparkle', name: 'Sparkle' },
  { id: 'drop', name: 'Drop' },
];

export function isStampBrush(brush: PaintBrush): brush is StampShape {
  return STAMPS.some((stamp) => stamp.id === brush);
}

export const PART_NAMES: Record<PartKind | 'title', string> = {
  ground: 'Background',
  secondary: 'Second shape',
  primary: 'Main shape',
  details: 'Details',
  art: 'Artwork',
  title: 'Title',
};

export interface Stroke {
  brush: BrushId;
  color: string;
  /** Brush diameter as a share of the frame height. */
  size: number;
  opacity: number;
  /** x, y, pressure triples in frame units. */
  points: number[];
  seed: number;
  texture?: TextureId;
}

export interface Stamp {
  shape: StampShape;
  color: string;
  /** Radius as a share of the frame height. */
  size: number;
  rotation: number;
  seed: number;
  /** Centre in frame units. */
  cx: number;
  cy: number;
  texture?: TextureId;
}

/** Move and resize, applied about the layer's own centre. */
export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface ThumbElement {
  id: string;
  kind: 'part' | 'title' | 'paint' | 'stamp';
  part?: PartKind;
  name: string;
  visible: boolean;
  t: Transform;
  strokes?: Stroke[];
  stamp?: Stamp;
}

/** Layers bottom to top. */
export interface ThumbEdits {
  elements: ThumbElement[];
}

export const IDENTITY: Transform = { x: 0, y: 0, scale: 1 };

export const EMPTY_EDITS: ThumbEdits = { elements: [] };

const PART_ORDER: Array<PartKind | 'title'> = ['ground', 'art', 'secondary', 'primary', 'details'];

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/**
 * Brings the layer list in line with the parts the current design has: new
 * parts appear below anything you added, parts the design no longer has go,
 * and the title always exists. Your own layers and every transform you made
 * are kept.
 */
export function syncElements(edits: ThumbEdits, parts: PartKind[]): ThumbEdits {
  const present = new Set(parts);
  const kept = edits.elements.filter((element) => element.kind !== 'part' || present.has(element.part!));
  let elements = kept.length === edits.elements.length ? edits.elements : kept;
  for (const kind of PART_ORDER) {
    if (kind === 'title' || !present.has(kind as PartKind)) continue;
    if (elements.some((element) => element.kind === 'part' && element.part === kind)) continue;
    // Insert just above the generated parts that sit below it.
    const below = PART_ORDER.slice(0, PART_ORDER.indexOf(kind));
    let index = 0;
    elements.forEach((element, i) => {
      if (element.kind === 'part' && below.includes(element.part!)) index = i + 1;
    });
    const added: ThumbElement = { id: `part-${kind}`, kind: 'part', part: kind as PartKind, name: PART_NAMES[kind], visible: true, t: { ...IDENTITY } };
    elements = [...elements.slice(0, index), added, ...elements.slice(index)];
  }
  if (!elements.some((element) => element.kind === 'title')) {
    elements = [...elements, { id: 'title', kind: 'title', name: 'Title', visible: true, t: { ...IDENTITY } }];
  }
  return elements === edits.elements ? edits : { elements };
}

// ---------------------------------------------------------------------------
// Bounds and hit testing
// ---------------------------------------------------------------------------

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boundsCache = new WeakMap<HTMLCanvasElement, Box | null>();

/** Bounding box of a layer canvas's visible pixels, in frame units. */
export function canvasBounds(canvas: HTMLCanvasElement): Box | null {
  if (boundsCache.has(canvas)) return boundsCache.get(canvas)!;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width;
  const H = canvas.height;
  if (!ctx || !W || !H) return null;
  const data = ctx.getImageData(0, 0, W, H).data;
  const step = Math.max(1, Math.round(H / 360));
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (data[(y * W + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const box = x1 < 0 ? null : { x0: x0 / H, y0: y0 / H, x1: (x1 + step) / H, y1: (y1 + step) / H };
  boundsCache.set(canvas, box);
  return box;
}

/** A layer's box after its move and resize. */
export function transformBox(box: Box, t: Transform): Box {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const hw = ((box.x1 - box.x0) / 2) * t.scale;
  const hh = ((box.y1 - box.y0) / 2) * t.scale;
  return { x0: cx + t.x - hw, y0: cy + t.y - hh, x1: cx + t.x + hw, y1: cy + t.y + hh };
}

export function stampBox(stamp: Stamp): Box {
  const r = stamp.size * (stamp.shape === 'land' ? 1.7 : 1.15);
  return { x0: stamp.cx - r, y0: stamp.cy - r, x1: stamp.cx + r, y1: stamp.cy + r };
}

// ---------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------

export interface LayerSources {
  parts: ThumbPart[];
  title: HTMLCanvasElement | null;
  /** Rendered paint layers by element id, at the output size. */
  paint: Map<string, HTMLCanvasElement>;
}

/** Draws every visible layer, bottom to top, with its move and resize. */
export function composeEdits(out: HTMLCanvasElement, width: number, height: number, edits: ThumbEdits, sources: LayerSources): void {
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  // Whatever a moved background uncovers shows the background's own colour.
  const ground = sources.parts.find((part) => part.kind === 'ground' || part.kind === 'art');
  if (ground) {
    const corner = ground.canvas.getContext('2d', { willReadFrequently: true })?.getImageData(1, 1, 1, 1).data;
    ctx.fillStyle = corner ? `rgb(${corner[0]}, ${corner[1]}, ${corner[2]})` : '#000';
  } else {
    ctx.fillStyle = '#000';
  }
  ctx.fillRect(0, 0, width, height);
  drawLayers(ctx, width, height, edits.elements, sources);
}

/** Draws layers, bottom to top, over whatever is already on the canvas. */
export function drawLayers(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elements: ThumbElement[],
  sources: LayerSources,
): void {
  const H = height;
  for (const element of elements) {
    if (!element.visible) continue;
    let source: HTMLCanvasElement | null = null;
    if (element.kind === 'part') source = sources.parts.find((part) => part.kind === element.part)?.canvas ?? null;
    else if (element.kind === 'title') source = sources.title;
    else if (element.kind === 'paint') source = sources.paint.get(element.id) ?? null;

    if (element.kind === 'stamp' && element.stamp) {
      const texture = element.stamp.texture ?? 'none';
      // A textured stamp is drawn on its own sheet so the texture only eats into it.
      const sheet = texture === 'none' ? null : document.createElement('canvas');
      const target = sheet ? sheet.getContext('2d') : ctx;
      if (!target) continue;
      if (sheet) {
        sheet.width = width;
        sheet.height = height;
      }
      target.save();
      applyTransform(target, stampBox(element.stamp), element.t, H);
      drawStamp(target, element.stamp, H);
      target.restore();
      if (sheet) {
        applyTexture(target, texture, width, height);
        ctx.drawImage(sheet, 0, 0);
      }
      continue;
    }
    if (!source) continue;
    const box = canvasBounds(source);
    ctx.save();
    if (box) applyTransform(ctx, box, element.t, H);
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();
  }
}

/** The same move and resize as applyTransform, as a matrix (canvas pixels to canvas pixels). */
export function layerMatrix(box: Box, t: Transform, H: number): DOMMatrix {
  const cx = ((box.x0 + box.x1) / 2) * H;
  const cy = ((box.y0 + box.y1) / 2) * H;
  return new DOMMatrix().translate(cx + t.x * H, cy + t.y * H).scale(t.scale, t.scale).translate(-cx, -cy);
}

function applyTransform(ctx: CanvasRenderingContext2D, box: Box, t: Transform, H: number): void {
  const cx = ((box.x0 + box.x1) / 2) * H;
  const cy = ((box.y0 + box.y1) / 2) * H;
  ctx.translate(cx + t.x * H, cy + t.y * H);
  ctx.scale(t.scale, t.scale);
  ctx.translate(-cx, -cy);
}

/** A paint layer drawn at the given size. */
export function renderPaint(strokes: Stroke[], width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) for (const stroke of strokes) drawStroke(ctx, stroke, width, height);
  return canvas;
}

// ---------------------------------------------------------------------------
// Brushes
// ---------------------------------------------------------------------------

/**
 * One stroke. It is laid down at full strength on a scratch canvas and then
 * composited at its opacity, so overlapping dabs do not build up into
 * blotches; the eraser cuts through the layer instead.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, W: number, H: number): void {
  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const s = scratch.getContext('2d');
  if (!s) return;
  s.fillStyle = stroke.color;
  s.strokeStyle = stroke.color;
  const random = createRandom(stroke.seed);
  const noise = new NoiseField(mixSeed(stroke.seed, 7));
  const radius = (stroke.size * H) / 2;
  const pts = stroke.points;
  const count = pts.length / 3;
  if (!count) return;

  // Walk the path at an even spacing, calling `dab` at each step.
  const walk = (spacing: number, dab: (x: number, y: number, r: number, angle: number, travelled: number) => void) => {
    let travelled = 0;
    let carry = 0;
    if (count === 1) {
      dab(pts[0] * H, pts[1] * H, radius * pts[2], 0, 0);
      return;
    }
    for (let i = 1; i < count; i++) {
      const ax = pts[(i - 1) * 3] * H;
      const ay = pts[(i - 1) * 3 + 1] * H;
      const bx = pts[i * 3] * H;
      const by = pts[i * 3 + 1] * H;
      const ap = pts[(i - 1) * 3 + 2];
      const bp = pts[i * 3 + 2];
      const length = Math.hypot(bx - ax, by - ay);
      const angle = Math.atan2(by - ay, bx - ax);
      let d = carry;
      while (d <= length) {
        const t = length ? d / length : 0;
        dab(ax + (bx - ax) * t, ay + (by - ay) * t, radius * (ap + (bp - ap) * t), angle, travelled + d);
        d += spacing;
      }
      carry = d - length;
      travelled += length;
    }
  };

  switch (stroke.brush) {
    case 'round':
    case 'eraser':
      walk(Math.max(1, radius * 0.18), (x, y, r) => {
        s.beginPath();
        s.arc(x, y, Math.max(r, 0.5), 0, Math.PI * 2);
        s.fill();
      });
      break;
    case 'ink':
      // Pressure (or speed) swells and thins the line; the edge is slightly ragged.
      walk(Math.max(1, radius * 0.12), (x, y, r, _a, travelled) => {
        const wobble = 1 + (noise.value(travelled / (radius * 3 + 1), 0.5) - 0.5) * 0.35;
        s.beginPath();
        s.arc(x, y, Math.max(r * wobble, 0.5), 0, Math.PI * 2);
        s.fill();
      });
      break;
    case 'marker':
      // A flat, chisel nib held at a fixed angle.
      walk(Math.max(1, radius * 0.15), (x, y, r) => {
        s.save();
        s.translate(x, y);
        s.rotate(-0.6);
        s.fillRect(-r, -r * 0.28, r * 2, r * 0.56);
        s.restore();
      });
      break;
    case 'dry': {
      // Separate bristles that skip where the paint runs dry.
      const bristles = 9;
      const offsets = Array.from({ length: bristles }, () => random.range(-1, 1));
      const widths = Array.from({ length: bristles }, () => random.range(0.08, 0.2));
      walk(Math.max(1, radius * 0.1), (x, y, r, angle, travelled) => {
        const nx = -Math.sin(angle);
        const ny = Math.cos(angle);
        for (let b = 0; b < bristles; b++) {
          const dry = noise.value(travelled / (radius * 1.5 + 1) + b * 3.7, b * 1.3);
          if (dry < 0.36 + 0.25 * (travelled / (travelled + radius * 30))) continue;
          s.beginPath();
          s.arc(x + nx * offsets[b] * r, y + ny * offsets[b] * r, Math.max(r * widths[b], 0.5), 0, Math.PI * 2);
          s.fill();
        }
      });
      break;
    }
    case 'chalk':
      // Grainy coverage that catches on an imaginary paper tooth.
      walk(Math.max(1, radius * 0.35), (x, y, r) => {
        const dots = Math.min(60, Math.round(r * 1.6));
        for (let i = 0; i < dots; i++) {
          const a = random.range(0, Math.PI * 2);
          const d = Math.sqrt(random.next()) * r;
          const px = x + Math.cos(a) * d;
          const py = y + Math.sin(a) * d;
          if (noise.value(px / (H * 0.004), py / (H * 0.004)) < 0.42) continue;
          s.fillRect(px, py, Math.max(1, H * 0.0022), Math.max(1, H * 0.0022));
        }
      });
      break;
    case 'spray':
      walk(Math.max(1, radius * 0.5), (x, y, r) => {
        const dots = Math.min(80, Math.round(r * 1.2));
        for (let i = 0; i < dots; i++) {
          const a = random.range(0, Math.PI * 2);
          // Gaussian-ish falloff: denser in the middle of the cone.
          const d = Math.abs(random.next() + random.next() - 1) * r * 1.6;
          const dot = Math.max(0.6, random.range(0.4, 1.3) * H * 0.0016);
          s.beginPath();
          s.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, dot, 0, Math.PI * 2);
          s.fill();
        }
      });
      break;
  }

  if (stroke.texture && stroke.texture !== 'none') applyTexture(s, stroke.texture, W, H);

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  if (stroke.brush === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
  scratch.width = 0;
  scratch.height = 0;
}

// ---------------------------------------------------------------------------
// Stamps
// ---------------------------------------------------------------------------

/** Draws a shape stamp in frame units scaled by H. */
export function drawStamp(ctx: CanvasRenderingContext2D, stamp: Stamp, H: number): void {
  const noise = new NoiseField(mixSeed(stamp.seed, 3));
  const random = createRandom(stamp.seed);
  const cx = stamp.cx * H;
  const cy = stamp.cy * H;
  const r = stamp.size * H;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(stamp.rotation);
  ctx.fillStyle = stamp.color;
  ctx.strokeStyle = stamp.color;

  // A closed outline whose radius follows `radius(angle)`.
  const outline = (radius: (a: number) => number, steps = 160, ox = 0, oy = 0) => {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = radius(a);
      const x = ox + Math.cos(a) * rr;
      const y = oy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  // Noise sampled round a circle, so the outline closes without a seam.
  const ring = (a: number, freq: number, salt: number) => noise.fbm(Math.cos(a) * freq + salt, Math.sin(a) * freq - salt, 4) - 0.5;

  switch (stamp.shape) {
    case 'land': {
      // A coastline: a broad, lopsided body with bays, a peninsula and a
      // ragged shore, plus an islet or two offshore.
      const stretch = random.range(1.3, 1.7);
      const lobe = random.range(0, Math.PI * 2);
      ctx.save();
      ctx.scale(stretch, 1);
      outline((a) => {
        const body = 0.72 + ring(a, 1.1, 2) * 1.1 + ring(a, 2.6, 9) * 0.45;
        const peninsula = Math.max(0, Math.cos(a - lobe)) ** 8 * 0.45;
        const shore = ring(a, 9, 21) * 0.18;
        return r * Math.max(0.25, body + peninsula + shore);
      }, 280);
      ctx.restore();
      const islets = random.int(1, 3);
      for (let i = 0; i < islets; i++) {
        const a = random.range(0, Math.PI * 2);
        const d = r * random.range(1.05, 1.35);
        const size = r * random.range(0.07, 0.16);
        outline((t) => size * (0.8 + ring(t, 3, 30 + i * 5) * 0.8), 60, Math.cos(a) * d * stretch, Math.sin(a) * d * 0.8);
      }
      break;
    }
    case 'blob':
      outline((a) => r * (0.85 + ring(a, 1.4, 4) * 0.7 + ring(a, 6, 14) * 0.1));
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'moon':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.arc(r * 0.45, -r * 0.15, r * 0.85, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      break;
    case 'ring':
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.1, r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'shard':
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.15, r * 0.2);
      ctx.lineTo(-r, 0);
      ctx.lineTo(-r * 0.1, -r * 0.16);
      ctx.closePath();
      ctx.fill();
      break;
    case 'sparkle': {
      const w = r * 0.18;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(w, -w, r, 0);
      ctx.quadraticCurveTo(w, w, 0, r);
      ctx.quadraticCurveTo(-w, w, -r, 0);
      ctx.quadraticCurveTo(-w, -w, 0, -r);
      ctx.fill();
      break;
    }
    case 'drop':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.35, -r * 0.3, r * 0.7, 0, r * 0.7, r * 0.3);
      ctx.arc(0, r * 0.3, r * 0.7, 0, Math.PI);
      ctx.bezierCurveTo(-r * 0.7, 0, -r * 0.35, -r * 0.3, 0, -r);
      ctx.fill();
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const textureCache = new Map<string, HTMLCanvasElement>();

/** Keeps only the parts of what is on `ctx` that the texture lets through. */
export function applyTexture(ctx: CanvasRenderingContext2D, id: TextureId, W: number, H: number): void {
  if (id === 'none') return;
  const mask = textureMask(id, W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
}

/**
 * A white sheet whose alpha is the texture, measured against a 720-pixel
 * frame so it looks the same at every size. Built once per size.
 */
function textureMask(id: TextureId, W: number, H: number): HTMLCanvasElement {
  const key = `${id}:${W}x${H}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  if (textureCache.size > 12) textureCache.clear();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(W, H);
  const data = image.data;
  const k = H / 720;
  const noise = new NoiseField(0x7e57);
  const alphaAt = textureFunction(id, k, noise);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, Math.max(0, alphaAt(x, y))) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  textureCache.set(key, canvas);
  return canvas;
}

function textureFunction(id: TextureId, k: number, noise: NoiseField): (x: number, y: number) => number {
  switch (id) {
    case 'canvas': {
      // A woven tooth: threads one way, then the other.
      const p = 5 * k;
      return (x, y) => {
        const warp = Math.abs(Math.sin((x / p) * Math.PI));
        const weft = Math.abs(Math.sin((y / p) * Math.PI));
        const over = (Math.floor(x / p) + Math.floor(y / p)) % 2 === 0 ? warp : weft;
        return 0.45 + 0.55 * over;
      };
    }
    case 'paper':
      // Rough paper: the paint skips the low spots of the grain.
      return (x, y) => {
        const n = noise.fbm(x / (5 * k), y / (5 * k), 3);
        return (n - 0.32) * 3.2;
      };
    case 'sponge':
      return (x, y) => {
        const n = noise.fbm(x / (14 * k) + 40, y / (14 * k), 3);
        return n > 0.47 ? 1 : n > 0.42 ? (n - 0.42) * 20 : 0;
      };
    case 'hatch': {
      const p = 7 * k;
      return (x, y) => {
        const t = ((x + y) / p) % 1;
        return t < 0.5 ? 1 : 0.08;
      };
    }
    case 'dots': {
      const p = 9 * k;
      return (x, y) => {
        const dx = (x % p) - p / 2;
        const dy = (y % p) - p / 2;
        return (p * 0.34 - Math.hypot(dx, dy)) / Math.max(1, k);
      };
    }
    case 'grit':
      return (x, y) => {
        const n = noise.value(x / (1.6 * k), y / (1.6 * k));
        return n > 0.38 ? 1 : 0;
      };
    default:
      return () => 1;
  }
}
