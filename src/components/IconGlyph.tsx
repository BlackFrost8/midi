import { useEffect, useRef } from 'react';
import { drawIcon, type IconName } from '../renderer/iconLibrary';
import { makeIconGradient } from '../renderer/IconPaint';
import type { IconGradientStyle } from '../models/RenderSettings';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  /** Paint in this gradient instead of a flat colour, as the arrangement does. */
  gradient?: { colors: string[]; style: IconGradientStyle } | null;
}

/**
 * Renders a library icon into a small canvas.
 *
 * The picker uses the same drawing code as the arrangement, so what you choose
 * here is exactly what appears in the track panel and in exports — no second
 * set of SVG copies to keep in sync.
 */
export function IconGlyph({ name, size = 16, color = 'currentColor', gradient = null }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const inset = size * 0.1;
    const box = size - inset * 2;
    // `currentColor` is not meaningful to canvas, so resolve it from the DOM.
    ctx.strokeStyle = gradient
      ? makeIconGradient(ctx, gradient.style, gradient.colors, inset, inset, box)
      : color === 'currentColor'
        ? getComputedStyle(canvas).color || '#dce5e4'
        : color;
    ctx.lineWidth = Math.max(size / 14, 0.9);
    drawIcon(ctx, name, inset, inset, box);
    // The gradient is compared by value: a fresh array each render must not redraw.
  }, [color, name, size, gradient?.style, gradient?.colors.join(',')]);

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} />;
}
