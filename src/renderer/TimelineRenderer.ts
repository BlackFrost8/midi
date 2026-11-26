import { unitToX, visibleRange } from '../layout/LayoutEngine';
import { formatBarBeat, formatSeconds, formatTimecode } from '../utils/formatting';
import { withAlpha } from '../utils/colors';
import { lowerBound } from '../utils/math';
import { barDomainValue, calculateGridStride } from './GridRenderer';
import { fitText, font, resetLetterSpacing, setLetterSpacing, type Scene } from './Scene';

/** Nice-looking tick intervals for the seconds/timecode rulers. */
const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Minimum pixels between two ruler labels before the stride doubles. */
const MIN_LABEL_SPACING = 62;

export function renderRuler(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout, viewport, project } = scene;
  if (!settings.showRuler || layout.rulerHeight <= 0) return;

  const theme = settings.theme;
  const scale = layout.scale;

  ctx.save();
  ctx.fillStyle = theme.rulerBackground;
  ctx.fillRect(layout.panelX, layout.rulerTop, layout.panelWidth + layout.contentWidth, layout.rulerHeight);

  // Baseline under the ruler.
  const baselineY =
    Math.round((layout.rulerTop + layout.rulerHeight) * viewport.pixelRatio) / viewport.pixelRatio;
  ctx.strokeStyle = withAlpha(theme.rulerLine, 0.9);
  ctx.lineWidth = Math.max(1 / viewport.pixelRatio, 0.5);
  ctx.beginPath();
  ctx.moveTo(layout.panelX, baselineY);
  ctx.lineTo(layout.contentX + layout.contentWidth, baselineY);
  ctx.stroke();

  // Tempo / time-signature readout in the panel gutter.
  if (layout.panelWidth > 90 * scale) {
    ctx.fillStyle = withAlpha(theme.rulerText, 0.85);
    ctx.font = font(9.5 * scale, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    setLetterSpacing(ctx, 1.1 * scale);
    const sig = project.timeSignatures[0];
    const bpm = Math.round(project.tempos[0]?.bpm ?? 120);
    const label = `${bpm} BPM · ${sig ? `${sig.numerator}/${sig.denominator}` : '4/4'}`;
    ctx.fillText(
      fitText(ctx, label.toUpperCase(), layout.panelWidth - 16 * scale),
      layout.panelX + 2 * scale,
      layout.rulerTop + layout.rulerHeight / 2,
    );
    resetLetterSpacing(ctx);
  }

  ctx.beginPath();
  ctx.rect(layout.contentX, layout.rulerTop, layout.contentWidth, layout.rulerHeight);
  ctx.clip();

  ctx.font = font(10 * scale, 500);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const textY = layout.rulerTop + layout.rulerHeight * 0.5;

  if (layout.domain === 'beats') {
    renderMusicalRuler(ctx, scene, textY);
  } else {
    renderTimeRuler(ctx, scene, textY);
  }

  ctx.restore();
}

function renderMusicalRuler(ctx: CanvasRenderingContext2D, scene: Scene, textY: number): void {
  const { project, layout, viewport, settings } = scene;
  const theme = settings.theme;
  const { start, end } = visibleRange(layout, viewport);
  const stride = calculateGridStride(scene);

  // Labels need more room than grid lines, so widen the stride further.
  let labelStride = stride.barStride;
  while (stride.barSpacing * labelStride < MIN_LABEL_SPACING * layout.scale && labelStride < 4096) {
    labelStride *= 2;
  }

  const from = lowerBound(project.bars, start, (bar) => barDomainValue(bar, layout.domain));
  const tickPath = new Path2D();
  let drawn = 0;

  for (let i = from; i < project.bars.length; i++) {
    const bar = project.bars[i];
    const unit = barDomainValue(bar, layout.domain);
    if (unit > end) break;
    if (!bar.isDownbeat) continue;
    if ((bar.bar - 1) % labelStride !== 0) continue;

    const x = unitToX(unit, layout, viewport);
    tickPath.moveTo(x, layout.rulerTop + layout.rulerHeight * 0.62);
    tickPath.lineTo(x, layout.rulerTop + layout.rulerHeight);

    ctx.fillStyle = theme.rulerText;
    const label =
      settings.timelineMode === 'beats' ? formatBarBeat(bar.bar, bar.beatInBar) : String(bar.bar);
    ctx.fillText(label, x + 5 * layout.scale, textY);

    if (++drawn > 2000) break;
  }

  ctx.strokeStyle = withAlpha(theme.rulerLine, 1);
  ctx.stroke(tickPath);
}

