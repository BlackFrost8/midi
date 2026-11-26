import type { LaneLayout } from '../layout/LayoutEngine';
import { familyLabel } from '../midi/InstrumentClassifier';
import { mix, withAlpha } from '../utils/colors';
import { lowerBound } from '../utils/math';
import { drawIcon, resolveIcon, type IconName } from './iconLibrary';
import { drawGradientIcon, iconGradientColors, notePulse } from './IconPaint';
import { fitText, font, resetLetterSpacing, setLetterSpacing, type Scene } from './Scene';

/**
 * The fixed left column. Drawn on canvas rather than as DOM so exports carry the
 * track names without a second layout pass.
 */
export function renderTrackPanel(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout, viewport } = scene;
  if (!settings.showTrackPanel || layout.panelWidth <= 0) return;

  const theme = settings.theme;
  const panelTop = layout.rulerTop;
  // Ends with the last lane so the panel does not trail past a centred block.
  const panelHeight = Math.max(layout.gridBottom - panelTop, layout.rulerHeight);

  ctx.save();
  ctx.fillStyle = theme.panel;
  ctx.fillRect(layout.panelX, panelTop, layout.panelWidth, panelHeight);

  // Vertical rule separating panel from arrangement.
  const borderX = Math.round(layout.contentX * viewport.pixelRatio) / viewport.pixelRatio;
  ctx.strokeStyle = withAlpha(theme.panelBorder, 0.9);
  ctx.lineWidth = Math.max(1 / viewport.pixelRatio, 0.5);
  ctx.beginPath();
  ctx.moveTo(borderX, panelTop);
  ctx.lineTo(borderX, panelTop + panelHeight);
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(layout.panelX, layout.lanesTop, layout.panelWidth, layout.lanesHeight);
  ctx.clip();

  const lanesBottom = layout.lanesTop + layout.lanesHeight;

  for (const lane of layout.lanes) {
    if (lane.height < 1 || lane.top + lane.height < layout.lanesTop || lane.top > lanesBottom) continue;

    const alpha = (lane.state.muted ? 0.32 : lane.dimmed ? 0.45 : 1) * lane.opacity;
    const icon = resolveIcon(lane.track, lane.state.icon as IconName | null, settings.iconSetId);
    const name = (lane.state.label ?? lane.track.name).trim() || lane.track.name;

    ctx.globalAlpha = alpha;

    if (settings.panelStyle === 'cinematic') {
      drawCinematicLane(ctx, scene, lane, name, icon);
    } else {
      drawListLane(ctx, scene, lane, name, icon);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function subLabel(
  family: Parameters<typeof familyLabel>[0],
  channel: number | undefined,
  instrument: string | undefined,
): string {
  const parts: string[] = [];
  const label = familyLabel(family);
  if (label !== 'Unknown') parts.push(label);
  else if (instrument) parts.push(instrument);
  if (channel != null && Number.isFinite(channel)) parts.push(`Ch ${channel + 1}`);
  return parts.join('  ·  ');
}

/**
 * Compact row: dot, icon and name on one line, vertically centred. Suits a
 * frame holding many tracks at once.
 */
function drawListLane(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  lane: LaneLayout,
  name: string,
  icon: IconName,
): void {
  const { settings, layout } = scene;
  const theme = settings.theme;
  const scale = layout.scale;

  const centreY = lane.top + lane.height / 2;
  const compact = lane.height < 34 * scale;
  const dotRadius = Math.min(2.6 * scale, 4);
  const dotX = layout.panelX + 5 * scale;
  const iconSize = Math.min(11 * scale, lane.height * 0.34);
  const showIcon = settings.showInstrumentIcons && iconSize >= 6 && layout.panelWidth > 88 * scale;
  const iconX = dotX + dotRadius * 2 + 5 * scale;
  const textX = showIcon ? iconX + iconSize + 8 * scale : iconX;
  const textWidth = layout.panelX + layout.panelWidth - textX - 8 * scale;
  if (textWidth <= 6) return;

  ctx.fillStyle = lane.state.muted ? withAlpha(theme.trackSubtext, 0.6) : lane.color;
  ctx.beginPath();
  ctx.arc(dotX, centreY, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  if (showIcon) {
    paintIcon(ctx, scene, lane, icon, iconX, centreY - iconSize / 2, iconSize, {
      color: theme.trackIcon,
      alpha: 0.85,
      lineWidth: Math.max(1 * scale, 0.75),
    });
  }

  const sub = subLabel(lane.track.family, lane.track.channel, lane.track.instrument);
  const showSub = settings.showTrackSublabels && !compact && sub.length > 0;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.trackText;
  ctx.font = font(Math.min(11 * scale, lane.height * 0.3), 500);
  setLetterSpacing(ctx, 1.15 * scale);
  ctx.fillText(fitText(ctx, name.toUpperCase(), textWidth), textX, showSub ? centreY - 6.5 * scale : centreY);
  resetLetterSpacing(ctx);

  if (showSub) {
    ctx.fillStyle = theme.trackSubtext;
    ctx.font = font(Math.min(8.5 * scale, lane.height * 0.24), 400);
    setLetterSpacing(ctx, 0.5 * scale);
    ctx.fillText(fitText(ctx, sub, textWidth), textX, centreY + 6.5 * scale);
    resetLetterSpacing(ctx);
  }
}

/**
 * Cinematic lane: the name sits at the top where the eye lands, and a large
 * instrument glyph is watermarked behind it at low opacity. With only a few
 * tall lanes on screen there is room for the glyph to read as artwork rather
 * than as a control.
 */
function drawCinematicLane(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  lane: LaneLayout,
  name: string,
  icon: IconName,
): void {
  const { settings, layout } = scene;
  const theme = settings.theme;
  const scale = layout.scale;

  const left = layout.panelX + 10 * scale;
  const textWidth = layout.panelWidth - 18 * scale;
  if (textWidth <= 10) return;

  // Watermark glyph, centred in the panel column of this lane.
  if (settings.showInstrumentIcons) {
    const size = Math.min(lane.height * 0.3, layout.panelWidth * 0.42);
    // Thin lanes have no room for it between the name and the lane edge.
    if (size >= 12 * scale && lane.height >= 70 * scale) {
      paintIcon(
        ctx,
        scene,
        lane,
        icon,
        layout.panelX + (layout.panelWidth - size) / 2,
        lane.top + (lane.height - size) / 2,
        size,
        // Flat icons stay a faint watermark behind the name.
        { color: theme.trackIcon, alpha: 0.16, lineWidth: Math.max(size * 0.045, 1) },
      );
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.trackText;
  // Proportional in tall lanes; thin lanes keep a legible floor instead of
  // shrinking with them.
  ctx.font = font(
    Math.min(21 * scale, Math.max(lane.height * 0.14, Math.min(13 * scale, lane.height * 0.45))),
    400,
  );
  setLetterSpacing(ctx, 0.4 * scale);
  ctx.fillText(fitText(ctx, name, textWidth), left, lane.top + 6 * scale);
  resetLetterSpacing(ctx);

  // Activity strip down the panel's right edge: dim at rest, lighting up while
  // the track is sounding, so the eye can tell which part is playing.
  const stripWidth = 9 * scale;
  const stripGap = 8 * scale;
  const stripX = layout.panelX + layout.panelWidth - stripGap - stripWidth;
  const showStrip = settings.highlightActiveNotes && layout.panelWidth > 90 * scale;
  if (showStrip) {
    const level = lane.state.muted ? 0 : laneActivity(lane, scene);
    const rest = mix(theme.panel, theme.trackIcon, 0.22);
    ctx.fillStyle = level > 0 ? mix(rest, theme.trackText, level) : rest;
    ctx.fillRect(stripX, lane.top + 1 * scale, stripWidth, lane.height - 2 * scale);
  }

  // Small colour dot low in the lane, echoing the reference without clutter.
  const dotRadius = Math.min(3 * scale, 4.5);
  ctx.fillStyle = lane.state.muted ? withAlpha(theme.trackSubtext, 0.6) : lane.color;
  ctx.beginPath();
  ctx.arc(
    showStrip ? stripX - 14 * scale : layout.panelX + layout.panelWidth - 12 * scale,
    lane.top + lane.height - 14 * scale,
    dotRadius,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/**
 * How strongly a track is sounding at the playhead, 0–1. A struck note flares
 * and settles to a sustain level that follows its velocity, then fades over a
 * short tail after release — close enough to a level meter to read as one.
 * Stateless, so an exported frame matches the live one exactly.
 */
function laneActivity(lane: LaneLayout, scene: Scene): number {
  const t = scene.playheadSeconds;
  const notes = lane.track.notes;
  if (!notes.length) return 0;
  const tail = Math.max(scene.settings.noteAfterglow, 0.12);
  const from = lowerBound(notes, t - lane.track.maxDurationSeconds - tail, (n) => n.startSeconds);

  let level = 0;
  for (let i = from; i < notes.length; i++) {
    const note = notes[i];
    if (note.startSeconds > t) break;
    const end = note.startSeconds + note.durationSeconds;
    let presence = 0;
    if (t <= end) presence = 1;
    else if (t - end < tail) presence = 1 - (t - end) / tail;
    if (presence <= 0) continue;
    const attack = Math.exp(-(t - note.startSeconds) / 0.18);
    const value = presence * (0.45 + 0.3 * note.velocity + 0.25 * attack);
    if (value > level) level = value;
  }
  return Math.min(level, 1);
}

/**
 * Draws one track icon. With gradient icons on it is painted in the gradient
 * at the chosen strength and, if the track's pulse is on, glows and swells
 * softly with each of its notes and chords. Otherwise it is the flat theme
 * colour at the given opacity.
 */
function paintIcon(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  lane: LaneLayout,
  icon: IconName,
  x: number,
  y: number,
  size: number,
  flat: { color: string; alpha: number; lineWidth: number },
): void {
  const { settings, layout, viewport } = scene;
  if (!settings.iconGradient) {
    ctx.save();
    ctx.globalAlpha *= flat.alpha;
    ctx.strokeStyle = flat.color;
    ctx.lineWidth = flat.lineWidth;
    drawIcon(ctx, icon, x, y, size);
    ctx.restore();
    return;
  }

  const pulsing = lane.state.pulse && !lane.state.muted;
  const pulse = pulsing ? notePulse(lane.track, scene.playheadSeconds) * settings.iconPulseStrength : 0;
  drawGradientIcon(ctx, icon, x, y, size, {
    colors: iconGradientColors(settings),
    style: settings.iconGradientStyle,
    opacity: settings.iconGradientOpacity,
    pulse,
    lineWidth: flat.lineWidth,
    blurScale: layout.scale * viewport.pixelRatio,
  });
}
