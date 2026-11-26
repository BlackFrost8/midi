import { TimeMapper } from '../midi/TimeMapper';
import type { BarLine } from '../models/MidiProject';
import { unitToX, visibleRange } from '../layout/LayoutEngine';
import type { LayoutResult, TimeDomain, Viewport } from '../layout/LayoutEngine';
import { withAlpha } from '../utils/colors';
import { lowerBound } from '../utils/math';
import type { Scene } from './Scene';

/** Minimum on-screen spacing before bar lines start being skipped. */
const MIN_BAR_SPACING = 16;
/** Minimum on-screen spacing before beat lines are dropped entirely. */
const MIN_BEAT_SPACING = 13;

export function barDomainValue(bar: BarLine, domain: TimeDomain): number {
  return domain === 'beats' ? bar.beats : bar.seconds;
}

export interface GridStride {
  /** Draw every Nth bar. */
  barStride: number;
  /** On-screen pixels between adjacent bars at the current zoom. */
  barSpacing: number;
  beatSpacing: number;
  showBeats: boolean;
}

/**
 * Chooses how much of the grid to draw at the current zoom. Zoomed out, drawing
 * every bar would produce a solid wall of lines that competes with the notes —
 * exactly what the spec forbids — so the stride doubles until lines are far
 * enough apart to read.
 */
export function calculateGridStride(scene: Scene): GridStride {
  const { project, layout, viewport, settings } = scene;
  const sig = project.timeSignatures.length
    ? project.timeSignatures[0]
    : { numerator: 4, denominator: 4 };
  const beatsPerBar = TimeMapper.beatsPerBar(sig);
  const beatsPerPulse = TimeMapper.beatsPerPulse(sig);

  // In the seconds domain a "bar" spans a tempo-dependent number of seconds.
  const secondsPerBeat = 60 / (project.tempos[0]?.bpm ?? 120);
  const unitsPerBar = layout.domain === 'beats' ? beatsPerBar : beatsPerBar * secondsPerBeat;
  const unitsPerPulse = layout.domain === 'beats' ? beatsPerPulse : beatsPerPulse * secondsPerBeat;

  const barSpacing = unitsPerBar * viewport.pxPerUnit;
  const beatSpacing = unitsPerPulse * viewport.pxPerUnit;

  let barStride = 1;
  const minSpacing = MIN_BAR_SPACING * layout.scale;
  while (barSpacing * barStride < minSpacing && barStride < 1024) barStride *= 2;

  return {
    barStride,
    barSpacing,
    beatSpacing,
    showBeats: settings.showBeatLines && beatSpacing >= MIN_BEAT_SPACING * layout.scale,
  };
}

/** Index of the first bar line at or after `unit`. */
function firstBarIndex(bars: BarLine[], domain: TimeDomain, unit: number): number {
  return lowerBound(bars, unit, (bar) => barDomainValue(bar, domain));
}

