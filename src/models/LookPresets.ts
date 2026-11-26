import type { MidiProject } from './MidiProject';
import type { RenderSettings } from './RenderSettings';

/**
 * Whole-look presets.
 *
 * Each one sets every layout and chrome option at once, so the common case is
 * picking a preset rather than touching twenty sliders. Colour is deliberately
 * left out: presets never overwrite the palette you chose.
 */
export interface LookPreset {
  id: string;
  name: string;
  description: string;
  /** Everything except colour. */
  settings: Partial<RenderSettings>;
  /**
   * Bars to fit across the frame. null means "fit the whole song", which the
   * app turns into a zoom level once it knows the canvas width.
   */
  barsOnScreen: number | null;
  /**
   * Alternative to barsOnScreen: how many seconds of music should cross the
   * frame. Converted to whole bars at the file's tempo, so a fast song and a
   * slow one scroll at the same comfortable pace instead of the same number of
   * bars racing past at very different speeds.
   */
  secondsOnScreen?: number;
}

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: 'cinematic',
    name: 'Cinematic',
    description:
      'Full-bleed, every track on screen, the playhead pinned near the left while the music scrolls in. The look for a music video.',
    barsOnScreen: null,
    // Measured from the reference video: about eight seconds of music span the
    // frame (six bars at 180 BPM), scrolling at a constant speed.
    secondsOnScreen: 8,
    settings: {
      // Edge to edge: no frame margin, no ruler, no marker band, no title.
      marginRatio: 0,
      showRuler: false,
      showMarkers: false,
      showTitle: false,

      // Every track on screen at once, the lanes sharing the full height.
      trackHeightPreset: 'auto',
      trackHeightScale: 1,
      visibleTrackCount: 0,
      fillFrame: true,

      // Big, solid notes — they are the subject at this zoom.
      noteHeight: 11,
      noteRadius: 0,
      noteMinWidth: 3,
      noteOpacity: 1,
      velocityBrightness: 0.15,

      // Bar divisions only, and barely there.
      showGrid: true,
      showBeatLines: false,
      gridBarOpacity: 0.55,
      showSeparators: true,
      separatorOpacity: 0.8,

      // Clips carry the labelling now that the ruler is gone.
      showClips: true,
      showClipNames: true,
      clipHeaderHeight: 37,
      panelStyle: 'cinematic',
      showInstrumentIcons: true,
      showTrackSublabels: false,
      trackPanelRatio: 0.115,

      // A soft travelling light rather than a hairline.
      showPlayhead: true,
      playheadWidth: 2.5,
      playheadGlow: 0.85,
      highlightActiveNotes: true,
      noteGlow: 0.5,
      noteAfterglow: 0.4,

      backgroundGlow: 0.3,
      vignette: 0,
      followMode: 'continuous',
      // The reference keeps the playhead a fifth of the way in, so most of the
      // frame shows what is about to play rather than what already has.
      followAnchor: 0.2,
      timelineMode: 'bars',
      pitchMode: 'relative',
    },
  },
  {
    id: 'overview',
    name: 'Overview',
    description: 'The whole arrangement in one frame, every track visible. Good for a still.',
    barsOnScreen: null,
    settings: {
      marginRatio: 0.012,
      showRuler: true,
      showMarkers: true,
      showTitle: false,
      trackHeightPreset: 'auto',
      trackHeightScale: 1,
      visibleTrackCount: 0,
      fillFrame: false,
      noteHeight: 7,
      noteRadius: 2,
      noteMinWidth: 2,
      noteOpacity: 0.95,
      velocityBrightness: 0.25,
      showGrid: true,
      showBeatLines: true,
      gridBarOpacity: 0.75,
      showSeparators: true,
      separatorOpacity: 0.7,
      showClips: true,
      showClipNames: true,
      clipHeaderHeight: 16,
      panelStyle: 'list',
      showInstrumentIcons: true,
      showTrackSublabels: true,
      trackPanelRatio: 0.1,
      showPlayhead: true,
      playheadWidth: 1.5,
      playheadGlow: 0.7,
      highlightActiveNotes: true,
      noteGlow: 0.6,
      noteAfterglow: 0.35,
      backgroundGlow: 0.5,
      vignette: 0.35,
      followMode: 'continuous',
      followAnchor: 0.5,
      timelineMode: 'bars',
      pitchMode: 'relative',
    },
  },
  {
    id: 'studio',
    name: 'Studio',
    description: 'Dense and analytical: every track, beat grid, one shared pitch scale.',
    barsOnScreen: 32,
    settings: {
      marginRatio: 0.012,
      showRuler: true,
      showMarkers: true,
      showTitle: false,
      trackHeightPreset: 'compact',
      trackHeightScale: 1,
      visibleTrackCount: 0,
      fillFrame: false,
      noteHeight: 5,
      noteRadius: 1,
      noteMinWidth: 1.5,
      noteOpacity: 0.95,
      velocityBrightness: 0.45,
      showGrid: true,
      showBeatLines: true,
      gridBarOpacity: 0.9,
      gridBeatOpacity: 0.45,
      showSeparators: true,
      separatorOpacity: 0.9,
      showClips: true,
      showClipNames: false,
      clipHeaderHeight: 12,
      panelStyle: 'list',
      showInstrumentIcons: true,
      showTrackSublabels: true,
      trackPanelRatio: 0.12,
      showPlayhead: true,
      playheadWidth: 1,
      playheadGlow: 0.4,
      highlightActiveNotes: true,
      noteGlow: 0.3,
      noteAfterglow: 0.15,
      backgroundGlow: 0.25,
      vignette: 0.15,
      followMode: 'page',
      followAnchor: 0.5,
      timelineMode: 'bars',
      pitchMode: 'global',
    },
  },
];

export const DEFAULT_LOOK_ID = 'cinematic';

export function lookPresetById(id: string): LookPreset {
  return LOOK_PRESETS.find((preset) => preset.id === id) ?? LOOK_PRESETS[0];
}

/**
 * Applies a preset on top of existing settings.
 *
 * Colour fields are untouched by construction — no preset declares any — so
 * switching looks never disturbs a palette you have set up.
 */
export function applyLook(settings: RenderSettings, id: string): RenderSettings {
  const preset = lookPresetById(id);
  return { ...settings, ...preset.settings, lookId: preset.id };
}

/**
 * Bars to put across the frame for a preset on a particular file, or null to
 * fit the whole song. Seconds-based presets are converted at the opening tempo
 * and rounded to whole bars so the zoom slider shows a clean number.
 */
export function presetBarsOnScreen(preset: LookPreset, project: MidiProject | null): number | null {
  if (preset.secondsOnScreen === undefined) return preset.barsOnScreen;
  const sig = project?.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  const beatsPerBar = (sig.numerator * 4) / sig.denominator;
  const bpm = project?.tempos[0]?.bpm ?? 120;
  const barSeconds = (beatsPerBar * 60) / Math.max(bpm, 1);
  return Math.max(2, Math.round(preset.secondsOnScreen / barSeconds));
}
