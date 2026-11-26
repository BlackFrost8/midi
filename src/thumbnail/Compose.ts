import { fontReady } from './Fonts';
import { applyFilter } from './Filters';
import { tintLayer } from './GradientTint';
import { lchHex } from './Oklch';
import {
  canvasBounds,
  composeEdits,
  drawLayers,
  renderPaint,
  syncElements,
  type Box,
  type LayerSources,
  type Stroke,
  type ThumbEdits,
  type ThumbElement,
} from './Editor';
import type { TextZone } from './render/Kit';
import type { ThumbnailDesign } from './ThumbnailDesign';
import {
  renderThumbnailParts,
  renderTitlePart,
  thumbnailArtKey,
  type PartKind,
  type ThumbPart,
} from './ThumbnailRenderer';

/**
 * Builds the finished thumbnail from the design and your edits: generated
 * parts, title, paint layers and stamps, each with its move and resize, and
 * the filter (Thumb tab, Filter section) over everything below the title (or over the
 * title too, if you ask). The preview keeps a cache, so dragging the title
 * never re-runs the filter; an export renders everything fresh at full size.
 */

export interface ComposeCache {
  artKey: string | null;
  parts: ThumbPart[];
  zone: TextZone | null;
  backdrop: HTMLCanvasElement | null;
  titleKey: string | null;
  title: HTMLCanvasElement | null;
  paint: Map<string, { strokes: Stroke[]; canvas: HTMLCanvasElement }>;
  /** The filtered lower layers, and everything they were made from. */
  filterKey: string | null;
  filtered: HTMLCanvasElement | null;
}

export function createComposeCache(): ComposeCache {
  return { artKey: null, parts: [], zone: null, backdrop: null, titleKey: null, title: null, paint: new Map(), filterKey: null, filtered: null };
}

export interface ComposeResult {
  /** Untransformed bounds of each layer, in frame units, for selection. */
  boxes: Map<string, Box>;
  partKinds: PartKind[];
}

export interface ComposeOptions {
  fieldHeight?: number;
  /** Apply the filter (off only for unfiltered renders). */
  finish: boolean;
  cache?: ComposeCache;
  /** Also draw the picture, unfiltered, into this (small) canvas, for the filter previews. */
  snapshot?: HTMLCanvasElement;
  /** Mid-drag: run the filter at half size so the layer keeps up with the pointer. */
  draft?: boolean;
}

/** Identity of a strokes array, so the filter cache notices new paint. */
const strokeIds = new WeakMap<Stroke[], number>();
let strokeCounter = 0;
function strokesId(strokes: Stroke[] | undefined): number {
  if (!strokes) return 0;
  let id = strokeIds.get(strokes);
  if (!id) {
    id = ++strokeCounter;
    strokeIds.set(strokes, id);
  }
  return id;
}

/** The two palette colours the recolouring filters use. */
export function filterColours(design: ThumbnailDesign): { dark: string; light: string } {
  const { base, accent } = design.palette;
  return {
    dark: lchHex({ l: 0.17, c: Math.min(0.08, base.c * 0.7), h: base.h }),
    light: lchHex({ l: 0.9, c: Math.min(0.12, accent.c * 0.8), h: accent.h }),
  };
}

