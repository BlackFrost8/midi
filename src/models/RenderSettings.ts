import type { CameraKey, CameraMotion } from '../layout/DynamicCamera';
import type { ColorTheme, InstrumentPalette, NoteColorMode } from './ColorTheme';
import { DEFAULT_THEME_ID, instrumentPaletteById, themePresetById } from './Palettes';
import { seedFromTheme } from './ThemeBuilder';

export type TimelineMode = 'bars' | 'beats' | 'seconds' | 'timecode';
export type PitchMode = 'relative' | 'global';
export type TrackHeightPreset = 'auto' | 'compact' | 'normal' | 'large' | 'cinematic';
/** How the view tracks the playhead during playback. */
export type FollowMode = 'off' | 'page' | 'continuous';
export type NoteShape = 'bar' | 'capsule' | 'pill';
/**
 * 'list' is the compact row: icon, name and sub-label on one line.
 * 'cinematic' puts the name at the top of the lane and watermarks a large
 * instrument glyph behind it.
 */
export type PanelStyle = 'list' | 'cinematic';

/**
 * Simple mode derives the whole theme from two colours; advanced mode exposes
 * every slot. Switching between them never loses work — the seed is kept in
 * sync whenever a preset is applied.
 */
export type ColorEditMode = 'simple' | 'advanced';

/** How the colours run across a gradient icon. */
export type IconGradientStyle = 'diagonal' | 'vertical' | 'horizontal' | 'radial' | 'sweep';
/** Where gradient icon colours come from. */
export type IconGradientSource = 'accent' | 'custom';

export interface RenderSettings {
  // ---- Colour ----
  colorEditMode: ColorEditMode;
  /** Seed colours used by simple mode. */
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  /** How far the derived instrument gradient travels round the hue wheel. */
  gradientSpread: number;

  /** Paint track icons with a gradient instead of a flat colour. */
  iconGradient: boolean;
  /** 'accent' derives the colours from the accent; 'custom' uses iconGradientColors. */
  iconGradientSource: IconGradientSource;
  iconGradientStyle: IconGradientStyle;
  /** Two to four colours, used when the source is custom. */
  iconGradientColors: string[];
  /** How strongly gradient icons show, 0–1. Flat icons stay a faint watermark. */
  iconGradientOpacity: number;
  /** How much a pulsing icon glows and swells on each note, 0–1. */
  iconPulseStrength: number;
  /** Glow sync also lights the track's clips with its notes. */
  glowSyncClips: boolean;
  /** Glow sync also lights the track's lane behind its notes. */
  glowSyncLanes: boolean;
  /** Soloing a part with no stem narrows the recording to that part's register. */
  soloFocus: boolean;

  themeId: string;
  theme: ColorTheme;
  instrumentPaletteId: string;
  instrumentColors: InstrumentPalette;
  noteColorMode: NoteColorMode;

  // ---- Layout ----
  pitchMode: PitchMode;
  /** Semitones of headroom added above and below each track's range. */
  pitchPadding: number;
  trackHeightPreset: TrackHeightPreset;
  /** Multiplier applied on top of the preset height. */
  trackHeightScale: number;
  /**
   * How many lanes fill the frame. 0 fits every visible track; any other value
   * sizes lanes to that count and lets the rest scroll under the wheel.
   */
  visibleTrackCount: number;
  /**
   * Lanes divide the frame exactly between the tracks in view: no gaps above
   * or below, no minimum height that pushes tracks off screen, no scrolling.
   * Notes and labels scale down with the lanes when there are many tracks.
   */
  fillFrame: boolean;
  /** Camera follows the playing tracks: close on one, pulling back as more come in. */
  dynamicCamera: boolean;
  /** 0 slow … 1 fast. */
  dynamicSpeed: number;
  dynamicMotion: CameraMotion;
  /** Moments where you decide what the dynamic camera shows. */
  cameraKeys: CameraKey[];
  /**
   * Space each drum sound on its own evenly spaced row instead of by semitone.
   * Without it a kit's four or five pitches leave most of the lane empty.
   */
  compactPercussion: boolean;
  /** Track panel width as a fraction of canvas width. */
  trackPanelRatio: number;
  /** Outer margin as a fraction of canvas width. */
  marginRatio: number;

  // ---- Notes ----
  /** Note thickness in reference pixels (at a 1080-tall canvas). */
  noteHeight: number;
  noteRadius: number;
  /** Floor on note width so staccato notes stay visible. */
  noteMinWidth: number;
  noteOpacity: number;
  noteShape: NoteShape;
  /** 0 = all notes identical, 1 = velocity fully drives brightness. */
  velocityBrightness: number;
  /** 0 = draw every note, 1 = aggressively merge short neighbours. */
  densityReduction: number;

