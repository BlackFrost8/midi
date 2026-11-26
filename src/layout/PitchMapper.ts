import type { MidiProject, VisualTrack } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import type { PitchRows } from './LayoutEngine';

export interface PitchRange {
  min: number;
  max: number;
}

/**
 * Decides the vertical pitch window for one lane.
 *
 * Mode A (relative, the default) gives every track its own window so a cello
 * part fills its lane instead of being squashed into the bottom eighth of a
 * piano-sized scale. Mode B (global) shares one window across all tracks, which
 * is what you want when comparing registers between instruments.
 */
export function calculatePitchRange(
  track: VisualTrack,
  settings: RenderSettings,
  project: MidiProject,
): PitchRange {
  if (settings.pitchMode === 'global') {
    return padRange(project.minPitch, project.maxPitch, settings.pitchPadding);
  }
  if (track.noteCount === 0) {
    return { min: 48, max: 72 };
  }
  return padRange(track.minPitch, track.maxPitch, settings.pitchPadding);
}

/**
 * Adds headroom, then enforces a minimum span. Without the minimum, a track
 * holding a single repeated pitch would divide by zero, and a two-note track
 * would exaggerate a semitone into the full lane height.
 */
function padRange(min: number, max: number, padding: number): PitchRange {
  const MIN_SPAN = 12; // one octave keeps small ranges from looking dramatic
  let lo = min - padding;
  let hi = max + padding;
  const span = hi - lo;
  if (span < MIN_SPAN) {
    const centre = (hi + lo) / 2;
    lo = centre - MIN_SPAN / 2;
    hi = centre + MIN_SPAN / 2;
  }
  return { min: lo, max: hi };
}

/**
 * Vertical position of a pitch within a lane, in pixels from the canvas top.
 * MIDI pitch increases upward, so the axis is inverted. `noteHeight` is
 * subtracted from the usable span so the top and bottom notes sit fully inside
 * the lane rather than half outside it.
 */
export function pitchToY(
  pitch: number,
  range: PitchRange,
  contentTop: number,
  contentHeight: number,
  noteHeight: number,
): number {
  const span = range.max - range.min;
  const normalized = span > 0 ? (pitch - range.min) / span : 0.5;
  const usable = Math.max(contentHeight - noteHeight, 1);
  return contentTop + (1 - normalized) * usable;
}

/**
 * Same, but for lanes using even-row spacing. Rows are inset by half a row so
 * the topmost and bottommost rows are not flush against the lane edges.
 */
export function rowToY(
  pitch: number,
  rows: PitchRows,
  contentTop: number,
  contentHeight: number,
  noteHeight: number,
): number {
  const row = rows.index.get(pitch) ?? 0;
  const usable = Math.max(contentHeight - noteHeight, 1);
  const normalized = rows.count > 1 ? row / (rows.count - 1) : 0.5;
  return contentTop + (1 - normalized) * usable;
}

/** Picks the right vertical mapping for a lane. */
export function laneNoteY(
  pitch: number,
  lane: { pitchRange: PitchRange; pitchRows: PitchRows | null; contentTop: number; contentHeight: number },
  noteHeight: number,
): number {
  return lane.pitchRows
    ? rowToY(pitch, lane.pitchRows, lane.contentTop, lane.contentHeight, noteHeight)
    : pitchToY(pitch, lane.pitchRange, lane.contentTop, lane.contentHeight, noteHeight);
}
