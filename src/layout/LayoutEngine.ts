import { laneWeights } from './DynamicCamera';
import type { MidiProject, TrackState, VisualTrack } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import { TRACK_HEIGHT_PRESETS } from '../models/RenderSettings';
import { clamp } from '../utils/math';
import { calculatePitchRange, type PitchRange } from './PitchMapper';
import { resolveTrackColor } from './ColorResolver';

/**
 * Geometry is authored against a 1080-tall canvas and scaled from there, so a
 * 4K export is the same picture at higher resolution rather than a different
 * composition.
 */
export const REFERENCE_HEIGHT = 1080;

/** Which time domain the horizontal axis represents. */
export type TimeDomain = 'beats' | 'seconds';

export interface Viewport {
  /** Logical (CSS) pixel size of the drawing surface. */
  width: number;
  height: number;
  /** Backing-store scale. The context is pre-scaled by this, so all renderer
   *  maths stays in logical pixels; it is only needed for hairline crispness. */
  pixelRatio: number;
  /** Horizontal scale: pixels per beat, or per second in time domains. */
  pxPerUnit: number;
  /** Domain value at the left edge of the content area. */
  scrollUnits: number;
  /** Vertical scroll offset in pixels. */
  scrollY: number;
}

/** Even-row pitch mapping used for percussion lanes. */
export interface PitchRows {
  /** MIDI pitch → row index, lowest pitch is row 0. */
  index: Map<number, number>;
  count: number;
}

export interface LaneLayout {
  track: VisualTrack;
  state: TrackState;
  /** Index among visible lanes. */
  index: number;
  top: number;
  height: number;
  /** Note-drawing sub-rectangle, below the clip header strip. */
  contentTop: number;
  contentHeight: number;
  headerHeight: number;
  pitchRange: PitchRange;
  /** Non-null when this lane uses even-row spacing instead of semitones. */
  pitchRows: PitchRows | null;
  color: string;
  /** True when a solo elsewhere is silencing this lane. */
  dimmed: boolean;
  /** 0–1: the dynamic camera fades idle lanes out; 1 otherwise. */
  opacity: number;
}

export interface LayoutResult {
  /** Uniform geometry scale derived from canvas height. */
  scale: number;
  domain: TimeDomain;
  /** Total song length expressed in the active domain. */
  domainDuration: number;

  panelX: number;
  panelWidth: number;
  contentX: number;
  contentWidth: number;

  titleTop: number;
  titleHeight: number;
  markerTop: number;
  markerHeight: number;
  rulerTop: number;
  rulerHeight: number;
  lanesTop: number;
  lanesHeight: number;
  /**
   * Vertical extent actually occupied by lanes, clipped to the lanes region.
   * Grid lines, marker lines and the playhead use this so they do not run off
   * into empty space above and below a centred block of lanes.
   */
  gridTop: number;
  gridBottom: number;

  lanes: LaneLayout[];
  /** Sum of all lane heights; exceeds lanesHeight when vertical scrolling. */
  contentHeightTotal: number;
  noteHeight: number;
}

export interface LayoutInput {
  project: MidiProject;
  settings: RenderSettings;
  trackStates: Map<string, TrackState>;
  viewport: Viewport;
  /**
   * Force every visible lane into the available height instead of clamping to a
   * comfortable minimum. Exports use this so a still frame never silently drops
   * the bottom tracks off the canvas.
   */
  fitLanes?: boolean;
  /** Playhead time, for the dynamic camera (Visual → Dynamic). */
  cameraSeconds?: number;
}

export function domainForTimelineMode(mode: RenderSettings['timelineMode']): TimeDomain {
  return mode === 'seconds' || mode === 'timecode' ? 'seconds' : 'beats';
}

/** Start of a note in the active domain. */
export function noteStart(note: { startBeats: number; startSeconds: number }, domain: TimeDomain): number {
  return domain === 'beats' ? note.startBeats : note.startSeconds;
}

export function noteDuration(
  note: { durationBeats: number; durationSeconds: number },
  domain: TimeDomain,
): number {
  return domain === 'beats' ? note.durationBeats : note.durationSeconds;
}

export function trackMaxDuration(track: VisualTrack, domain: TimeDomain): number {
  return domain === 'beats' ? track.maxDurationBeats : track.maxDurationSeconds;
}

export function projectDuration(project: MidiProject, domain: TimeDomain): number {
  return domain === 'beats' ? project.durationBeats : project.durationSeconds;
}

/**
 * Builds the full frame geometry. Pure: same inputs always produce the same
 * layout, which is what lets the export renderer reuse it at any resolution.
 */
