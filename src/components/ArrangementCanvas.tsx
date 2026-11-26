import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateLayout,
  domainForTimelineMode,
  projectDuration,
  xToUnit,
  type LayoutResult,
  type TimeDomain,
  type Viewport,
} from '../layout/LayoutEngine';
import type { MidiProject, TrackState } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import type { TimeMapper } from '../midi/TimeMapper';
import { prepareContext, renderScene } from '../renderer/CanvasRenderer';
import { noteAtPoint, type NoteRect } from '../renderer/NoteRenderer';
import { RenderCache } from '../renderer/RenderCache';
import type { IntroSource, Scene } from '../renderer/Scene';
import type { PlaybackController } from '../playback/PlaybackController';
import type { PreviewSynth } from '../playback/PreviewSynth';
import { clamp } from '../utils/math';
import { followScroll } from '../layout/Follow';

export interface ViewState {
  /** Pixels per domain unit. */
  pxPerUnit: number;
  scrollUnits: number;
  scrollY: number;
}

interface Props {
  project: MidiProject;
  settings: RenderSettings;
  trackStates: Map<string, TrackState>;
  mapper: TimeMapper;
  playback: PlaybackController;
  synth: PreviewSynth | null;
  audioEnabled: boolean;
  view: ViewState;
  onViewChange: (updater: (view: ViewState) => ViewState) => void;
  selectedNoteId: string | null;
  onSelectNote: (note: NoteRect | null) => void;
  onViewportReady: (viewport: Viewport, layout: LayoutResult) => void;
  /**
   * Width ÷ height of the frame being produced. The canvas is letterboxed to
   * this shape inside the available space, so the preview is the exact frame
   * the video will contain rather than whatever shape the window happens to be.
   */
  frameAspect?: number;
  /**
   * End of the session in seconds when it runs past the last note — a
   * recording's tail. Following and panning reach it, so the playhead stays
   * in view while the tail rings out.
   */
  sessionEndSeconds?: number;
  /** The intro card's start and thumbnail. */
  intro?: IntroSource;
}

interface HoverInfo {
  rect: NoteRect;
  clientX: number;
  clientY: number;
  trackName: string;
}

