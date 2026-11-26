import {
  noteDuration,
  noteStart,
  trackMaxDuration,
  unitToX,
  visibleRange,
  type LaneLayout,
} from '../layout/LayoutEngine';
import { laneNoteY } from '../layout/PitchMapper';
import type { VisualNote } from '../models/MidiProject';
import { luminance, withAlpha } from '../utils/colors';
import { lowerBound } from '../utils/math';
import type { RenderCache } from './RenderCache';
import { pathRoundRect, type Scene } from './Scene';

export interface NoteRect {
  x: number;
  y: number;
  width: number;
  height: number;
  note: VisualNote;
  laneIndex: number;
  trackId: string;
  trackName: string;
}

/** Ceiling on glowing notes per frame — shadowBlur is the expensive path. */
const MAX_GLOW_NOTES = 320;

interface ActiveRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** 1 while sounding, decaying to 0 through the afterglow tail. */
  intensity: number;
}

export function renderNotes(ctx: CanvasRenderingContext2D, scene: Scene, cache: RenderCache): void {
  const { project, settings, layout, viewport } = scene;
  if (!layout.lanes.length) return;

  cache.sync(settings, project);

  const { start, end } = visibleRange(layout, viewport);
  const lanesBottom = layout.lanesTop + layout.lanesHeight;
  const radius = settings.noteRadius * layout.scale;
  const minWidth = Math.max(settings.noteMinWidth * layout.scale, 0.75);
  const noteHeight = layout.noteHeight;
  // Zero reduction means "draw every note" — merging only kicks in above 0.
  const mergePx = settings.densityReduction > 0 ? settings.densityReduction * 10 * layout.scale : 0;

  const active: ActiveRect[] = [];
  let selected: NoteRect | null = null;
  let hovered: NoteRect | null = null;

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.lanesTop, layout.contentWidth, layout.lanesHeight);
  ctx.clip();

  for (const lane of layout.lanes) {
    if (lane.height < 1 || lane.top + lane.height < layout.lanesTop || lane.top > lanesBottom) continue;
    if (lane.track.noteCount === 0) continue;

    const table = cache.table(lane.track, lane.state, settings, project);
    // One rect list per colour bucket, so each colour is a single fill call.
    const buckets: number[][] = table.colors.map(() => []);
    // Tracks the last emitted rect per pitch, for density merging.
    const lastByPitch = mergePx > 0 ? new Map<number, { bucket: number; index: number }>() : null;

    const notes = lane.track.notes;
    const lookback = trackMaxDuration(lane.track, layout.domain);
    let i = lowerBound(notes, start - lookback, (note) => noteStart(note, layout.domain));

    for (; i < notes.length; i++) {
      const note = notes[i];
      const s = noteStart(note, layout.domain);
      if (s > end) break;
      const d = noteDuration(note, layout.domain);
      if (s + d < start) continue;

      const x = unitToX(s, layout, viewport);
      const w = Math.max(d * viewport.pxPerUnit, minWidth);
      const y = laneNoteY(note.pitch, lane, noteHeight);

      // Clip vertically to the lane so scrolled-in lanes never bleed.
      if (y + noteHeight < layout.lanesTop || y > lanesBottom) continue;

      const bucket = table.bucket(note);
      const rects = buckets[bucket];

      let merged = false;
      if (lastByPitch) {
        const previous = lastByPitch.get(note.pitch);
        if (previous && previous.bucket === bucket) {
          const list = buckets[previous.bucket];
          const px = list[previous.index];
          const pw = list[previous.index + 2];
          if (x - (px + pw) <= mergePx) {
            list[previous.index + 2] = Math.max(pw, x + w - px);
            merged = true;
          }
        }
      }

      if (!merged) {
        const index = rects.length;
        rects.push(x, y, w, noteHeight);
        lastByPitch?.set(note.pitch, { bucket, index });
      }

      if (settings.highlightActiveNotes && settings.showPlayhead && active.length < MAX_GLOW_NOTES) {
        const intensity = noteIntensity(note, scene);
        if (intensity > 0.01) {
          active.push({ x, y, w, h: noteHeight, color: table.colors[bucket], intensity });
        }
      }

      if (!scene.forExport) {
        if (scene.selectedNoteId === note.id) {
          selected = makeRect(x, y, w, noteHeight, note, lane);
        } else if (scene.hoveredNoteId === note.id) {
          hovered = makeRect(x, y, w, noteHeight, note, lane);
        }
      }
    }

    ctx.globalAlpha = settings.noteOpacity * (lane.state.muted ? 0.28 : lane.dimmed ? 0.35 : 1) * lane.opacity;
    for (let b = 0; b < buckets.length; b++) {
      const rects = buckets[b];
      if (!rects.length) continue;
      ctx.fillStyle = table.colors[b];
      ctx.beginPath();
      for (let r = 0; r < rects.length; r += 4) {
        pathRoundRect(ctx, rects[r], rects[r + 1], rects[r + 2], rects[r + 3], radius);
      }
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  renderActiveNotes(ctx, scene, active, radius);
  ctx.restore();

  if (selected) drawOutline(ctx, scene, selected, settings.theme.noteSelected, 1.6);
  if (hovered) drawOutline(ctx, scene, hovered, settings.theme.noteSelected, 1);
}

/**
 * 1 while the playhead is inside the note, then a linear decay across the
 * afterglow tail. Timing is always evaluated in seconds so the trail length is
 * consistent regardless of which domain the axis uses.
 */
function noteIntensity(note: VisualNote, scene: Scene): number {
  const t = scene.playheadSeconds;
  const noteEnd = note.startSeconds + note.durationSeconds;
  if (t >= note.startSeconds && t <= noteEnd) return 1;

  const tail = scene.settings.noteAfterglow;
  if (tail > 0 && t > noteEnd && t - noteEnd < tail) {
    return 1 - (t - noteEnd) / tail;
  }
  return 0;
}

function renderActiveNotes(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  active: ActiveRect[],
  radius: number,
): void {
  if (!active.length) return;
  const { settings, layout } = scene;
  const glow = settings.noteGlow;
  // Additive blending only reads as "lit" against a dark background; on a light
  // theme it would wash notes out to white, so paint normally there.
  const additive = luminance(settings.theme.background) < 0.5;

  ctx.save();
  ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
  if (glow > 0.001) {
    ctx.shadowColor = settings.theme.noteGlow;
    ctx.shadowBlur = glow * 16 * layout.scale;
  }

  for (const rect of active) {
    ctx.globalAlpha = additive ? 0.35 + 0.5 * rect.intensity : 0.45 + 0.55 * rect.intensity;
    ctx.fillStyle = rect.intensity > 0.98 ? settings.theme.noteActive : rect.color;
    ctx.beginPath();
    pathRoundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.fill();
  }

  ctx.restore();
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  rect: NoteRect,
  color: string,
  weight: number,
): void {
  const { layout } = scene;
  const pad = 2 * layout.scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.contentX, layout.lanesTop, layout.contentWidth, layout.lanesHeight);
  ctx.clip();
  ctx.strokeStyle = withAlpha(color, 0.95);
  ctx.lineWidth = weight * layout.scale;
  ctx.beginPath();
  pathRoundRect(
    ctx,
    rect.x - pad,
    rect.y - pad,
    rect.width + pad * 2,
    rect.height + pad * 2,
    (scene.settings.noteRadius + 2) * layout.scale,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * Hit-testing for hover and click. Walks only the notes near the cursor by
 * reusing the same binary-search cull as rendering.
 */
export function noteAtPoint(scene: Scene, px: number, py: number): NoteRect | null {
  const { layout, viewport, settings } = scene;
  if (px < layout.contentX || px > layout.contentX + layout.contentWidth) return null;
  if (py < layout.lanesTop || py > layout.lanesTop + layout.lanesHeight) return null;

  const lane = laneAtY(scene, py);
  if (!lane || lane.track.noteCount === 0) return null;

  const noteHeight = layout.noteHeight;
  const minWidth = Math.max(settings.noteMinWidth * layout.scale, 0.75);
  const unit = viewport.scrollUnits + (px - layout.contentX) / viewport.pxPerUnit;
  const lookback = trackMaxDuration(lane.track, layout.domain);
  const notes = lane.track.notes;
  // A few pixels of slack makes thin notes clickable.
  const slack = 3 * layout.scale;

  let best: NoteRect | null = null;
  let i = lowerBound(notes, unit - lookback, (note) => noteStart(note, layout.domain));
  for (; i < notes.length; i++) {
    const note = notes[i];
    const s = noteStart(note, layout.domain);
    if (s > unit + slack / viewport.pxPerUnit) break;
    const d = noteDuration(note, layout.domain);
    const x = unitToX(s, layout, viewport);
    const w = Math.max(d * viewport.pxPerUnit, minWidth);
    if (px < x - slack || px > x + w + slack) continue;
    const y = laneNoteY(note.pitch, lane, noteHeight);
    if (py < y - slack || py > y + noteHeight + slack) continue;
    best = makeRect(x, y, w, noteHeight, note, lane);
  }
  return best;
}

function makeRect(
  x: number,
  y: number,
  width: number,
  height: number,
  note: VisualNote,
  lane: LaneLayout,
): NoteRect {
  return {
    x,
    y,
    width,
    height,
    note,
    laneIndex: lane.index,
    trackId: lane.track.id,
    trackName: lane.state.label ?? lane.track.name,
  };
}

export function laneAtY(scene: Scene, py: number): LaneLayout | null {
  for (const lane of scene.layout.lanes) {
    if (py >= lane.top && py < lane.top + lane.height) return lane;
  }
  return null;
}
