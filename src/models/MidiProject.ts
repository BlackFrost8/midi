/**
 * Internal MIDI representation.
 *
 * This model is deliberately independent of both the parsing library and the
 * renderer. Parsing produces it; the layout engine consumes it. Nothing in here
 * knows about pixels.
 */

export type InstrumentFamily =
  | 'piano'
  | 'strings'
  | 'cello'
  | 'violin'
  | 'viola'
  | 'bass'
  | 'choir'
  | 'voice'
  | 'brass'
  | 'woodwinds'
  | 'percussion'
  | 'drums'
  | 'synth'
  | 'pad'
  | 'arpeggio'
  | 'guitar'
  | 'organ'
  | 'unknown';

export interface VisualNote {
  id: string;
  pitch: number;
  velocity: number; // 0..1
  startTicks: number;
  durationTicks: number;
  startBeats: number; // quarter notes from song start
  durationBeats: number;
  startSeconds: number;
  durationSeconds: number;
  channel: number;
}

/**
 * A contiguous run of notes, separated from its neighbours by a rest longer than
 * the region gap threshold. This is what gets drawn as a "MIDI clip".
 */
export interface NoteRegion {
  id: string;
  /** Name at parse time. Display rebuilds from the live track name instead. */
  name: string;
  /**
   * Roman numeral for this clip when the track has more than one, else null.
   * Kept separate from the name so a renamed track relabels its clips.
   */
  ordinal: string | null;
  startBeats: number;
  endBeats: number;
  startSeconds: number;
  endSeconds: number;
  noteStart: number; // index into track.notes
  noteEnd: number; // exclusive
}

export interface VisualTrack {
  id: string;
  index: number;
  name: string;
  /** The track's own name in the MIDI file, if it has one that is not the song title. */
  rawName?: string;
  /** The instrument the file specifies for this track, e.g. "Cello" or "Analog Drums". */
  instrument?: string;
  /**
   * Label derived from the instrument the file specifies, numbered when two
   * tracks share one ("Grand Piano 1", "Grand Piano 2"). Falls back to the
   * track name when the file specifies no instrument at all.
   */
  instrumentLabel: string;
  family: InstrumentFamily;
  programNumber?: number;
  channel?: number;
  isPercussion: boolean;
  notes: VisualNote[];
  regions: NoteRegion[];
  minPitch: number;
  maxPitch: number;
  /** Sorted unique pitches. Drives even-row spacing for percussion lanes. */
  distinctPitches: number[];
  /** Longest note in beats — used to size the viewport-culling lookback window. */
  maxDurationBeats: number;
  maxDurationSeconds: number;
  noteCount: number;
  /** Notes per beat over the track's active span. */
  density: number;
  groupId?: string;
}

export interface TrackGroup {
  id: string;
  name: string;
  trackIds: string[];
  collapsed: boolean;
}

export interface TempoEvent {
  ticks: number;
  beats: number;
  seconds: number;
  bpm: number;
}

export interface TimeSignatureEvent {
  ticks: number;
  beats: number;
  seconds: number;
  numerator: number;
  denominator: number;
  /** Bar number (1-based) at which this time signature begins. */
  barStart: number;
}

export interface MidiMarker {
  ticks: number;
  beats: number;
  seconds: number;
  text: string;
}

export interface BarLine {
  bar: number; // 1-based bar number
  beats: number;
  seconds: number;
  isDownbeat: boolean; // true for bar lines, false for beat lines
  beatInBar: number; // 0 for downbeats
}

export interface MidiProject {
  title: string;
  ppq: number;
  /** Total length in beats (quarter notes). */
  durationBeats: number;
  durationSeconds: number;
  durationTicks: number;
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  markers: MidiMarker[];
  tracks: VisualTrack[];
  groups: TrackGroup[];
  bars: BarLine[];
  totalNotes: number;
  minPitch: number;
  maxPitch: number;
}

/** Per-track UI state, kept out of the parsed project so reloads are cheap. */
export interface TrackState {
  visible: boolean;
  muted: boolean;
  solo: boolean;
  /** Explicit colour override. When null the note colour mode decides. */
  color: string | null;
  /** Explicit icon override. When null the active icon set decides by family. */
  icon: string | null;
  heightScale: number;
  /** User rename; falls back to the parsed name. */
  label: string | null;
  /** Pulse this track's icon with its notes, when gradient icons are on. */
  pulse: boolean;
}

export function defaultTrackState(): TrackState {
  return {
    visible: true,
    muted: false,
    solo: false,
    color: null,
    icon: null,
    heightScale: 1,
    label: null,
    pulse: true,
  };
}