export function renderGrid(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { project, settings, layout, viewport } = scene;
  if (!settings.showGrid || !project.bars.length) return;

  const theme = settings.theme;
  const { start, end } = visibleRange(layout, viewport);
  const stride = calculateGridStride(scene);

  const top = layout.gridTop;
  const bottom = layout.gridBottom;
  if (bottom - top < 1) return;
  const hairline = Math.max(1 / viewport.pixelRatio, 0.5);

  const from = firstBarIndex(project.bars, layout.domain, start);
  const barPath = new Path2D();
  const beatPath = new Path2D();
  let barsDrawn = 0;
  let beatsDrawn = 0;

  for (let i = from; i < project.bars.length; i++) {
    const bar = project.bars[i];
    const unit = barDomainValue(bar, layout.domain);
    if (unit > end) break;

    const isBar = bar.isDownbeat;
    if (isBar && (bar.bar - 1) % stride.barStride !== 0) continue;
    if (!isBar && !stride.showBeats) continue;

    // Snap to a device pixel so hairlines do not smear across two columns.
    const x = Math.round(unitToX(unit, layout, viewport) * viewport.pixelRatio) / viewport.pixelRatio;
    if (x < layout.contentX - 1 || x > layout.contentX + layout.contentWidth + 1) continue;

    const path = isBar ? barPath : beatPath;
    path.moveTo(x, top);
    path.lineTo(x, bottom);
    if (isBar) barsDrawn++;
    else beatsDrawn++;

    // Hard safety valve for pathological files.
    if (barsDrawn + beatsDrawn > 20000) break;
  }

  // The file only defines bars up to its last note, but a following camera
  // keeps moving after that. Carry on ruling bars at the final metre and tempo
  // so the ending scrolls out over a grid rather than a blank.
  const lastBar = lastDownbeat(project.bars);
  if (lastBar) {
    const sig = project.timeSignatures[project.timeSignatures.length - 1] ?? { numerator: 4, denominator: 4 };
    const beatsPerBar = TimeMapper.beatsPerBar(sig);
    const bpm = project.tempos[project.tempos.length - 1]?.bpm ?? 120;
    const unitsPerBar = layout.domain === 'beats' ? beatsPerBar : (beatsPerBar * 60) / bpm;
    const lastUnit = barDomainValue(lastBar, layout.domain);
    if (unitsPerBar > 0 && lastUnit < end) {
      const firstStep = Math.max(1, Math.ceil((start - lastUnit) / unitsPerBar));
      for (let step = firstStep; barsDrawn < 20000; step++) {
        const unit = lastUnit + step * unitsPerBar;
        if (unit > end) break;
        if ((lastBar.bar - 1 + step) % stride.barStride !== 0) continue;
        const x = Math.round(unitToX(unit, layout, viewport) * viewport.pixelRatio) / viewport.pixelRatio;
        barPath.moveTo(x, top);
        barPath.lineTo(x, bottom);
        barsDrawn++;
      }
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, top, layout.contentWidth, bottom - top);
  ctx.clip();
  ctx.lineWidth = hairline;

  if (beatsDrawn) {
    ctx.strokeStyle = withAlpha(theme.gridBeat, settings.gridBeatOpacity);
    ctx.stroke(beatPath);
  }
  if (barsDrawn) {
    ctx.strokeStyle = withAlpha(theme.gridBar, settings.gridBarOpacity);
    ctx.stroke(barPath);
  }
  ctx.restore();
}

/** Very low-opacity rules between lanes, per the spec's "preserve the black". */
export function renderTrackSeparators(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout, viewport } = scene;
  if (!settings.showSeparators || !layout.lanes.length) return;

  const hairline = Math.max(1 / viewport.pixelRatio, 0.5);
  const path = new Path2D();
  const left = settings.showTrackPanel ? layout.panelX : layout.contentX;
  const right = layout.contentX + layout.contentWidth;

  for (const lane of layout.lanes) {
    const y = Math.round(lane.top * viewport.pixelRatio) / viewport.pixelRatio;
    if (y < layout.lanesTop - 1 || y > layout.lanesTop + layout.lanesHeight + 1) continue;
    path.moveTo(left, y);
    path.lineTo(right, y);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, layout.lanesTop, right - left, layout.lanesHeight);
  ctx.clip();
  ctx.lineWidth = hairline;
  ctx.strokeStyle = withAlpha(settings.theme.trackSeparator, settings.separatorOpacity);
  ctx.stroke(path);
  ctx.restore();
}

/**
 * A hairline scroll indicator on the right edge, shown only when the tracks
 * overflow the frame. Without it there is no hint that wheeling does anything.
 * Suppressed on export so it never lands in a finished frame.
 */
export function renderScrollIndicator(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { layout, viewport, settings } = scene;
  if (scene.forExport) return;

  const overflow = layout.contentHeightTotal - layout.lanesHeight;
  if (overflow <= 1) return;

  const trackWidth = 3 * layout.scale;
  const x = layout.contentX + layout.contentWidth - trackWidth - 2 * layout.scale;
  const visibleFraction = layout.lanesHeight / layout.contentHeightTotal;
  const thumbHeight = Math.max(layout.lanesHeight * visibleFraction, 24 * layout.scale);
  const progress = Math.min(Math.max(viewport.scrollY / overflow, 0), 1);
  const y = layout.lanesTop + progress * (layout.lanesHeight - thumbHeight);

  ctx.save();
  ctx.fillStyle = withAlpha(settings.theme.trackSeparator, 0.7);
  ctx.fillRect(x, layout.lanesTop, trackWidth, layout.lanesHeight);
  ctx.fillStyle = withAlpha(settings.theme.trackIndicator, 0.5);
  ctx.fillRect(x, y, trackWidth, thumbHeight);
  ctx.restore();
}

export function clipToLanes(ctx: CanvasRenderingContext2D, layout: LayoutResult, _viewport: Viewport): void {
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.lanesTop, layout.contentWidth, layout.lanesHeight);
  ctx.clip();
}

/** The final downbeat in the bar list, if any. */
function lastDownbeat(bars: BarLine[]): BarLine | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].isDownbeat) return bars[i];
  }
  return null;
}