function renderTimeRuler(ctx: CanvasRenderingContext2D, scene: Scene, textY: number): void {
  const { layout, viewport, settings } = scene;
  const theme = settings.theme;
  const { start, end } = visibleRange(layout, viewport);

  // Pick the smallest "nice" interval that keeps labels far enough apart.
  const minSpacing = MIN_LABEL_SPACING * layout.scale;
  let step = SECOND_STEPS[SECOND_STEPS.length - 1];
  for (const candidate of SECOND_STEPS) {
    if (candidate * viewport.pxPerUnit >= minSpacing) {
      step = candidate;
      break;
    }
  }

  const tickPath = new Path2D();
  const first = Math.floor(start / step) * step;
  let drawn = 0;

  for (let t = first; t <= end; t += step) {
    if (t < 0) continue;
    const x = unitToX(t, layout, viewport);
    tickPath.moveTo(x, layout.rulerTop + layout.rulerHeight * 0.62);
    tickPath.lineTo(x, layout.rulerTop + layout.rulerHeight);

    ctx.fillStyle = theme.rulerText;
    ctx.fillText(
      settings.timelineMode === 'timecode' ? formatTimecode(t) : formatSeconds(t),
      x + 5 * layout.scale,
      textY,
    );
    if (++drawn > 2000) break;
  }

  ctx.strokeStyle = withAlpha(theme.rulerLine, 1);
  ctx.stroke(tickPath);
}

/**
 * The faint continuation of each marker line through the arrangement. Drawn
 * with the grid, before clips, so a section boundary never slices across a clip
 * header.
 */
export function renderMarkerLines(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { project, settings, layout, viewport } = scene;
  if (!settings.showMarkers || !project.markers.length) return;

  const { start, end } = visibleRange(layout, viewport);
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.gridTop, layout.contentWidth, layout.gridBottom - layout.gridTop);
  ctx.clip();

  const path = new Path2D();
  for (const marker of project.markers) {
    const unit = layout.domain === 'beats' ? marker.beats : marker.seconds;
    if (unit < start || unit > end) continue;
    const x = Math.round(unitToX(unit, layout, viewport) * viewport.pixelRatio) / viewport.pixelRatio;
    path.moveTo(x, layout.gridTop);
    path.lineTo(x, layout.gridBottom);
  }
  ctx.strokeStyle = withAlpha(settings.theme.sectionLine, 0.55);
  ctx.lineWidth = Math.max(1 / viewport.pixelRatio, 0.5);
  ctx.stroke(path);
  ctx.restore();
}

/**
 * Section marker labels in the band above the ruler. Only real MIDI markers are
 * drawn — the spec is explicit that we must not fabricate section names.
 */
export function renderMarkers(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { project, settings, layout, viewport } = scene;
  if (!settings.showMarkers || !project.markers.length || layout.markerHeight <= 0) return;

  const theme = settings.theme;
  const scale = layout.scale;
  const { start, end } = visibleRange(layout, viewport);

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.markerTop, layout.contentWidth, layout.markerHeight);
  ctx.clip();

  ctx.font = font(10 * scale, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  setLetterSpacing(ctx, 1.4 * scale);

  const linePath = new Path2D();
  for (let i = 0; i < project.markers.length; i++) {
    const marker = project.markers[i];
    const unit = layout.domain === 'beats' ? marker.beats : marker.seconds;
    if (unit > end) break;
    const next = project.markers[i + 1];
    const nextUnit = next ? (layout.domain === 'beats' ? next.beats : next.seconds) : Infinity;
    if (nextUnit < start) continue;

    const x = unitToX(unit, layout, viewport);
    linePath.moveTo(x, layout.markerTop + layout.markerHeight * 0.2);
    linePath.lineTo(x, layout.markerTop + layout.markerHeight);

    const available = Math.min(
      (nextUnit === Infinity ? end : nextUnit) * viewport.pxPerUnit - unit * viewport.pxPerUnit,
      layout.contentWidth,
    ) - 10 * scale;
    ctx.fillStyle = theme.sectionText;
    ctx.fillText(
      fitText(ctx, marker.text.toUpperCase(), Math.max(available, 30 * scale)),
      x + 6 * scale,
      layout.markerTop + layout.markerHeight * 0.55,
    );
  }

  resetLetterSpacing(ctx);
  ctx.strokeStyle = withAlpha(theme.sectionLine, 0.9);
  ctx.lineWidth = Math.max(1 / viewport.pixelRatio, 0.5);
  ctx.stroke(linePath);
  ctx.restore();
}

/** Optional title burned into the top-left of the frame for exports. */
export function renderTitle(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout, project } = scene;
  if (!settings.showTitle) return;

  const text = (settings.titleText || project.title || '').trim();
  if (!text) return;

  const scale = layout.scale;
  ctx.save();
  ctx.fillStyle = settings.theme.titleText;
  ctx.font = font(22 * scale, 300);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  setLetterSpacing(ctx, 4 * scale);
  ctx.fillText(
    fitText(ctx, text.toUpperCase(), layout.panelWidth + layout.contentWidth),
    layout.panelX,
    layout.titleTop + layout.titleHeight * 0.5,
  );
  resetLetterSpacing(ctx);
  ctx.restore();
}