  // ---- Grid / chrome ----
  showGrid: boolean;
  showBeatLines: boolean;
  gridBarOpacity: number;
  gridBeatOpacity: number;
  showSeparators: boolean;
  separatorOpacity: number;
  showTrackPanel: boolean;
  showRuler: boolean;
  showClips: boolean;
  showClipNames: boolean;
  /** Clip header thickness in reference pixels; the label scales with it. */
  clipHeaderHeight: number;
  showMarkers: boolean;
  showInstrumentIcons: boolean;
  /** How the left-hand track panel is laid out. */
  panelStyle: PanelStyle;
  /** Which glyph library the track panel draws from. */
  iconSetId: string;
  /** Id of the look preset in use, for highlighting it in the UI. */
  lookId: string;
  /** Reveal the full set of controls rather than the handful that matter. */
  showAdvancedLook: boolean;
  showTrackSublabels: boolean;
  showTitle: boolean;
  titleText: string;
  /** A title card that fades in over the start of the video. */
  introCard: boolean;
  /** The intro shows the song title, the thumbnail (which then fades into the arrangement), or the title over the thumbnail. */
  introStyle: 'title' | 'thumbnail' | 'both';
  /** How the thumbnail's elements leave as it fades into the arrangement. */
  introMotion: IntroMotion;
  introSeconds: number;
  /** Second line on the intro card (the artist, the series…). */
  introSubtitle: string;
  /** Set only while exporting a Short: the hook caption, and the time it appears (seconds). */
  shortsCaption?: string;
  shortsStart?: number;
  /** Where the caption sits, as fractions of the frame. */
  shortsCaptionX?: number;
  shortsCaptionY?: number;
  /** An end card that fades the picture to black after the music ends. */
  outroCard: boolean;
  outroSeconds: number;
  outroText: string;
  /** The smaller line under it; empty shows the song title. */
  outroSubtext: string;
  /** One colour, or two to four for a gradient across the text. */
  outroTextColors: string[];
  /** Empty uses the accent. */
  outroSubColors: string[];
  /** Where the end card's text sits (its anchor), as fractions of the frame. */
  outroX: number;
  outroY: number;
  outroAlign: 'left' | 'center' | 'right';

  // ---- Atmosphere ----
  backgroundGlow: number;
  vignette: number;
  /** Bloom radius multiplier for active notes. */
  noteGlow: number;
  playheadGlow: number;
  playheadWidth: number;
  showPlayhead: boolean;
  /** The playhead dims away as the music ends. */
  playheadFadeOut: boolean;
  /** Notes brighten while the playhead is inside them. */
  highlightActiveNotes: boolean;
  /** Seconds of afterglow once a note has finished. */
  noteAfterglow: number;

  // ---- Timeline ----
  timelineMode: TimelineMode;
  /** Horizontal scale in pixels per beat (or per second in time modes), before DPI. */
  zoom: number;
  followMode: FollowMode;
  /**
   * Where the playhead sits across the frame while the view follows it, as a
   * fraction of the content width. Low values leave most of the frame for
   * what is coming up, which is what makes a scrolling video readable.
   */
  followAnchor: number;
  /** Draw only this many bars of lead-in before the first note. */
  leadInBars: number;
}

