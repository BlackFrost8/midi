import { darken, parseHex, withAlpha } from '../utils/colors';
import type { Scene } from './Scene';

/**
 * Base fill plus the two restrained atmospheric touches the spec allows: a wide
 * radial wash and a vignette. Nothing else — no particles, no flares.
 */
export function renderBackground(ctx: CanvasRenderingContext2D, scene: Scene, opaque = true): void {
  const { settings, viewport } = scene;
  const { width, height } = viewport;
  const theme = settings.theme;

  ctx.clearRect(0, 0, width, height);

  if (opaque) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
  }

  if (settings.backgroundGlow > 0.001 && opaque) {
    // Centred slightly above the middle so the arrangement sits in the light.
    const cx = width * 0.5;
    const cy = height * 0.42;
    const radius = Math.max(width, height) * 0.75;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, withAlpha(theme.backgroundGlow, 0.9 * settings.backgroundGlow));
    gradient.addColorStop(0.55, withAlpha(theme.backgroundGlow, 0.28 * settings.backgroundGlow));
    gradient.addColorStop(1, withAlpha(theme.backgroundGlow, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

/** Drawn last so it darkens everything, including notes near the frame edge. */
export function renderVignette(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, viewport } = scene;
  if (settings.vignette <= 0.001) return;

  const { width, height } = viewport;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const radius = Math.hypot(width, height) * 0.62;

  // Derive the falloff colour from the background rather than using flat black,
  // so a light theme gets a soft grey edge instead of a bruise in each corner.
  const edge = darken(settings.theme.background, 0.72);
  const { r, g, b } = parseHex(edge);

  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.42, cx, cy, radius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${0.75 * settings.vignette})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}
