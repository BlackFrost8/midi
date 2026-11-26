import type { MidiProject, TrackState, VisualNote, VisualTrack } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import { mix } from '../utils/colors';
import { clamp } from '../utils/math';

/**
 * Resolves the colour of every drawable element.
 *
 * Colouring 100k notes one string-concatenation at a time would dominate the
 * frame budget, so gradient-style modes (velocity, pitch) are precomputed into a
 * small lookup table per lane and notes are bucketed into it. Solid modes
 * collapse to a single entry.
 */

const LUT_STEPS = 24;

/**
 * A track's own colour. An explicit user override always wins; otherwise the
 * instrument palette supplies it. Used for the panel indicator dot and clip
 * headers as well as notes, so a recoloured track reads consistently.
 */
export function resolveTrackColor(
  track: VisualTrack,
  state: TrackState,
  settings: RenderSettings,
): string {
  if (state.color) return state.color;
  return settings.instrumentColors[track.family] ?? settings.theme.note;
}

export interface NoteColorTable {
  /** Colour strings indexed by bucket. */
  colors: string[];
  /** Maps a note to its bucket index. */
  bucket: (note: VisualNote) => number;
}

export function buildNoteColorTable(
  track: VisualTrack,
  state: TrackState,
  settings: RenderSettings,
  project: MidiProject,
): NoteColorTable {
  const { theme } = settings;
  const solid = (color: string): NoteColorTable => {
    // Velocity brightness still applies to solid modes, so build a ramp from a
    // dimmed version of the base colour up to the base colour itself.
    if (settings.velocityBrightness <= 0.001) {
      return { colors: [color], bucket: () => 0 };
    }
    const floor = mix(theme.background, color, 1 - settings.velocityBrightness * 0.75);
    const colors = rampColors(floor, color);
    return { colors, bucket: (note) => bucketFor(note.velocity) };
  };

  // An explicit per-track override is a deliberate user choice — it wins over
  // every colour mode.
  if (state.color) return solid(state.color);

  switch (settings.noteColorMode) {
    case 'instrument':
    case 'track':
      return solid(resolveTrackColor(track, state, settings));

    case 'velocity': {
      const colors = rampColors(mix(theme.background, theme.note, 0.55), theme.noteActive);
      return { colors, bucket: (note) => bucketFor(note.velocity) };
    }

    case 'pitch': {
      const min = settings.pitchMode === 'global' ? project.minPitch : track.minPitch;
      const max = settings.pitchMode === 'global' ? project.maxPitch : track.maxPitch;
      const span = Math.max(max - min, 1);
      const colors = rampColors(theme.note, theme.noteGlow);
      return { colors, bucket: (note) => bucketFor((note.pitch - min) / span) };
    }

    case 'uniform':
    default:
      return solid(theme.note);
  }
}

function bucketFor(value: number): number {
  return clamp(Math.round(value * (LUT_STEPS - 1)), 0, LUT_STEPS - 1);
}

function rampColors(from: string, to: string): string[] {
  const colors: string[] = new Array(LUT_STEPS);
  for (let i = 0; i < LUT_STEPS; i++) {
    colors[i] = mix(from, to, i / (LUT_STEPS - 1));
  }
  return colors;
}

/** Colour used for a note the playhead is currently inside. */
export function activeNoteColor(settings: RenderSettings, base: string): string {
  return mix(base, settings.theme.noteActive, 0.7);
}
