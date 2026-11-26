import { renderBackground, renderVignette } from './BackgroundRenderer';
import { renderCards } from './CardRenderer';
import { renderClipBodies, renderClipHeaders, renderLaneGlow } from './ClipRenderer';
import { renderGrid, renderScrollIndicator, renderTrackSeparators } from './GridRenderer';
import { renderNotes } from './NoteRenderer';
import { renderPlayhead } from './PlayheadRenderer';
import type { RenderCache } from './RenderCache';
import type { Scene } from './Scene';
import { renderMarkerLines, renderMarkers, renderRuler, renderTitle } from './TimelineRenderer';
import { renderTrackPanel } from './TrackPanelRenderer';

export interface RenderOptions {
  /** false paints onto transparency, for PNG exports with no background. */
  opaqueBackground?: boolean;
}

/**
 * The single entry point for drawing a frame. Draw order matters: background,
 * then structure, then clips, then notes, then the playhead on top, with the
 * vignette last so it darkens everything uniformly.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  cache: RenderCache,
  options: RenderOptions = {},
): void {
  const opaque = options.opaqueBackground !== false;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  // Each layer is isolated: if one fails on unusual data, the rest of the
  // frame — the playhead above all — still draws, rather than the whole
  // picture freezing while the music plays on.
  layer(ctx, 'background', () => renderBackground(ctx, scene, opaque));
  layer(ctx, 'title', () => renderTitle(ctx, scene));
  // Clip bodies first, then the grid over them so bar divisions stay visible
  // inside a clip, then the headers on top so no line crosses a label.
  layer(ctx, 'lane glow', () => renderLaneGlow(ctx, scene));
  layer(ctx, 'clip bodies', () => renderClipBodies(ctx, scene));
  layer(ctx, 'grid', () => renderGrid(ctx, scene));
  layer(ctx, 'marker lines', () => renderMarkerLines(ctx, scene));
  layer(ctx, 'track separators', () => renderTrackSeparators(ctx, scene));
  layer(ctx, 'clip headers', () => renderClipHeaders(ctx, scene));
  layer(ctx, 'notes', () => renderNotes(ctx, scene, cache));
  layer(ctx, 'track panel', () => renderTrackPanel(ctx, scene));
  layer(ctx, 'ruler', () => renderRuler(ctx, scene));
  layer(ctx, 'markers', () => renderMarkers(ctx, scene));
  layer(ctx, 'playhead', () => renderPlayhead(ctx, scene));
  layer(ctx, 'scroll indicator', () => renderScrollIndicator(ctx, scene));
  layer(ctx, 'vignette', () => renderVignette(ctx, scene));
  layer(ctx, 'cards', () => renderCards(ctx, scene));

  ctx.restore();
}

/** Layers that have already reported an error, so a failing one logs once rather than every frame. */
const reported = new Set<string>();

/**
 * Draws one layer with its own canvas state. A layer that throws is skipped
 * for this frame and reported once in the console; it cannot leave a clip or
 * transform behind for the layers after it.
 */
function layer(ctx: CanvasRenderingContext2D, name: string, draw: () => void): void {
  ctx.save();
  try {
    draw();
  } catch (error) {
    if (!reported.has(name)) {
      reported.add(name);
      console.error(`Rendering the ${name} failed; the rest of the frame is still drawn.`, error);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Sizes a canvas's backing store for the given device pixel ratio and returns a
 * context pre-scaled so all drawing can stay in logical pixels.
 */
export function prepareContext(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  pixelRatio: number,
): CanvasRenderingContext2D | null {
  const width = Math.max(Math.round(logicalWidth * pixelRatio), 1);
  const height = Math.max(Math.round(logicalHeight * pixelRatio), 1);

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return ctx;
}
