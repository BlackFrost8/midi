import type { InstrumentFamily } from './MidiProject';

/**
 * Every colour the renderer can draw with, as a flat record of named slots.
 * Flat (rather than nested) so the settings UI can enumerate and override any
 * single element without special-casing.
 */
export interface ColorTheme {
  /** Page/canvas base colour. */
  background: string;
  /** Centre tint of the very subtle radial background gradient. */
  backgroundGlow: string;
  /** Left track-panel fill. */
  panel: string;
  /** Vertical rule between the panel and the arrangement. */
  panelBorder: string;
  /** Track name text. */
  trackText: string;
  /** Instrument/channel sub-label text. */
  trackSubtext: string;
  /** Instrument icon stroke. */
  trackIcon: string;
  /** Visibility indicator dot. */
  trackIndicator: string;

  /** Bar lines. */
  gridBar: string;
  /** Beat lines within a bar. */
  gridBeat: string;
  /** Horizontal rule between lanes. */
  trackSeparator: string;

  /** MIDI clip header bar. */
  clipHeader: string;
  /** Clip name text drawn on the header. */
  clipHeaderText: string;
  /** Clip interior fill (usually near-transparent). */
  clipBody: string;
  /** Clip outline. */
  clipBorder: string;

  /** Default note fill. */
  note: string;
  /** Note fill while the playhead is inside it. */
  noteActive: string;
  /** Bloom colour around active notes. */
  noteGlow: string;
  /** Outline of a clicked note. */
  noteSelected: string;

  /** Playhead core line. */
  playhead: string;
  /** Playhead bloom. */
  playheadGlow: string;

  /** Ruler background strip. */
  rulerBackground: string;
  /** Bar numbers / timecode text. */
  rulerText: string;
  /** Ruler baseline and ticks. */
  rulerLine: string;

  /** Marker/section label text. */
  sectionText: string;
  /** Marker vertical line. */
  sectionLine: string;

  /** Optional title text burned into the export. */
  titleText: string;
}

export type ColorSlot = keyof ColorTheme;

export interface ColorSlotMeta {
  slot: ColorSlot;
  label: string;
  group: 'Canvas' | 'Track panel' | 'Grid' | 'Clips' | 'Notes' | 'Playhead' | 'Timeline';
  hint?: string;
}

/** Drives the colour editor UI — order here is the order shown. */
export const COLOR_SLOTS: ColorSlotMeta[] = [
  { slot: 'background', label: 'Background', group: 'Canvas' },
  { slot: 'backgroundGlow', label: 'Ambient glow', group: 'Canvas', hint: 'Centre of the radial background wash' },
  { slot: 'titleText', label: 'Title text', group: 'Canvas' },

  { slot: 'panel', label: 'Panel fill', group: 'Track panel' },
  { slot: 'panelBorder', label: 'Panel edge', group: 'Track panel' },
  { slot: 'trackText', label: 'Track name', group: 'Track panel' },
  { slot: 'trackSubtext', label: 'Sub-label', group: 'Track panel' },
  { slot: 'trackIcon', label: 'Instrument icon', group: 'Track panel' },
  { slot: 'trackIndicator', label: 'Active dot', group: 'Track panel' },

  { slot: 'gridBar', label: 'Bar line', group: 'Grid' },
  { slot: 'gridBeat', label: 'Beat line', group: 'Grid' },
  { slot: 'trackSeparator', label: 'Lane separator', group: 'Grid' },

  { slot: 'clipHeader', label: 'Clip header', group: 'Clips' },
  { slot: 'clipHeaderText', label: 'Clip label', group: 'Clips' },
  { slot: 'clipBody', label: 'Clip fill', group: 'Clips' },
  { slot: 'clipBorder', label: 'Clip outline', group: 'Clips' },

  { slot: 'note', label: 'Note', group: 'Notes' },
  { slot: 'noteActive', label: 'Note (playing)', group: 'Notes' },
  { slot: 'noteGlow', label: 'Note glow', group: 'Notes' },
  { slot: 'noteSelected', label: 'Note (selected)', group: 'Notes' },

  { slot: 'playhead', label: 'Playhead', group: 'Playhead' },
  { slot: 'playheadGlow', label: 'Playhead glow', group: 'Playhead' },

  { slot: 'rulerBackground', label: 'Ruler fill', group: 'Timeline' },
  { slot: 'rulerText', label: 'Ruler text', group: 'Timeline' },
  { slot: 'rulerLine', label: 'Ruler line', group: 'Timeline' },
  { slot: 'sectionText', label: 'Marker text', group: 'Timeline' },
  { slot: 'sectionLine', label: 'Marker line', group: 'Timeline' },
];

/** A named theme plus the instrument colours it ships with. */
export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  theme: ColorTheme;
  instrumentPaletteId: string;
}

export type InstrumentPalette = Record<InstrumentFamily, string>;

export interface InstrumentPalettePreset {
  id: string;
  name: string;
  description: string;
  colors: InstrumentPalette;
}

/** How the renderer decides each note's colour. */
export type NoteColorMode = 'uniform' | 'instrument' | 'track' | 'velocity' | 'pitch';

export const NOTE_COLOR_MODES: Array<{ value: NoteColorMode; label: string; hint: string }> = [
  { value: 'uniform', label: 'Uniform', hint: 'Every note uses the Note colour' },
  { value: 'instrument', label: 'By instrument', hint: 'Colour comes from the instrument palette' },
  { value: 'track', label: 'By track', hint: 'Each track keeps its own assigned colour' },
  { value: 'velocity', label: 'By velocity', hint: 'Blends Note → Note (playing) with dynamics' },
  { value: 'pitch', label: 'By pitch', hint: 'Blends Note → accent across the pitch range' },
];