export function composeThumbnail(
  out: HTMLCanvasElement,
  design: ThumbnailDesign,
  edits: ThumbEdits,
  width: number,
  height: number,
  options: ComposeOptions,
): ComposeResult {
  const cache = options.cache ?? createComposeCache();

  const artKey = `${thumbnailArtKey(design)}@${width}x${height}:${options.fieldHeight ?? 0}:${design.gradientTargets.join(',')}:${design.gradientDirection}`;
  if (cache.artKey !== artKey) {
    const { parts, zone } = renderThumbnailParts(design, width, height, { fieldHeight: options.fieldHeight });
    // Shapes the gradient is aimed at are recoloured once, here.
    const stops = design.palette.gradientStops.map(lchHex);
    for (const part of parts) {
      if ((design.gradientTargets as string[]).includes(part.kind)) tintLayer(part.canvas, stops, design.gradientDirection);
    }
    cache.parts = parts;
    cache.zone = zone;
    // The parts flattened as designed: what the title's colour is judged against.
    const backdrop = cache.backdrop ?? document.createElement('canvas');
    backdrop.width = width;
    backdrop.height = height;
    const bctx = backdrop.getContext('2d', { willReadFrequently: true });
    if (bctx) for (const part of parts) bctx.drawImage(part.canvas, 0, 0);
    cache.backdrop = backdrop;
    cache.artKey = artKey;
    cache.titleKey = null;
  }

  const titleKey = JSON.stringify([artKey, design.title, design.subtitle, design.showTitle, design.textColour, design.font, fontReady(design.font), design.titleEffects]);
  if (cache.titleKey !== titleKey) {
    cache.title = cache.zone && cache.backdrop ? renderTitlePart(design, cache.zone, width, height, cache.backdrop) : null;
    cache.titleKey = titleKey;
  }

  const partKinds = cache.parts.map((part) => part.kind);
  const layers = syncElements(edits, partKinds);

  const paint = new Map<string, HTMLCanvasElement>();
  for (const element of layers.elements) {
    if (element.kind !== 'paint' || !element.strokes) continue;
    const cached = cache.paint.get(element.id);
    if (cached && cached.strokes === element.strokes && cached.canvas.height === height) {
      paint.set(element.id, cached.canvas);
    } else {
      const canvas = renderPaint(element.strokes, width, height);
      cache.paint.set(element.id, { strokes: element.strokes, canvas });
      paint.set(element.id, canvas);
    }
  }
  // Forget paint layers that were deleted or undone away.
  for (const id of cache.paint.keys()) if (!paint.has(id)) cache.paint.delete(id);

  const sources: LayerSources = { parts: cache.parts, title: cache.title, paint };
  const filtering = options.finish && design.filter !== 'none';
  if (!filtering) {
    composeEdits(out, width, height, layers, sources);
  } else {
    // Everything below the title is filtered; the title and anything you put
    // above it go on clean, unless the title is to be filtered too.
    const titleIndex = layers.elements.findIndex((element) => element.kind === 'title');
    const split = design.filterTitle || titleIndex < 0 ? layers.elements.length : titleIndex;
    const below = layers.elements.slice(0, split);
    const above = layers.elements.slice(split);
    const colours = filterColours(design);
    const filterKey = JSON.stringify([
      artKey,
      design.filter,
      design.filterStrength,
      design.filterMix,
      design.seed,
      design.filterTitle ? titleKey : null,
      colours,
      Boolean(options.draft),
      below.map((e) => [e.id, e.visible, e.t, e.stamp ?? null, strokesId(e.strokes)]),
    ]);
    if (cache.filterKey !== filterKey || !cache.filtered) {
      const filtered = cache.filtered ?? document.createElement('canvas');
      const scale = options.draft ? 0.5 : 1;
      composeEdits(filtered, Math.round(width * scale), Math.round(height * scale), { elements: below }, sources);
      applyFilter(filtered, { id: design.filter, strength: design.filterStrength, mix: design.filterMix, seed: design.seed, ...colours });
      cache.filtered = filtered;
      cache.filterKey = filterKey;
    }
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(cache.filtered, 0, 0, width, height);
      drawLayers(ctx, width, height, above, sources);
    }
  }

  if (options.snapshot) composeEdits(options.snapshot, options.snapshot.width, options.snapshot.height, layers, sources);

  const boxes = new Map<string, Box>();
  for (const element of layers.elements) {
    let source: HTMLCanvasElement | null = null;
    if (element.kind === 'part') source = cache.parts.find((part) => part.kind === element.part)?.canvas ?? null;
    else if (element.kind === 'title') source = cache.title;
    else if (element.kind === 'paint') source = paint.get(element.id) ?? null;
    const box = source ? canvasBounds(source) : null;
    if (box) boxes.set(element.id, box);
  }
  return { boxes, partKinds };
}

/**
 * Whether a point (frame units) lands on a layer's painted pixels rather than
 * just inside its bounding box, so sparse layers — details, contours —
 * don't swallow clicks meant for what is under them. Falls back to the box
 * when the layer has no cached canvas (stamps are tested by their box).
 */
export function hitLayer(cache: ComposeCache, element: ThumbElement, box: Box | undefined, p: { x: number; y: number }): boolean {
  let source: HTMLCanvasElement | null = null;
  if (element.kind === 'part') source = cache.parts.find((part) => part.kind === element.part)?.canvas ?? null;
  else if (element.kind === 'title') source = cache.title;
  else if (element.kind === 'paint') source = cache.paint.get(element.id)?.canvas ?? null;
  if (!source || !box) return true;
  const H = source.height;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const scale = element.t.scale || 1;
  // Undo the move and resize to find the point on the layer as rendered.
  const ox = (cx + (p.x - cx - element.t.x) / scale) * H;
  const oy = (cy + (p.y - cy - element.t.y) / scale) * H;
  const r = Math.max(2, Math.round((7 * H) / 720 / scale));
  const x0 = Math.max(0, Math.round(ox - r));
  const y0 = Math.max(0, Math.round(oy - r));
  const x1 = Math.min(source.width, Math.round(ox + r));
  const y1 = Math.min(source.height, Math.round(oy + r));
  if (x1 <= x0 || y1 <= y0) return false;
  const data = source.getContext('2d', { willReadFrequently: true })?.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  if (!data) return true;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 24) return true;
  return false;
}

