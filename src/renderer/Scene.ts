import type { MidiProject, TrackState } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import type { LayoutResult, Viewport } from '../layout/LayoutEngine';
import type { IntroScene } from '../thumbnail/IntroScene';

/**
 * Everything a single frame needs. The interactive canvas and the export
 * renderer both build one of these and hand it to `renderScene`, which is what
 * guarantees an export is not a screenshot but the same picture re-rendered.
 */
export interface Scene {
  project: MidiProject;
  settings: RenderSettings;
  trackStates: Map<string, TrackState>;
  layout: LayoutResult;
  viewport: Viewport;
  /** Playhead position in the layout's active domain (beats or seconds). */
  playheadUnit: number;
  /** Playhead position in seconds, for afterglow timing. */
  playheadSeconds: number;
  selectedNoteId: string | null;
  hoveredNoteId: string | null;
  /** Suppresses interaction-only affordances (hover ring, selection) on export. */
  forExport: boolean;
  /**
   * The real time for the intro and end cards. An export holds the
   * arrangement on its last note while the end card plays on, so this can run
   * past playheadSeconds. Absent, the cards use playheadSeconds.
   */
  clockSeconds?: number;
  /** For the intro card: where the video starts (before 0 when a recording leads in), and the thumbnail to show. */
  intro?: IntroSource;
}

export interface IntroSource {
  start: number;
  /** The thumbnail taken apart into its individual elements, for the 3D fly through. */
  scene3d?: IntroScene | null;
  image: CanvasImageSource | null;
  /** The thumbnail's title on its own layer, so it can lift off in 3D as the picture fades. */
  title?: CanvasImageSource | null;
  titleDepth?: CanvasImageSource | null;
  /** Centre of the title as a fraction of the thumbnail. */
  titleCenter?: { x: number; y: number } | null;
  /** Where the title glides while it hovers (centre fractions), clear of the main shapes. */
  titlePath?: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  /** The thumbnail taken apart, bottom to top, in thumbnail pixels, for animations that move elements out. */
  pieces?: Array<{ canvas: CanvasImageSource & { width: number; height: number }; x: number; y: number; ground: boolean }>;
}

export const FONT_STACK =
  "'Inter', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

export function font(sizePx: number, weight: number | string = 400): string {
  return `${weight} ${sizePx}px ${FONT_STACK}`;
}

/**
 * `ctx.letterSpacing` is not in every engine; setting it is harmless where it is
 * missing but we still reset it to avoid leaking spacing into later text.
 */
export function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  const target = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in target) target.letterSpacing = `${px}px`;
}

export function resetLetterSpacing(ctx: CanvasRenderingContext2D): void {
  setLetterSpacing(ctx, 0);
}

/** Truncates with an ellipsis to fit `maxWidth`, measured in the current font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : '';
}

/** Rounded rect on the current path, falling back to a plain rect. */
export function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0.35) {
    ctx.rect(x, y, w, h);
    return;
  }
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}
