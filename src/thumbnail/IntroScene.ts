import { createComposeCache, composeThumbnail } from './Compose';
import { canvasBounds, drawLayers, layerMatrix, syncElements, type LayerSources, type ThumbEdits, type ThumbElement } from './Editor';
import type { ThumbnailDesign } from './ThumbnailDesign';
import { renderThumbnailParts, renderTitlePart, type ThumbPart } from './ThumbnailRenderer';
import { replayElement, type VectorElement } from './VectorRecorder';

/**
 * The thumbnail as a scene of separate elements, for the Fly through intro.
 *
 * Every part of the design is drawn again with a recorder in front of it, so
 * each drawing operation comes back as its own element: each shard of a
 * Shard Burst, each spark, ring, arc and stroke, each line of the title.
 * They are kept as vectors, so the camera can come as close as it likes and
 * they stay sharp. What cannot be taken apart becomes a sharp, full
 * resolution image piece instead: a filtered picture, a layer coloured with
 * the gradient, your own paint and stamps. Whatever fills the whole frame
 * (the background, a full-frame glow) becomes the backdrop at the far end.
 */

export interface SceneElement {
  /** A vector element and the matrix from where it was recorded to thumbnail pixels. */
  vector?: VectorElement;
  /** Or an image piece, placed by `base` (its own pixels to thumbnail pixels). */
  image?: HTMLCanvasElement;
  base: DOMMatrix;
  /** Centre and size in thumbnail pixels. */
  cx: number;
  cy: number;
  size: number;
  /** Part of the title: it flies past last. */
  title: boolean;
}

export interface IntroScene {
  width: number;
  height: number;
  /** Everything that fills the frame, flattened: the far end of the tunnel. */
  backdrop: HTMLCanvasElement;
  /** Bottom to top. */
  elements: SceneElement[];
  /** The finished thumbnail exactly as designed: shown until the camera moves, so the start is seamless. */
  flat: HTMLCanvasElement;
}

/** Elements drawn with these blend over everything below them (grain), which has no place in a 3D scene. */
const FLAT_ONLY = new Set(['overlay', 'multiply', 'soft-light', 'hard-light', 'color-burn', 'color-dodge', 'difference', 'exclusion', 'source-atop', 'destination-out', 'destination-in', 'source-in']);