export interface IntroLayers {
  /** The thumbnail; without its title when the title comes separately. */
  base: HTMLCanvasElement;
  /** The title alone (with its move and resize), when it can be lifted off the picture. */
  title: HTMLCanvasElement | null;
  /** The title's soft, dark shadow, for hovering it over the picture. */
  titleDepth: HTMLCanvasElement | null;
  /** Centre of the title, as a fraction of the frame. */
  titleCenter: { x: number; y: number } | null;
  /** Where the title glides during the intro (its centre, as fractions), clear of the main shapes. */
  titlePath: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  /** The thumbnail taken apart, bottom to top, so each element can move out on its own. */
  pieces: IntroPiece[];
}

/** One element of the thumbnail on its own, cropped to its painted area (thumbnail pixels). */
export interface IntroPiece {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  /** The background: it stays and dissolves while everything else moves out. */
  ground: boolean;
}

/**
 * Every visible layer as its own cropped piece. A filtered picture cannot be
 * taken apart (the filter works on the whole), so it becomes a single piece
 * that moves as one.
 */
function introPieces(
  design: ThumbnailDesign,
  elements: ThumbElement[],
  cache: ComposeCache,
  base: HTMLCanvasElement,
  width: number,
  height: number,
  skip: ThumbElement | null,
): IntroPiece[] {
  if (design.filter !== 'none') return [{ canvas: base, x: 0, y: 0, ground: false }];
  const paint = new Map<string, HTMLCanvasElement>();
  for (const [id, entry] of cache.paint) paint.set(id, entry.canvas);
  const sources: LayerSources = { parts: cache.parts, title: cache.title, paint };
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [{ canvas: base, x: 0, y: 0, ground: false }];
  const pieces: IntroPiece[] = [];
  for (const element of elements) {
    if (!element.visible || element === skip) continue;
    ctx.clearRect(0, 0, width, height);
    drawLayers(ctx, width, height, [element], sources);
    const ground = element.kind === 'part' && element.part === 'ground';
    if (ground) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(sheet, 0, 0);
      pieces.push({ canvas, x: 0, y: 0, ground: true });
      continue;
    }
    // Crop to what was painted, so a 4K intro does not hold a frame per layer.
    const data = ctx.getImageData(0, 0, width, height).data;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    const step = Math.max(1, Math.floor(height / 540));
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) continue;
    x0 = Math.max(0, x0 - step * 2);
    y0 = Math.max(0, y0 - step * 2);
    x1 = Math.min(width - 1, x1 + step * 2);
    y1 = Math.min(height - 1, y1 + step * 2);
    const canvas = document.createElement('canvas');
    canvas.width = x1 - x0 + 1;
    canvas.height = y1 - y0 + 1;
    canvas.getContext('2d')?.drawImage(sheet, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    pieces.push({ canvas, x: x0, y: y0, ground: false });
  }
  return pieces;
}

/**
 * The thumbnail split for the intro: the picture and the title on separate
 * layers, so the title can float toward the camera as the picture dissolves.
 * A title that is filtered with the picture, hidden or absent stays part of it.
 */