export function ArrangementCanvas(props: Props) {
  const {
    project,
    settings,
    trackStates,
    mapper,
    playback,
    synth,
    audioEnabled,
    view,
    onViewChange,
    selectedNoteId,
    onSelectNote,
    onViewportReady,
    frameAspect,
    sessionEndSeconds,
    intro,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef(new RenderCache());
  const dirtyRef = useRef(true);
  const sceneRef = useRef<Scene | null>(null);
  /** Content width of the last frame drawn, so a resize is reported straight away. */
  const contentWidthRef = useRef(0);
  const dragRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; startScroll: number; startScrollY: number }
    | { kind: 'playhead' }
    | null
  >(null);

  const [box, setBox] = useState({ width: 800, height: 450 });
  const size = useMemo(() => fitFrame(box, frameAspect), [box, frameAspect]);
  const frameLeft = Math.round((box.width - size.width) / 2);
  const frameTop = Math.round((box.height - size.height) / 2);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // Latest props for the animation loop, which must not re-subscribe per frame.
  const latest = useRef({
    project,
    settings,
    trackStates,
    view,
    selectedNoteId,
    hoverId: null as string | null,
    size,
    audioEnabled,
    sessionEndSeconds,
    intro,
  });
  latest.current = {
    project,
    settings,
    trackStates,
    view,
    selectedNoteId,
    hoverId: hover?.rect.note.id ?? null,
    size,
    audioEnabled,
    sessionEndSeconds,
    intro,
  };

  const domain = domainForTimelineMode(settings.timelineMode);

  // ---- Resize observation ----
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setBox({ width: Math.max(rect.width, 120), height: Math.max(rect.height, 120) });
      dirtyRef.current = true;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Transport events (a seek from the play bar or keyboard while paused) move
  // the playhead without touching any prop, so they must invalidate too.
  useEffect(() => {
    const unsubscribe = playback.subscribe(() => {
      dirtyRef.current = true;
    });
    return () => {
      unsubscribe();
    };
  }, [playback]);

  // Any settings or data change invalidates the frame.
  useEffect(() => {
    dirtyRef.current = true;
  }, [project, settings, trackStates, view, selectedNoteId, hover, size]);

  const buildScene = useCallback((): Scene => {
    const state = latest.current;
    const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 3);
    const viewport: Viewport = {
      width: state.size.width,
      height: state.size.height,
      pixelRatio,
      pxPerUnit: state.view.pxPerUnit,
      scrollUnits: state.view.scrollUnits,
      scrollY: state.view.scrollY,
    };
    const layout = calculateLayout({
      project: state.project,
      settings: state.settings,
      trackStates: state.trackStates,
      viewport,
      cameraSeconds: playback.position,
    });
    const seconds = playback.position;
    const playheadUnit =
      layout.domain === 'beats' ? mapper.secondsToBeats(seconds) : seconds;

    return {
      project: state.project,
      settings: state.settings,
      trackStates: state.trackStates,
      layout,
      viewport,
      playheadUnit,
      playheadSeconds: seconds,
      selectedNoteId: state.selectedNoteId,
      hoveredNoteId: state.hoverId,
      forExport: false,
      intro: state.intro,
    };
  }, [mapper, playback]);

  // ---- Render loop ----
  useEffect(() => {
    let frame = 0;
    let lastReport = 0;

    const loop = (timestamp: number) => {
      frame = requestAnimationFrame(loop);

      const moved = playback.tick(timestamp);
      if (moved) {
        dirtyRef.current = true;
        if (latest.current.audioEnabled && synth) {
          synth.update(playback.position, latest.current.trackStates);
        }
        maybeFollow(playback.position);
      }

      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const state = latest.current;
      const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 3);
      const ctx = prepareContext(canvas, state.size.width, state.size.height, pixelRatio);
      if (!ctx) return;

      const scene = buildScene();
      sceneRef.current = scene;
      renderScene(ctx, scene, cacheRef.current);

      const resized = Math.abs(scene.layout.contentWidth - contentWidthRef.current) > 0.5;
      contentWidthRef.current = scene.layout.contentWidth;

      // Track count, lane height and window size can all change under a stale
      // scroll offset; pull it back into range rather than showing blank space.
      const maxScrollY = Math.max(scene.layout.contentHeightTotal - scene.layout.lanesHeight, 0);
      if (state.view.scrollY > maxScrollY + 0.5) {
        onViewChange((v) => ({ ...v, scrollY: clamp(v.scrollY, 0, maxScrollY) }));
      }

      // Publishing the viewport lets the export panel reuse the live framing.
      // A resize is reported immediately rather than on the next tick, so the
      // owner can keep the zoom's span before more than a frame goes by.
      if (resized || timestamp - lastReport > 250) {
        lastReport = timestamp;
        onViewportReady(scene.viewport, scene.layout);
      }
    };

    /** Keeps the playhead on screen during playback. */
    const maybeFollow = (seconds: number) => {
      const state = latest.current;
      const mode = state.settings.followMode;
      if (mode === 'off') return;

      const scene = sceneRef.current;
      if (!scene) return;
      const unit = scene.layout.domain === 'beats' ? mapper.secondsToBeats(seconds) : seconds;
      const span = scene.layout.contentWidth / state.view.pxPerUnit;
      const duration = sessionLength(state.project, scene.layout.domain, mapper, state.sessionEndSeconds);
      // No point following when the whole song already fits.
      if (span >= duration) return;

      const left = state.view.scrollUnits;
      const target = followScroll({
        mode,
        anchor: state.settings.followAnchor,
        unit,
        span,
        duration,
        scroll: left,
      });
      if (Math.abs(target - left) > 0.001) {
        // Draw this frame at the new scroll too, rather than a frame later
        // when React catches up; otherwise the playhead creeps ahead of its
        // anchor by one frame's travel and the scroll looks uneven.
        latest.current = { ...state, view: { ...state.view, scrollUnits: target } };
        onViewChange((v) => ({ ...v, scrollUnits: target }));
      }
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [buildScene, mapper, onViewChange, onViewportReady, playback, synth]);

  // ---- Pointer interaction ----
  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const seekFromX = useCallback(
    (x: number) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const unit = Math.max(xToUnit(x, scene.layout, scene.viewport), 0);
      const seconds = scene.layout.domain === 'beats' ? mapper.beatsToSeconds(unit) : unit;
      playback.seek(seconds);
      if (audioEnabled && synth) synth.sync(playback.position);
      dirtyRef.current = true;
    },
    [audioEnabled, mapper, playback, synth],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { x, y } = localPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    // Clicking the ruler scrubs; clicking a note selects; anything else pans.
    const inRuler =
      y >= scene.layout.rulerTop && y <= scene.layout.rulerTop + scene.layout.rulerHeight;

    if (inRuler || event.altKey) {
      dragRef.current = { kind: 'playhead' };
      seekFromX(x);
      return;
    }

    const note = noteAtPoint(scene, x, y);
    if (note) {
      onSelectNote(note);
      dirtyRef.current = true;
      return;
    }

    onSelectNote(null);
    dragRef.current = {
      kind: 'pan',
      startX: x,
      startY: y,
      startScroll: view.scrollUnits,
      startScrollY: view.scrollY,
    };
    setGrabbing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { x, y } = localPoint(event);
    const drag = dragRef.current;

    if (drag?.kind === 'playhead') {
      seekFromX(x);
      return;
    }

    if (drag?.kind === 'pan') {
      const duration = sessionLength(scene.project, scene.layout.domain, mapper, latest.current.sessionEndSeconds);
      const span = scene.layout.contentWidth / scene.viewport.pxPerUnit;
      const deltaUnits = (drag.startX - x) / scene.viewport.pxPerUnit;
      const maxScrollY = Math.max(scene.layout.contentHeightTotal - scene.layout.lanesHeight, 0);
      onViewChange((v) => ({
        ...v,
        scrollUnits: clamp(drag.startScroll + deltaUnits, 0, Math.max(duration - span * 0.15, 0)),
        scrollY: clamp(drag.startScrollY + (drag.startY - y), 0, maxScrollY),
      }));
      return;
    }

    const hit = noteAtPoint(scene, x, y);
    if (!hit) {
      if (hover) setHover(null);
      return;
    }
    if (hover?.rect.note.id === hit.note.id) return;
    setHover({ rect: hit, clientX: x, clientY: y, trackName: hit.trackName });
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setGrabbing(false);
  };

  // Wheel handling is registered manually because React's synthetic wheel
  // listener is passive and cannot preventDefault on zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      const scene = sceneRef.current;
      if (!scene) return;
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const duration = sessionLength(scene.project, scene.layout.domain, mapper, latest.current.sessionEndSeconds);

      if (event.ctrlKey || event.metaKey) {
        // Zoom about the cursor: keep the musical position under it fixed.
        const anchorUnit = xToUnit(x, scene.layout, scene.viewport);
        const factor = Math.exp(-event.deltaY * 0.0025);
        onViewChange((v) => {
          const next = clamp(v.pxPerUnit * factor, minZoom(scene.layout, duration), 4000);
          const scroll = anchorUnit - (x - scene.layout.contentX) / next;
          return { ...v, pxPerUnit: next, scrollUnits: clamp(scroll, 0, duration) };
        });
        return;
      }

      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const delta = (event.shiftKey ? event.deltaY : event.deltaX) / scene.viewport.pxPerUnit;
        const span = scene.layout.contentWidth / scene.viewport.pxPerUnit;
        onViewChange((v) => ({
          ...v,
          scrollUnits: clamp(v.scrollUnits + delta, 0, Math.max(duration - span * 0.15, 0)),
        }));
        return;
      }

      // Plain wheel scrolls through the tracks. deltaMode 1 is line-based
      // (common on Windows mice), so convert it to pixels before applying.
      const maxScrollY = Math.max(scene.layout.contentHeightTotal - scene.layout.lanesHeight, 0);
      if (maxScrollY <= 0) return;
      const lineHeight = scene.layout.lanes[0]?.height ?? 48;
      const delta =
        event.deltaMode === 1
          ? event.deltaY * lineHeight
          : event.deltaMode === 2
            ? event.deltaY * scene.layout.lanesHeight
            : event.deltaY;
      onViewChange((v) => ({ ...v, scrollY: clamp(v.scrollY + delta, 0, maxScrollY) }));
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onViewChange]);

  const tooltip = useMemo(() => {
    if (!hover) return null;
    const { note } = hover.rect;
    return {
      x: clamp(hover.clientX + 14, 8, size.width - 170),
      y: clamp(hover.clientY - 54, 8, size.height - 70),
      note,
      trackName: hover.trackName,
    };
  }, [hover, size.height, size.width]);

  useEffect(() => {
    void domain;
  }, [domain]);

  return (
    <div className={`stage${grabbing ? ' grabbing' : ''}`} ref={containerRef}>
      <canvas
        ref={canvasRef}
        style={{ left: frameLeft, top: frameTop, width: size.width, height: size.height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(event) => seekFromX(localPoint(event).x)}
      />
      {tooltip && (
        <div className="overlay-card" style={{ left: tooltip.x + frameLeft, top: tooltip.y + frameTop }}>
          <div className="tooltip-title">{noteLabel(tooltip.note.pitch)}</div>
          <div className="tooltip-line">Velocity {Math.round(tooltip.note.velocity * 127)}</div>
          <div className="tooltip-line">{tooltip.note.durationBeats.toFixed(2)} beats</div>
        </div>
      )}
    </div>
  );
}

/** Zoom floor: never let the whole song shrink below the content width. */
function minZoom(layout: LayoutResult, duration: number): number {
  return Math.max(layout.contentWidth / Math.max(duration, 1), 0.01) * 0.9;
}

function noteLabel(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** Largest rectangle of the given aspect that fits the box; the box itself when no aspect is set. */
function fitFrame(
  box: { width: number; height: number },
  aspect: number | undefined,
): { width: number; height: number } {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return box;
  let width = box.width;
  let height = width / aspect;
  if (height > box.height) {
    height = box.height;
    width = height * aspect;
  }
  return { width: Math.max(Math.floor(width), 120), height: Math.max(Math.floor(height), 120) };
}

/** Length of the session in the layout's domain: the song, or further if a recording's tail runs on. */
function sessionLength(
  project: MidiProject,
  domain: TimeDomain,
  mapper: TimeMapper,
  sessionEndSeconds: number | undefined,
): number {
  const song = projectDuration(project, domain);
  if (sessionEndSeconds === undefined) return song;
  return Math.max(song, domain === 'beats' ? mapper.secondsToBeats(sessionEndSeconds) : sessionEndSeconds);
}
