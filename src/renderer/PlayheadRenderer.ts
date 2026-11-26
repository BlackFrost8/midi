import { unitToX } from '../layout/LayoutEngine';
import type { MidiProject } from '../models/MidiProject';
import { musicEnd } from './CardRenderer';
import { withAlpha } from '../utils/colors';
import type { Scene } from './Scene';

/**
 * "A faint cyan light passing through darkness": a wide, very low-alpha wash
 * behind a 1px core line. The wash is a horizontal gradient rather than a
 * shadowBlur so it stays cheap at 60fps and identical at export resolution.
 */
export function renderPlayhead(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { settings, layout, viewport } = scene;
  if (!settings.showPlayhead) return;

  const x = unitToX(scene.playheadUnit, layout, viewport);
  if (x < layout.contentX - 2 || x > layout.contentX + layout.contentWidth + 2) return;
  const fade = settings.playheadFadeOut === false ? 1 : endFade(scene.project, scene.playheadSeconds);
  if (fade <= 0.002) return;
  // As it fades the light also narrows, like a beam being turned down.
  const glow = settings.playheadGlow * (0.35 + 0.65 * fade);

  const theme = settings.theme;
  const scale = layout.scale;
  const top = layout.rulerTop;
  // Stops at the bottom of the last lane rather than the bottom of the region,
  // so a centred block of lanes does not get a line hanging off it.
  const bottom = Math.max(layout.gridBottom, layout.rulerTop + layout.rulerHeight);

  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.beginPath();
  ctx.rect(layout.contentX, top, layout.contentWidth, bottom - top);
  ctx.clip();

  if (glow > 0.001) {
    // The light trails behind the line, the way a moving beam smears, rather
    // than spreading evenly both ways. A sliver leads ahead so the edge is soft.
    const trail = 52 * scale * glow;
    const lead = 4 * scale;
    const gradient = ctx.createLinearGradient(x - trail, 0, x + lead, 0);
    const peak = trail / (trail + lead);
    gradient.addColorStop(0, withAlpha(theme.playheadGlow, 0));
    gradient.addColorStop(peak * 0.6, withAlpha(theme.playheadGlow, 0.07 * glow));
    gradient.addColorStop(peak, withAlpha(theme.playheadGlow, 0.26 * glow));
    gradient.addColorStop(1, withAlpha(theme.playheadGlow, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - trail, top, trail + lead, bottom - top);
  }

  const width = Math.max(settings.playheadWidth * scale, 1 / viewport.pixelRatio);
  const snapped = Math.round((x - width / 2) * viewport.pixelRatio) / viewport.pixelRatio;
  ctx.fillStyle = theme.playhead;
  ctx.fillRect(snapped, top, width, bottom - top);

  ctx.restore();

  // Small marker in the ruler so the position stays findable when scrolled.
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.rulerTop, layout.contentWidth, layout.rulerHeight);
  ctx.clip();
  ctx.fillStyle = theme.playhead;
  ctx.beginPath();
  const size = 4 * scale;
  ctx.moveTo(x - size, layout.rulerTop);
  ctx.lineTo(x + size, layout.rulerTop);
  ctx.lineTo(x, layout.rulerTop + size * 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * The playhead's opacity near the end: it starts dimming a few seconds before
 * the last note finishes and is gone as it ends (where playback stops), a slow
 * ease out rather than a cut, so the final chord rings out in the dark.
 */
function endFade(project: MidiProject, seconds: number): number {
  const end = musicEnd(project);
  const length = Math.min(4, Math.max(1.5, end * 0.08));
  const t = (seconds - (end - length)) / length;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  // Ease in-out cosine: barely moves at first, then sinks away.
  return 0.5 + 0.5 * Math.cos(Math.PI * t);
}