export function calculateLayout({
  project,
  settings,
  trackStates,
  viewport,
  fitLanes = false,
  cameraSeconds,
}: LayoutInput): LayoutResult {
  const scale = viewport.height / REFERENCE_HEIGHT;
  const domain = domainForTimelineMode(settings.timelineMode);
  const margin = viewport.width * settings.marginRatio;

  const panelWidth = settings.showTrackPanel
    ? clamp(viewport.width * settings.trackPanelRatio, 120 * scale, 340 * scale)
    : 0;
  const panelX = margin;
  const contentX = panelX + panelWidth;
  const contentWidth = Math.max(viewport.width - contentX - margin, 10);

  const titleHeight = settings.showTitle ? 46 * scale : 0;
  const titleTop = margin * 0.5;

  const anySolo = [...trackStates.values()].some((s) => s.solo);
  const visibleTracks = project.tracks.filter((track) => {
    const state = trackStates.get(track.id);
    return state ? state.visible : true;
  });

  const hasMarkers = settings.showMarkers && project.markers.length > 0;
  const markerHeight = hasMarkers ? 24 * scale : 0;
  const rulerHeight = settings.showRuler ? 30 * scale : 0;

  const markerTop = titleTop + titleHeight + (settings.showTitle ? 8 * scale : 0);
  const rulerTop = markerTop + markerHeight;
  // Breathing room under a ruler or title; with neither, lanes start flush at
  // the top edge so a full-bleed look really is edge to edge.
  const hasChromeAbove = settings.showTitle || markerHeight > 0 || rulerHeight > 0;
  const lanesTop = rulerTop + rulerHeight + (hasChromeAbove ? 10 * scale : 0);
  const lanesHeight = Math.max(viewport.height - lanesTop - margin, 40);

  const baseLaneHeight = resolveLaneHeight(settings, visibleTracks.length, lanesHeight, scale, fitLanes);
  let laneHeight = baseLaneHeight;
  const contentHeightTotal = visibleTracks.length * laneHeight;

  // When the lanes do not fill the frame, centre them rather than leaving all
  // the empty space at the bottom. Scrolled content is never centred.
  const centreOffset = Math.max((lanesHeight - contentHeightTotal) / 2, 0);
  const maxScrollY = Math.max(contentHeightTotal - lanesHeight, 0);
  const scrollY = clamp(viewport.scrollY, 0, maxScrollY);
  let laneOrigin = lanesTop + centreOffset - scrollY;
  let noteScale = 1;

  // Dynamic camera: only the playing lanes are in frame. Each lane's height and
  // opacity follow its presence, so idle lanes shrink and fade away and lanes
  // about to play grow and fade back in; the present ones fill the frame.
  let weights: Float32Array | null = null;
  if (settings.dynamicCamera && cameraSeconds !== undefined && visibleTracks.length > 1) {
    const silent = new Set(
      visibleTracks
        .filter((track) => {
          const state = trackStates.get(track.id);
          return state ? state.muted || (anySolo && !state.solo) : false;
        })
        .map((track) => track.id),
    );
    weights = laneWeights(project, visibleTracks, silent, cameraSeconds, {
      speed: settings.dynamicSpeed ?? 0.6,
      motion: settings.dynamicMotion ?? 'glide',
      keys: settings.cameraKeys,
    });
    let total = 0;
    for (const w of weights) total += w;
    // One lane alone is held to most of the frame rather than all of it.
    laneHeight = Math.min(lanesHeight / Math.max(total, 1e-3), lanesHeight * 0.82);
    laneOrigin = lanesTop + (lanesHeight - laneHeight * total) / 2;
    // Notes grow with the zoom, but less than the lane, so a close-up stays crisp rather than blocky.
    const zoom = laneHeight / Math.max(lanesHeight / visibleTracks.length, 1);
    noteScale = clamp(1 + (zoom - 1) * 0.45, 1, 2.4);
  }

  // Clip header strip: proportional to the lane, capped so it stays a strip
  // rather than a band, and dropped entirely once it would be a hairline.
  const rawHeader = Math.min(settings.clipHeaderHeight * scale, laneHeight * 0.22);
  const headerHeight = settings.showClips && rawHeader >= 3.5 * scale ? rawHeader : 0;
  const laneGap = Math.min(8 * scale, laneHeight * 0.12);

  // A filled frame can hold many thin lanes. Keep notes in proportion to the
  // lane so a busy part stays a line of notes rather than one solid block.
  const baseNoteHeight = Math.max(settings.noteHeight * scale * noteScale, 1);
  const noteHeight = settings.fillFrame
    ? Math.min(baseNoteHeight, Math.max((laneHeight - headerHeight - laneGap) / 8, 1.5 * scale, 1))
    : baseNoteHeight;

  let cursor = laneOrigin;
  const lanes: LaneLayout[] = visibleTracks.map((track, index) => {
    const state = trackStates.get(track.id) ?? defaultState();
    const presence = weights ? weights[index] : 1;
    const top = weights ? cursor : laneOrigin + index * laneHeight;
    const height = laneHeight * presence;
    cursor += height;
    const contentTop = top + (headerHeight + laneGap * 0.5) * presence;
    const contentHeight = Math.max(height - (headerHeight + laneGap) * presence, noteHeight * presence);

    return {
      track,
      state,
      index,
      top,
      height,
      contentTop,
      contentHeight,
      headerHeight: headerHeight * presence,
      opacity: presence,
      pitchRange: calculatePitchRange(track, settings, project),
      pitchRows: buildPitchRows(track, settings),
      color: resolveTrackColor(track, state, settings),
      dimmed: anySolo && !state.solo,
    };
  });

  const lanesBottom = lanesTop + lanesHeight;
  const gridTop = lanes.length ? clamp(lanes[0].top, lanesTop, lanesBottom) : lanesTop;
  const gridBottom = lanes.length
    ? clamp(lanes[lanes.length - 1].top + lanes[lanes.length - 1].height, lanesTop, lanesBottom)
    : lanesBottom;

  return {
    scale,
    domain,
    domainDuration: projectDuration(project, domain),
    panelX,
    panelWidth,
    contentX,
    contentWidth,
    titleTop,
    titleHeight,
    markerTop,
    markerHeight,
    rulerTop,
    rulerHeight,
    lanesTop,
    lanesHeight,
    gridTop,
    gridBottom,
    lanes,
    contentHeightTotal,
    noteHeight,
  };
}

