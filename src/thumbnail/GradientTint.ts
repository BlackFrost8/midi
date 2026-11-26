import type { GradientDirection } from './Palette';

/**
 * The gradient from the Colour section laid over shapes and the title, when
 * you aim it at them instead of (or as well as) the background.
 */

/** A linear gradient through all the stops, across a box. */
export function boxGradient(
  ctx: CanvasRenderingContext2D,
  stops: string[],
  direction: GradientDirection,
  x: number,
  y: number,
  w: number,
  h: number,
): CanvasGradient {
  const gradient =
    direction === 'horizontal'
      ? ctx.createLinearGradient(x, y, x + w, y)
      : direction === 'vertical'
        ? ctx.createLinearGradient(x, y, x, y + h)
        : ctx.createLinearGradient(x, y, x + w, y + h);
  stops.forEach((color, i) => gradient.addColorStop(i / Math.max(1, stops.length - 1), color));
  return gradient;
}

/**
 * Recolours a layer's painted pixels with the gradient, laid across the
 * layer's own bounds, keeping a little of its original shading so a shape
 * still reads as lit rather than cut out of paper.
 */
export function tintLayer(canvas: HTMLCanvasElement, stops: string[], direction: GradientDirection): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || stops.length < 2) return;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  // Coarse scan for the painted area.
  const step = Math.max(1, Math.floor(Math.min(width, height) / 360));
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
  if (x1 < x0 || y1 < y0) return;
  const original = document.createElement('canvas');
  original.width = width;
  original.height = height;
  original.getContext('2d')?.drawImage(canvas, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = boxGradient(ctx, stops, direction, x0, y0, x1 - x0 + step, y1 - y0 + step);
  ctx.fillRect(0, 0, width, height);
  // Bring back the shape's own light and shade, softly.
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.55;
  ctx.drawImage(original, 0, 0);
  ctx.restore();
}