export function composeIntroLayers(
  design: ThumbnailDesign,
  edits: ThumbEdits,
  width: number,
  height: number,
  cache: ComposeCache = createComposeCache(),
): IntroLayers {
  const base = document.createElement('canvas');
  const result = composeThumbnail(base, design, edits, width, height, { finish: true, cache });
  const layers = syncElements(edits, result.partKinds);
  const titleElement = layers.elements.find((element) => element.kind === 'title');
  const whole = () => ({
    base,
    title: null,
    titleDepth: null,
    titleCenter: null,
    titlePath: null,
    pieces: introPieces(design, layers.elements, cache, base, width, height, null),
  });
  if (!titleElement || !titleElement.visible || !cache.title || design.filterTitle) return whole();
  composeThumbnail(
    base,
    design,
    { ...layers, elements: layers.elements.map((element) => (element === titleElement ? { ...element, visible: false } : element)) },
    width,
    height,
    { finish: true, cache },
  );
  const title = document.createElement('canvas');
  title.width = width;
  title.height = height;
  const tctx = title.getContext('2d', { willReadFrequently: true });
  if (!tctx) return whole();
  drawLayers(tctx, width, height, [titleElement], { parts: cache.parts, title: cache.title, paint: new Map() });

  // Where the title sits, from its painted pixels.
  const data = tctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  const step = Math.max(1, Math.floor(height / 360));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return whole();

  // The title's soft shadow: a dark, blurred silhouette, made once here so the
  // intro only has to place it.
  const silhouette = document.createElement('canvas');
  silhouette.width = width;
  silhouette.height = height;
  const sctx = silhouette.getContext('2d');
  if (sctx) {
    sctx.drawImage(title, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = 'rgb(2, 4, 8)';
    sctx.fillRect(0, 0, width, height);
  }
  const titleDepth = document.createElement('canvas');
  titleDepth.width = width;
  titleDepth.height = height;
  const dctx = titleDepth.getContext('2d');
  if (dctx) {
    dctx.filter = `blur(${Math.max(3, Math.round(height * 0.018))}px)`;
    dctx.drawImage(silhouette, 0, 0);
    dctx.filter = 'none';
  }
  const titleCenter = { x: (x0 + x1) / 2 / width, y: (y0 + y1) / 2 / height };
  const box = { w: (x1 - x0) / width, h: (y1 - y0) / height };
  const titlePath = planTitlePath(cache.parts, base, titleCenter, box, width / height);
  const pieces = introPieces(design, layers.elements, cache, base, width, height, titleElement);
  return { base, title, titleDepth, titleCenter, titlePath, pieces };
}

/**
 * A slow glide for the hovering title that stays clear of the thumbnail's
 * main shapes. The shapes, details and the picture itself are measured on a
 * coarse grid; then every short straight drift from where the title sits is
 * scored by how much of a shape it would pass over on the way, how far it
 * goes (a good long drift is better) and how much it climbs (sideways reads
 * calmest), and the best one wins.
 */
function planTitlePath(
  parts: ThumbPart[],
  picture: HTMLCanvasElement,
  centre: { x: number; y: number },
  box: { w: number; h: number },
  aspect: number,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const GX = 64;
  const GY = 36;
  const grid = new Float32Array(GX * GY);
  for (const part of parts) {
    // The shapes count fully; details (sparks, rings…) count for less.
    const weight = part.kind === 'primary' || part.kind === 'secondary' ? 1 : part.kind === 'details' ? 0.7 : 0;
    if (!weight) continue;
    const cells = new Float32Array(GX * GY);
    const ctx = part.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    const { width: W, height: H } = part.canvas;
    const data = ctx.getImageData(0, 0, W, H).data;
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        // Any paint in a cell counts, so a field of small sparks is avoided
        // as surely as one big shape.
        let covered = 0;
        for (let sy = 0; sy < 5 && !covered; sy++) {
          for (let sx = 0; sx < 5; sx++) {
            const px = Math.min(W - 1, Math.floor(((gx + (sx + 0.5) / 5) / GX) * W));
            const py = Math.min(H - 1, Math.floor(((gy + (sy + 0.5) / 5) / GY) * H));
            if (data[(py * W + px) * 4 + 3] > 40) {
              covered = 1;
              break;
            }
          }
        }
        if (covered) cells[gy * GX + gx] = 1;
      }
    }
    // A layer painted almost everywhere (a texture, scanlines) says nothing about where to go.
    let share = 0;
    for (const c of cells) share += c;
    if (part.kind === 'details' && share / cells.length > 0.7) continue;
    for (let i = 0; i < cells.length; i++) grid[i] = Math.max(grid[i], cells[i] * weight);
  }
  // The picture itself, for designs drawn as one image (the classic styles):
  // whatever stands out from the background colour is something to steer round.
  const pctx = picture.getContext('2d', { willReadFrequently: true });
  if (pctx) {
    const { width: W, height: H } = picture;
    const data = pctx.getImageData(0, 0, W, H).data;
    const at = (fx: number, fy: number) => {
      const i = (Math.min(H - 1, Math.floor(fy * H)) * W + Math.min(W - 1, Math.floor(fx * W))) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // The background: the most common colour round the edges, coarsely binned.
    const bins = new Map<number, { n: number; c: number[] }>();
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      for (const [fx, fy] of [[t, 0.01], [t, 0.99], [0.01, t], [0.99, t]]) {
        const c = at(fx, fy);
        const key = ((c[0] >> 5) << 6) | ((c[1] >> 5) << 3) | (c[2] >> 5);
        const bin = bins.get(key) ?? { n: 0, c };
        bin.n++;
        bins.set(key, bin);
      }
    }
    let bg = [0, 0, 0];
    let most = -1;
    for (const bin of bins.values()) if (bin.n > most) [most, bg] = [bin.n, bin.c];
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        let strongest = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const c = at((gx + (sx + 0.5) / 4) / GX, (gy + (sy + 0.5) / 4) / GY);
            const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
            strongest = Math.max(strongest, d);
          }
        }
        const busy = Math.min(1, Math.max(0, (strongest - 70) / 140));
        grid[gy * GX + gx] = Math.max(grid[gy * GX + gx], busy * 0.9);
      }
    }
  }
  // A one-cell margin round every shape, so the title passes with room to spare.
  const near = new Float32Array(grid.length);
  for (let y = 0; y < GY; y++) {
    for (let x = 0; x < GX; x++) {
      let v = grid[y * GX + x];
      for (let dy = -1; dy <= 1 && v < 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < GY && xx >= 0 && xx < GX) v = Math.max(v, grid[yy * GX + xx] * 0.6);
        }
      }
      near[y * GX + x] = v;
    }
  }
  grid.set(near);
  // Summed-area table, so any box's coverage is four lookups.
  const sat = new Float32Array((GX + 1) * (GY + 1));
  for (let y = 0; y < GY; y++) {
    let row = 0;
    for (let x = 0; x < GX; x++) {
      row += grid[y * GX + x];
      sat[(y + 1) * (GX + 1) + x + 1] = sat[y * (GX + 1) + x + 1] + row;
    }
  }
  const pad = 0.025;
  const overlap = (cx: number, cy: number) => {
    const ax = Math.max(0, Math.floor((cx - box.w / 2 - pad) * GX));
    const bx = Math.min(GX, Math.ceil((cx + box.w / 2 + pad) * GX));
    const ay = Math.max(0, Math.floor((cy - box.h / 2 - pad * aspect) * GY));
    const by = Math.min(GY, Math.ceil((cy + box.h / 2 + pad * aspect) * GY));
    if (bx <= ax || by <= ay) return 0;
    const sum = sat[by * (GX + 1) + bx] - sat[ay * (GX + 1) + bx] - sat[by * (GX + 1) + ax] + sat[ay * (GX + 1) + ax];
    return sum / ((bx - ax) * (by - ay));
  };

  const edge = 0.04;
  const minX = box.w / 2 + edge;
  const maxX = 1 - box.w / 2 - edge;
  const minY = box.h / 2 + edge;
  const maxY = 1 - box.h / 2 - edge;
  const fallback = {
    from: { x: Math.max(minX, Math.min(maxX, centre.x - 0.05)), y: centre.y },
    to: { x: Math.max(minX, Math.min(maxX, centre.x + 0.05)), y: centre.y },
  };
  if (maxX <= minX || maxY < minY) return fallback;

  // The glide starts exactly where the title was placed and drifts to a
  // point nearby; every end point is scored along the whole way there.
  let best = fallback;
  let bestScore = Infinity;
  const from = { x: Math.max(minX, Math.min(maxX, centre.x)), y: Math.max(minY, Math.min(maxY, centre.y)) };
  for (let dx = -0.22; dx <= 0.22 + 1e-6; dx += 0.02) {
    for (let dy = -0.14; dy <= 0.14 + 1e-6; dy += 0.02) {
      const to = { x: from.x + dx, y: from.y + dy };
      if (to.x < minX || to.x > maxX || to.y < minY || to.y > maxY) continue;
      const distance = Math.hypot(dx, dy / aspect);
      if (distance < 0.06) continue;
      let worst = 0;
      let total = 0;
      for (let i = 1; i <= 10; i++) {
        const o = overlap(from.x + (dx * i) / 10, from.y + (dy * i) / 10);
        worst = Math.max(worst, o);
        total += o;
      }
      // Clear of the shapes above all; then a good long drift, mostly sideways.
      const score = worst * 12 + (total / 10) * 6 - Math.min(distance, 0.2) * 4 + Math.abs(dy) * 3;
      if (score < bestScore) {
        bestScore = score;
        best = { from, to };
      }
    }
  }
  return best;
}