/**
 * Drum kits scatter a handful of unrelated pitches across a wide MIDI range
 * (kick 36, hats 42, crash 49), which by semitone leaves most of the lane
 * empty. Mapping each distinct pitch to an evenly spaced row instead turns the
 * lane into a readable kit grid. Melodic tracks always keep true pitch spacing.
 */
function buildPitchRows(track: VisualTrack, settings: RenderSettings): PitchRows | null {
  if (!settings.compactPercussion) return null;
  if (!track.isPercussion && track.family !== 'drums') return null;
  if (track.distinctPitches.length < 2 || track.distinctPitches.length > 32) return null;

  const index = new Map<number, number>();
  track.distinctPitches.forEach((pitch, i) => index.set(pitch, i));
  return { index, count: track.distinctPitches.length };
}

function defaultState(): TrackState {
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

/**
 * Auto mode divides the available height evenly, clamped so a 2-track file does
 * not produce two absurd 500px lanes and a 40-track file stays legible (it
 * scrolls instead).
 */
function resolveLaneHeight(
  settings: RenderSettings,
  trackCount: number,
  available: number,
  scale: number,
  fitLanes: boolean,
): number {
  if (trackCount === 0) return 60 * scale;

  // Fill: the tracks in view share the height exactly, however many there are.
  if (settings.fillFrame) {
    const inView =
      settings.visibleTrackCount > 0 ? Math.min(settings.visibleTrackCount, trackCount) : trackCount;
    return Math.max(available / inView, 4 * scale);
  }

  // "Tracks in view" sizes lanes to a fixed count so the remainder scrolls,
  // which is what makes wheel scrolling meaningful on a large arrangement.
  // It is honoured everywhere, exports included: whatever the visual settings
  // say the frame holds is what every render produces. The caller decides
  // whether to force-fit (see `fitLanes`), and only does so when the user has
  // left this on "All".
  const inView =
    settings.visibleTrackCount > 0
      ? Math.min(settings.visibleTrackCount, trackCount)
      : trackCount;
  const ideal = available / inView;
  // A one- or two-track file must not be given the whole canvas height for a
  // single lane: a drum part spread over 800px is mostly empty space. Cap the
  // lane at a fraction of the frame and centre the block instead.
  // When a track count is requested, though, that many lanes must exactly
  // fill the frame — a short file then shows the same lane size, centred.
  const autoCeiling = Math.min(Math.max(168 * scale, available * 0.42), 340 * scale);
  const ceiling =
    settings.visibleTrackCount > 0
      ? Math.max(autoCeiling, available / settings.visibleTrackCount)
      : autoCeiling;

  let base: number;
  if (settings.trackHeightPreset === 'auto') {
    // Fitting may shrink below the comfortable minimum; it never grows past the ceiling.
    base = fitLanes ? clamp(ideal, 8 * scale, ceiling) : clamp(ideal, 34 * scale, ceiling);
  } else {
    base = TRACK_HEIGHT_PRESETS[settings.trackHeightPreset] * scale;
    if (fitLanes) base = Math.min(base, Math.max(ideal, 8 * scale));
  }
  return Math.max(base * settings.trackHeightScale, fitLanes ? 8 * scale : 14 * scale);
}

/** Domain value → x pixel. */
export function unitToX(unit: number, layout: LayoutResult, viewport: Viewport): number {
  return layout.contentX + (unit - viewport.scrollUnits) * viewport.pxPerUnit;
}

/** x pixel → domain value. */
export function xToUnit(x: number, layout: LayoutResult, viewport: Viewport): number {
  return viewport.scrollUnits + (x - layout.contentX) / viewport.pxPerUnit;
}

/** The domain interval currently on screen, with a small bleed on each side. */
export function visibleRange(
  layout: LayoutResult,
  viewport: Viewport,
): { start: number; end: number } {
  const start = viewport.scrollUnits;
  const end = start + layout.contentWidth / viewport.pxPerUnit;
  return { start, end };
}
