import { calculateLayout, projectDuration, type Viewport } from '../layout/LayoutEngine';
import type { MidiProject, TrackState } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import { TimeMapper } from '../midi/TimeMapper';
import type { IntroSource, Scene } from '../renderer/Scene';

export interface ExportSceneInput {
  project: MidiProject;
  settings: RenderSettings;
  trackStates: Map<string, TrackState>;
  width: number;
  height: number;
  /** Playhead position in seconds. */
  playheadSeconds: number;
  /**
   * true: scale the whole arrangement to fit the frame horizontally.
   * false: reuse the on-screen zoom and scroll position.
   *
   * This governs the horizontal framing only. The vertical layout — lane
   * height, tracks in view, scroll position — always comes from the visual
   * settings, so an export looks like what is on screen.
   */
  fitWholeArrangement: boolean;
  /** Required when fitWholeArrangement is false. */
  sourceViewport?: Viewport;
  /** Present so the exporter can convert seconds to beats for the playhead. */
  mapper: TimeMapper;
  /**
   * End of the session in seconds, when it runs past the last note (a
   * recording's tail). "Whole song" framing then spans it too, so the
   * playhead does not leave the frame while the tail rings out.
   */
  spanEndSeconds?: number;
  /** The intro card's start and thumbnail. */
  intro?: IntroSource;
  /** The real time, when the arrangement is held on its last note (see Scene.clockSeconds). */
  clockSeconds?: number;
}

/**
 * Builds a Scene for an offscreen surface of arbitrary size. Because this
 * produces the same Scene shape the live canvas uses, an export is a genuine
 * re-render at the target resolution — never an upscaled screenshot, and never
 * carrying UI chrome.
 */
export function buildExportScene(input: ExportSceneInput): Scene {
  const { project, settings, trackStates, width, height, mapper } = input;

  // Layout is independent of horizontal scale, so a placeholder viewport is
  // enough to discover contentWidth; the real scale is derived from it.
  const probe: Viewport = {
    width,
    height,
    pixelRatio: 1,
    pxPerUnit: 1,
    scrollUnits: 0,
    scrollY: 0,
  };

  // Force-fitting every lane into the frame is only safe when the user has not
  // asked for a specific number of tracks in view. If they have, that setting
  // wins and the extra lanes scroll, exactly as they do on screen.
  const fitLanes = input.fitWholeArrangement && settings.visibleTrackCount === 0;

  const probeLayout = calculateLayout({
    project,
    settings,
    trackStates,
    viewport: probe,
    fitLanes,
    cameraSeconds: input.playheadSeconds,
  });

  const spanEnd =
    input.spanEndSeconds === undefined
      ? 0
      : probeLayout.domain === 'beats'
        ? mapper.secondsToBeats(input.spanEndSeconds)
        : input.spanEndSeconds;
  const domainDuration = Math.max(projectDuration(project, probeLayout.domain), spanEnd, 1e-6);
  let viewport: Viewport;

  // Vertical scroll is carried across from the screen whenever there is one,
  // independently of the horizontal framing choice.
  const verticalRatio = input.sourceViewport
    ? height / Math.max(input.sourceViewport.height, 1)
    : 1;
  const scrollY = fitLanes ? 0 : (input.sourceViewport?.scrollY ?? 0) * verticalRatio;

  if (input.fitWholeArrangement || !input.sourceViewport) {
    viewport = {
      ...probe,
      pxPerUnit: probeLayout.contentWidth / domainDuration,
      scrollUnits: 0,
      scrollY,
    };
  } else {
    // Preserve the on-screen framing but rescale it to the export size so the
    // same musical span — and the same set of lanes — is visible.
    const source = input.sourceViewport;
    const sourceLayout = calculateLayout({ project, settings, trackStates, viewport: source });
    const ratio = probeLayout.contentWidth / Math.max(sourceLayout.contentWidth, 1);
    viewport = {
      ...probe,
      pxPerUnit: source.pxPerUnit * ratio,
      scrollUnits: source.scrollUnits,
      scrollY,
    };
  }

  // Lane positions depend on scrollY, so the final layout has to be built from
  // the resolved viewport rather than the probe.
  const layout =
    viewport.scrollY === probe.scrollY
      ? probeLayout
      : calculateLayout({ project, settings, trackStates, viewport, fitLanes, cameraSeconds: input.playheadSeconds });

  const playheadUnit =
    layout.domain === 'beats' ? mapper.secondsToBeats(input.playheadSeconds) : input.playheadSeconds;

  return {
    project,
    settings,
    trackStates,
    layout,
    viewport,
    playheadUnit,
    playheadSeconds: input.playheadSeconds,
    selectedNoteId: null,
    hoveredNoteId: null,
    forExport: true,
    intro: input.intro,
    clockSeconds: input.clockSeconds,
  };
}