export const DEFAULT_SETTINGS: RenderSettings = (() => {
  const preset = themePresetById(DEFAULT_THEME_ID);
  const seed = seedFromTheme(preset.theme);
  return {
    colorEditMode: 'simple',
    primaryColor: seed.primary,
    accentColor: seed.accent,
    backgroundColor: seed.background,
    gradientSpread: 0.5,
    iconGradient: false,
    iconGradientSource: 'accent',
    iconGradientStyle: 'diagonal',
    iconGradientColors: ['#c9fbf7', '#67d9d5', '#5a6ff0'],
    iconGradientOpacity: 0.8,
    iconPulseStrength: 0.7,
    glowSyncClips: false,
    glowSyncLanes: false,
    soloFocus: true,

    themeId: preset.id,
    theme: { ...preset.theme },
    instrumentPaletteId: preset.instrumentPaletteId,
    instrumentColors: { ...instrumentPaletteById(preset.instrumentPaletteId).colors },
    noteColorMode: 'uniform',

    pitchMode: 'relative',
    pitchPadding: 3,
    trackHeightPreset: 'auto',
    trackHeightScale: 1,
    visibleTrackCount: 0,
    fillFrame: false,
    dynamicCamera: false,
    dynamicSpeed: 0.6,
    dynamicMotion: 'glide',
    cameraKeys: [],
    compactPercussion: true,
    trackPanelRatio: 0.1,
    marginRatio: 0.012,

    noteHeight: 7,
    noteRadius: 2,
    noteMinWidth: 2,
    noteOpacity: 0.95,
    noteShape: 'bar',
    velocityBrightness: 0.25,
    densityReduction: 0,

    showGrid: true,
    showBeatLines: true,
    gridBarOpacity: 0.75,
    gridBeatOpacity: 0.35,
    showSeparators: true,
    separatorOpacity: 0.7,
    showTrackPanel: true,
    showRuler: true,
    showClips: true,
    showClipNames: true,
    clipHeaderHeight: 16,
    showMarkers: true,
    showInstrumentIcons: true,
    panelStyle: 'list',
    iconSetId: 'instruments',
    lookId: 'overview',
    showAdvancedLook: false,
    showTrackSublabels: true,
    showTitle: false,
    titleText: '',
    introCard: false,
    introStyle: 'title',
    introMotion: 'dissolve',
    introSeconds: 4,
    introSubtitle: '',
    outroCard: false,
    outroSeconds: 5,
    outroText: 'Thanks for listening',
    outroSubtext: '',
    outroTextColors: ['#f2f5f5'],
    outroSubColors: [],
    outroX: 0.08,
    outroY: 0.5,
    outroAlign: 'left',

    backgroundGlow: 0.5,
    vignette: 0.35,
    noteGlow: 0.6,
    playheadGlow: 0.7,
    playheadWidth: 1.5,
    showPlayhead: true,
    playheadFadeOut: true,
    highlightActiveNotes: true,
    noteAfterglow: 0.35,

    timelineMode: 'bars',
    zoom: 12,
    followMode: 'continuous',
    followAnchor: 0.5,
    leadInBars: 0,
  };
})();

export const TRACK_HEIGHT_PRESETS: Record<Exclude<TrackHeightPreset, 'auto'>, number> = {
  compact: 42,
  normal: 68,
  large: 104,
  cinematic: 150,
};

export type IntroMotion = 'dissolve' | 'scatter' | 'slide' | 'fall' | 'rush';

export const INTRO_MOTIONS: Array<{ value: IntroMotion; label: string; hint: string }> = [
  { value: 'dissolve', label: 'Dissolve', hint: 'Everything fades into the arrangement' },
  { value: 'scatter', label: 'Scatter', hint: 'Each element flies outward, away from the centre' },
  { value: 'slide', label: 'Slide away', hint: 'Elements slide off to the nearer side, one after another' },
  { value: 'fall', label: 'Fall', hint: 'Elements drop out of the frame, one after another' },
  { value: 'rush', label: 'Fly through', hint: 'Elements rush past the camera, the nearest fastest' },
];

export interface ExportSettings {
  width: number;
  height: number;
  /** PNG background: false renders onto transparency. */
  opaqueBackground: boolean;
  format: 'png' | 'svg' | 'webm' | 'frames';
  /** Video frame rate. */
  fps: number;
  /** Video bitrate in megabits per second. */
  bitrateMbps: number;
  /** Render the whole arrangement in one static frame instead of the live view. */
  fitWholeArrangement: boolean;
  /** Mux the loaded audio track into MP4 exports. */
  includeAudio: boolean;
  /** Video export range in seconds; null means the full song. */
  rangeStart: number | null;
  rangeEnd: number | null;
  /** YouTube Short: length in seconds, hook caption, and start (null: the strongest moment, found automatically). */
  shortsSeconds?: number;
  shortsCaption?: string;
  shortsStart?: number | null;
  shortsCaptionX?: number;
  shortsCaptionY?: number;
}

export const EXPORT_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K', width: 3840, height: 2160 },
  { label: '8K', width: 7680, height: 4320 },
  { label: 'Square 1080', width: 1080, height: 1080 },
  { label: 'Vertical 1080', width: 1080, height: 1920 },
];

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  width: 3840,
  height: 2160,
  opaqueBackground: true,
  format: 'png',
  fps: 60,
  bitrateMbps: 40,
  // Default to reproducing what is on screen. Straight after loading, the view
  // is already fitted to the whole song, so this gives the reference poster
  // anyway — but once the user zooms or re-frames, the export follows them.
  fitWholeArrangement: false,
  includeAudio: true,
  rangeStart: null,
  rangeEnd: null,
};