export function composeIntroScene(design: ThumbnailDesign, edits: ThumbEdits, width: number, height: number): IntroScene {
  const cache = createComposeCache();
  const flat = document.createElement('canvas');
  const result = composeThumbnail(flat, design, edits, width, height, { finish: true, cache });
  const layers = syncElements(edits, result.partKinds);

  const backdrop = document.createElement('canvas');
  backdrop.width = width;
  backdrop.height = height;
  const bctx = backdrop.getContext('2d');
  const elements: SceneElement[] = [];
  const frameArea = width * height;

  const pushVector = (vector: VectorElement, base: DOMMatrix, title: boolean) => {
    const b = vector.bounds;
    if (!Number.isFinite(b.x0) || b.x1 <= b.x0) return;
    const corners = [
      new DOMPoint(b.x0, b.y0).matrixTransform(base),
      new DOMPoint(b.x1, b.y1).matrixTransform(base),
    ];
    const x0 = Math.max(0, Math.min(corners[0].x, corners[1].x));
    const x1 = Math.min(width, Math.max(corners[0].x, corners[1].x));
    const y0 = Math.max(0, Math.min(corners[0].y, corners[1].y));
    const y1 = Math.min(height, Math.max(corners[0].y, corners[1].y));
    if (x1 <= x0 || y1 <= y0) return;
    // A see-through full-frame image (a shape drawn as a per-pixel field) is
    // really just the shape: crop it to what it paints and fly that.
    if (!title && vector.kind === 'image' && (x1 - x0) * (y1 - y0) > frameArea * 0.6) {
      const piece = croppedImage(vector);
      if (piece) {
        const placed = base.multiply(vector.m).multiply(piece.place);
        const area = piece.coverage;
        if (area < 0.6) {
          const p0 = new DOMPoint(0, 0).matrixTransform(placed);
          const p1 = new DOMPoint(piece.canvas.width, piece.canvas.height).matrixTransform(placed);
          elements.push({
            image: piece.canvas,
            base: placed,
            cx: (p0.x + p1.x) / 2,
            cy: (p0.y + p1.y) / 2,
            size: Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)),
            title,
          });
          return;
        }
      }
    }
    // Whatever covers most of the frame is background, not something to fly past.
    if (!title && (x1 - x0) * (y1 - y0) > frameArea * 0.6) {
      if (bctx) replayElement(bctx, vector, base);
      return;
    }
    elements.push({ vector, base, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0), title });
  };

  /** A layer as one sharp image piece, cropped to what it painted. */
  const pushImage = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const sheet = document.createElement('canvas');
    sheet.width = width;
    sheet.height = height;
    const sctx = sheet.getContext('2d', { willReadFrequently: true });
    if (!sctx) return;
    draw(sctx);
    const box = canvasBounds(sheet);
    if (!box) return;
    const x0 = Math.max(0, Math.floor(box.x0 * height) - 2);
    const y0 = Math.max(0, Math.floor(box.y0 * height) - 2);
    const x1 = Math.min(width, Math.ceil(box.x1 * height) + 2);
    const y1 = Math.min(height, Math.ceil(box.y1 * height) + 2);
    const piece = document.createElement('canvas');
    piece.width = Math.max(1, x1 - x0);
    piece.height = Math.max(1, y1 - y0);
    piece.getContext('2d')?.drawImage(sheet, x0, y0, piece.width, piece.height, 0, 0, piece.width, piece.height);
    elements.push({ image: piece, base: new DOMMatrix().translate(x0, y0), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0), title: false });
  };

  const paint = new Map<string, HTMLCanvasElement>();
  for (const [id, entry] of cache.paint) paint.set(id, entry.canvas);
  const sources: LayerSources = { parts: cache.parts, title: cache.title, paint };
  const drawOne = (element: ThumbElement) => (ctx: CanvasRenderingContext2D) => drawLayers(ctx, width, height, [element], sources);

  // A filter works on the picture as a whole, so a filtered picture can only
  // be taken apart into its layers as the filter left them.
  const filtered = design.filter !== 'none';
  const recorded: ThumbPart[] = filtered
    ? []
    : // The same texture resolution as the finished thumbnail, so the scene matches it pixel for pixel.
      renderThumbnailParts(design, width, height, { record: true }).parts;
  const titleElement = layers.elements.find((element) => element.kind === 'title');
  const filterSplit = filtered && !design.filterTitle && titleElement ? layers.elements.indexOf(titleElement) : -1;

  layers.elements.forEach((element, index) => {
    if (!element.visible) return;
    if (filtered && element.kind !== 'title' && (filterSplit < 0 || index < filterSplit)) return;
    if (element.kind === 'part') {
      const part = recorded.find((p) => p.kind === element.part);
      const shown = cache.parts.find((p) => p.kind === element.part);
      if (!part || !shown) return;
      const box = canvasBounds(shown.canvas);
      const m = box ? layerMatrix(box, element.t, height) : new DOMMatrix();
      if (element.part === 'ground') {
        if (bctx) {
          bctx.setTransform(m);
          bctx.drawImage(shown.canvas, 0, 0, width, height);
          bctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        return;
      }
      // Coloured with the gradient after drawing: keep it as the image it became.
      if ((design.gradientTargets as string[]).includes(element.part ?? '') || !part.elements) {
        pushImage(drawOne(element));
        return;
      }
      for (const vector of part.elements) {
        // Blends like grain stay on the backdrop rather than vanishing, so nothing changes at the cut.
        if (FLAT_ONLY.has(vector.state.globalCompositeOperation)) {
          if (bctx) replayElement(bctx, vector, m);
          continue;
        }
        pushVector(vector, m, false);
      }
    } else if (element.kind === 'title') {
      if (!cache.title || !cache.zone || !cache.backdrop) return;
      if (filtered && design.filterTitle) return;
      const recordedTitle: VectorElement[] = [];
      renderTitlePart(design, cache.zone, width, height, cache.backdrop, recordedTitle);
      const box = canvasBounds(cache.title);
      const m = box ? layerMatrix(box, element.t, height) : new DOMMatrix();
      for (const vector of recordedTitle) pushVector(vector, m, true);
    } else {
      // Your paint and stamps.
      pushImage(drawOne(element));
    }
  });

  if (filtered) {
    // The filtered picture below the title (or all of it) as the backdrop.
    const below = document.createElement('canvas');
    composeThumbnail(
      below,
      design,
      { elements: layers.elements.map((element, index) => (filterSplit >= 0 && index >= filterSplit ? { ...element, visible: false } : element)) },
      width,
      height,
      { finish: true },
    );
    bctx?.drawImage(below, 0, 0);
  }
  return { width, height, backdrop, elements, flat };
}

/**
 * The painted part of a recorded drawImage, cropped out, with the matrix that
 * puts the crop where the full image would have put it, and how much of the
 * image the crop covers.
 */
function croppedImage(vector: VectorElement): { canvas: HTMLCanvasElement; place: DOMMatrix; coverage: number } | null {
  const [image, ...n] = (vector.args ?? []) as [HTMLCanvasElement, ...number[]];
  if (!(image instanceof HTMLCanvasElement) || n.length >= 8) return null;
  const sw = image.width;
  const sh = image.height;
  const [dx, dy, dw, dh] = n.length >= 4 ? n : [n[0], n[1], sw, sh];
  const ctx = image.getContext('2d', { willReadFrequently: true });
  if (!ctx || !sw || !sh) return null;
  const data = ctx.getImageData(0, 0, sw, sh).data;
  let x0 = sw;
  let y0 = sh;
  let x1 = -1;
  let y1 = -1;
  const step = Math.max(1, Math.floor(sh / 540));
  for (let y = 0; y < sh; y += step) {
    for (let x = 0; x < sw; x += step) {
      if (data[(y * sw + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - step);
  y0 = Math.max(0, y0 - step);
  x1 = Math.min(sw - 1, x1 + step);
  y1 = Math.min(sh - 1, y1 + step);
  const canvas = document.createElement('canvas');
  canvas.width = x1 - x0 + 1;
  canvas.height = y1 - y0 + 1;
  canvas.getContext('2d')?.drawImage(image, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const sx = dw / sw;
  const sy = dh / sh;
  return {
    canvas,
    place: new DOMMatrix().translate(dx + x0 * sx, dy + y0 * sy).scale(sx, sy),
    coverage: (canvas.width * canvas.height) / (sw * sh),
  };
}
