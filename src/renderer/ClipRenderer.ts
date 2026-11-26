import { unitToX, visibleRange, type LaneLayout } from '../layout/LayoutEngine';
import type { NoteRegion } from '../models/MidiProject';
import { readableTextOn, withAlpha } from '../utils/colors';
import { notePulse } from './IconPaint';
import { fitText, font, pathRoundRect, resetLetterSpacing, setLetterSpacing, type Scene } from './Scene';

/**
 * MIDI regions: a header bar carrying the clip name plus a very dark body that
 * gives the notes something to sit inside. Regions come from the parser's gap
 * analysis, so they follow the actual arrangement rather than a fixed grid.
 */
export function renderClipBodies(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout, viewport } = scene;
  if (!settings.showClips || !layout.lanes.length) return;

  const theme = settings.theme;
  const scale = layout.scale;
  const { start, end } = visibleRange(layout, viewport);
  const lanesBottom = layout.lanesTop + layout.lanesHeight;
  const radius = 2 * scale;
  const playUnit = scene.playheadUnit;

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.lanesTop, layout.contentWidth, layout.lanesHeight);
  ctx.clip();

  for (const lane of layout.lanes) {
    if (lane.height < 1 || lane.top + lane.height < layout.lanesTop || lane.top > lanesBottom) continue;

    const alpha = (lane.state.muted ? 0.3 : lane.dimmed ? 0.4 : 1) * lane.opacity;
    const headerHeight = lane.headerHeight;
    const bodyTop = lane.top + headerHeight;
    const bodyHeight = Math.max(lane.height - headerHeight - 1 * scale, 1);
    const clipGlow = settings.glowSyncClips ? glowSync(scene, lane) : 0;

    for (const region of lane.track.regions) {
      const regionStart = layout.domain === 'beats' ? region.startBeats : region.startSeconds;
      const regionEnd = layout.domain === 'beats' ? region.endBeats : region.endSeconds;
      if (regionEnd < start || regionStart > end) continue;

      const x = unitToX(regionStart, layout, viewport);
      const width = Math.max((regionEnd - regionStart) * viewport.pxPerUnit, 2 * scale);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = withAlpha(theme.clipBody, 0.85);
      ctx.beginPath();
      pathRoundRect(ctx, x, bodyTop, width, bodyHeight, radius);
      ctx.fill();

      ctx.strokeStyle = withAlpha(theme.clipBorder, 0.9);
      ctx.lineWidth = Math.max(1 / viewport.pixelRatio, 0.5);
      ctx.stroke();

      // Glow sync: the clip that is playing lights up with its notes.
      if (clipGlow > 0.01 && playUnit >= regionStart && playUnit <= regionEnd) {
        ctx.save();
        ctx.fillStyle = withAlpha(lane.color, 0.26 * clipGlow);
        ctx.shadowColor = withAlpha(lane.color, 0.8 * clipGlow);
        ctx.shadowBlur = 18 * scale * clipGlow;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = withAlpha(lane.color, 0.85 * clipGlow);
        ctx.lineWidth = Math.max(1, 1.5 * scale);
        ctx.stroke();
        ctx.restore();
      }

    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Clip headers, drawn after the grid so a bar line never cuts across a label.
 * Bodies go down first (see renderClipBodies) and the grid sits between them,
 * which is how the bar divisions stay visible inside a clip.
 */
export function renderClipHeaders(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout, viewport } = scene;
  if (!settings.showClips || !layout.lanes.length) return;

  const theme = settings.theme;
  const scale = layout.scale;
  const { start, end } = visibleRange(layout, viewport);
  const lanesBottom = layout.lanesTop + layout.lanesHeight;
  const radius = 2 * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.lanesTop, layout.contentWidth, layout.lanesHeight);
  ctx.clip();

  for (const lane of layout.lanes) {
    if (lane.height < 1 || lane.top + lane.height < layout.lanesTop || lane.top > lanesBottom) continue;
    const headerHeight = lane.headerHeight;
    if (headerHeight <= 1) continue;

    const headerColor = clipHeaderColor(scene, lane);
    const textColor =
      headerColor === theme.clipHeader ? theme.clipHeaderText : readableTextOn(headerColor);
    ctx.globalAlpha = (lane.state.muted ? 0.3 : lane.dimmed ? 0.4 : 1) * lane.opacity;

    for (const region of lane.track.regions) {
      const regionStart = layout.domain === 'beats' ? region.startBeats : region.startSeconds;
      const regionEnd = layout.domain === 'beats' ? region.endBeats : region.endSeconds;
      if (regionEnd < start || regionStart > end) continue;

      const x = unitToX(regionStart, layout, viewport);
      const width = Math.max((regionEnd - regionStart) * viewport.pxPerUnit, 2 * scale);

      ctx.fillStyle = headerColor;
      ctx.beginPath();
      pathRoundRect(ctx, x, lane.top, width, headerHeight, radius);
      ctx.fill();

      // Below this the label would be too small to read and just reads as noise.
      if (settings.showClipNames && headerHeight >= 13 * scale && width > 26 * scale) {
        // Pin the label to the visible edge when the clip starts off-screen,
        // so a scrolled or zoomed view still says which clip you are in.
        const labelX = Math.max(x, layout.contentX) + 6 * scale;
        const labelRight = Math.min(x + width, layout.contentX + layout.contentWidth);
        const available = labelRight - labelX - 5 * scale;

        if (available > 14 * scale) {
          ctx.fillStyle = textColor;
          ctx.font = font(Math.min(settings.clipHeaderHeight * 0.62 * scale, headerHeight * 0.62), 600);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          setLetterSpacing(ctx, 0.5 * scale);
          ctx.fillText(fitText(ctx, clipLabel(lane, region), available), labelX, lane.top + headerHeight * 0.55);
          resetLetterSpacing(ctx);
        }
      }
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * The text on a clip header.
 *
 * Built from the track's current name rather than the one captured at parse
 * time, so renaming a track relabels its clips too. The roman numeral is
 * reapplied for tracks whose notes split into more than one clip.
 */
export function clipLabel(lane: LaneLayout, region: NoteRegion): string {
  const base = (lane.state.label ?? lane.track.name).trim() || lane.track.name;
  return region.ordinal ? `${base} ${region.ordinal}` : base;
}

/**
 * Clip headers follow the track colour whenever colour is carrying meaning
 * (instrument/track modes, or an explicit override) and fall back to the
 * theme's pale-cyan header otherwise.
 */
export function clipHeaderColor(scene: Scene, lane: LaneLayout): string {
  const mode = scene.settings.noteColorMode;
  if (lane.state.color) return lane.state.color;
  if (mode === 'instrument' || mode === 'track') return lane.color;
  return scene.settings.theme.clipHeader;
}

/** A lane's glow-sync level now, 0–1, scaled by the Glow sync amount. */
function glowSync(scene: Scene, lane: LaneLayout): number {
  if (!lane.state.pulse || lane.state.muted) return 0;
  return notePulse(lane.track, scene.playheadSeconds) * scene.settings.iconPulseStrength * lane.opacity;
}

/**
 * Glow sync on lanes: a soft band of the track's colour behind its notes that
 * swells with them, brightest along the lane's middle.
 */
export function renderLaneGlow(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout } = scene;
  if (!settings.glowSyncLanes || !layout.lanes.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.lanesTop, layout.contentWidth, layout.lanesHeight);
  ctx.clip();
  for (const lane of layout.lanes) {
    if (lane.height < 1) continue;
    const p = glowSync(scene, lane);
    if (p < 0.01) continue;
    const band = ctx.createLinearGradient(0, lane.top, 0, lane.top + lane.height);
    band.addColorStop(0, withAlpha(lane.color, 0));
    band.addColorStop(0.5, withAlpha(lane.color, 0.16 * p));
    band.addColorStop(1, withAlpha(lane.color, 0));
    ctx.fillStyle = band;
    ctx.fillRect(layout.contentX, lane.top, layout.contentWidth, lane.height);
  }
  ctx.restore();
}
