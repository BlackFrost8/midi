import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { resolveTrackColor } from '../layout/ColorResolver';
import { beatsToBarBeat } from '../midi/MidiAnalyzer';
import type { TimeMapper } from '../midi/TimeMapper';
import { defaultTrackState, type MidiProject, type TrackState } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import type { PlaybackController } from '../playback/PlaybackController';
import { formatSeconds } from '../utils/formatting';
import { clamp } from '../utils/math';

interface Props {
  project: MidiProject;
  settings: RenderSettings;
  trackStates: Map<string, TrackState>;
  playback: PlaybackController;
  mapper: TimeMapper;
  playing: boolean;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  /**
   * The span the bar covers. Usually the MIDI, but widened to include a
   * recording's intro (negative start) and tail when one is loaded.
   */
  start: number;
  end: number;
}

/** Minimum gap between marker labels before the later one is reduced to a tick. */
const MARKER_LABEL_GAP = 72;

/**
 * The play bar: a miniature of the whole arrangement that doubles as a seek
 * control. Each visible track is a thin row showing where it plays, so the
 * shape of the song — intro, entries, drops, breakdowns — is visible at a
 * glance and any part of it is one click away.
 *
 * Position is animated from the playback clock through refs rather than React
 * state, so the bar moves smoothly without re-rendering 60 times a second.
 */
export const SeekBar = memo(function SeekBar({
  project,
  settings,
  trackStates,
  playback,
  mapper,
  playing,
  onPlayPause,
  onSeek,
  start,
  end,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unplayedRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const draggingRef = useRef(false);

  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const span = Math.max(end - start, 1e-6);
  /** Fraction of the bar's width at which a time falls. */
  const fractionOf = (seconds: number) => (seconds - start) / span;

  // ---- Size ----
  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---- Arrangement miniature ----
  const visibleTracks = useMemo(
    () => project.tracks.filter((track) => trackStates.get(track.id)?.visible ?? true),
    [project, trackStates],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ratio = clamp(window.devicePixelRatio || 1, 1, 3);
    const cssHeight = canvas.clientHeight || 34;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, cssHeight);

    const rows = Math.max(visibleTracks.length, 1);
    const rowHeight = cssHeight / rows;
    // A hairline between rows keeps tracks distinct even when there are many.
    const gap = rowHeight >= 5 ? 1 : rowHeight >= 2.4 ? 0.75 : 0;
    const columns = Math.max(Math.floor(width), 1);
    const density = new Float32Array(columns);

    visibleTracks.forEach((track, row) => {
      density.fill(0);
      for (const note of track.notes) {
        const from = Math.floor(fractionOf(note.startSeconds) * columns);
        const to = Math.floor(fractionOf(note.startSeconds + note.durationSeconds) * columns);
        for (let x = Math.max(from, 0); x <= Math.min(to, columns - 1); x++) density[x] += 1;
      }

      const state = trackStates.get(track.id) ?? defaultTrackState();
      ctx.fillStyle = resolveTrackColor(track, state, settings);
      const y = row * rowHeight;
      const h = Math.max(rowHeight - gap, 1);
      for (let x = 0; x < columns; x++) {
        if (density[x] <= 0) continue;
        // More simultaneous notes read brighter, so busy passages stand out.
        ctx.globalAlpha = (state.muted ? 0.3 : 1) * (0.4 + 0.6 * Math.min(density[x] / 4, 1));
        ctx.fillRect(x, y, 1, h);
      }
    });
    ctx.globalAlpha = 1;
  }, [start, span, settings, trackStates, visibleTracks, width]);

  // ---- Playhead animation ----
  useEffect(() => {
    let frame = 0;
    let last = -1;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const position = playback.position;
      if (position === last) return;
      last = position;
      const percent = `${clamp(fractionOf(position), 0, 1) * 100}%`;
      if (unplayedRef.current) unplayedRef.current.style.left = percent;
      if (handleRef.current) handleRef.current.style.left = percent;
      if (timeRef.current) timeRef.current.textContent = formatSeconds(position);
      trackRef.current?.setAttribute('aria-valuenow', position.toFixed(1));
      trackRef.current?.setAttribute('aria-valuetext', formatSeconds(position));
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [start, span, playback]);

  // ---- Pointer seeking ----
  const secondsAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return start + clamp((clientX - rect.left) / rect.width, 0, 1) * span;
  };

  const localX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? clamp(clientX - rect.left, 0, rect.width) : 0;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setScrubbing(true);
    onSeek(secondsAt(event.clientX));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    setHoverX(localX(event.clientX));
    if (draggingRef.current) onSeek(secondsAt(event.clientX));
  };

  const endDrag = () => {
    draggingRef.current = false;
    setScrubbing(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Arrows fall through to the app-wide shortcuts; these are slider extras.
    if (event.key === 'Home') {
      event.preventDefault();
      onSeek(start);
    } else if (event.key === 'End') {
      event.preventDefault();
      onSeek(Math.max(end - 0.05, start));
    }
  };

  // ---- Hover readout ----
  const hoverLabel = useMemo(() => {
    if (hoverX === null || width <= 0) return null;
    const seconds = start + (hoverX / width) * span;
    // Before the first note there is no bar yet; after the last, the tail.
    if (seconds < 0) return `Intro · ${formatSeconds(seconds)}`;
    if (seconds > project.durationSeconds) return `Tail · ${formatSeconds(seconds)}`;
    const { bar } = beatsToBarBeat(project, mapper.secondsToBeats(seconds));
    return `Bar ${bar} · ${formatSeconds(seconds)}`;
  }, [start, span, hoverX, mapper, project, width]);

  // ---- Markers ----
  const markers = useMemo(() => {
    let lastLabelled = -Infinity;
    return [...project.markers]
      .filter((marker) => marker.seconds >= start && marker.seconds <= end)
      .sort((a, b) => a.seconds - b.seconds)
      .map((marker) => {
        const x = fractionOf(marker.seconds) * width;
        const labelled = x - lastLabelled >= MARKER_LABEL_GAP;
        if (labelled) lastLabelled = x;
        return { ...marker, x, labelled };
      });
  }, [start, end, span, project.markers, width]);

  return (
    <div className={`seekbar${markers.length ? ' has-markers' : ''}`}>
      <button
        className="seekbar-play"
        onClick={onPlayPause}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="seekbar-time" ref={timeRef}>
        {formatSeconds(playback.position)}
      </span>

      <div className="seekbar-body">
        {markers.length > 0 && (
          <div className="seekbar-markers">
            {markers.map((marker, index) => (
              <button
                key={`${marker.ticks}-${index}`}
                className={`seekbar-marker${marker.labelled ? '' : ' tick-only'}`}
                style={{ left: marker.x }}
                title={`${marker.text} · ${formatSeconds(marker.seconds)}`}
                onClick={() => onSeek(marker.seconds)}
              >
                {marker.labelled ? marker.text : ''}
              </button>
            ))}
          </div>
        )}

        <div
          className={`seekbar-track${scrubbing ? ' scrubbing' : ''}`}
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Song position"
          aria-valuemin={Number(start.toFixed(1))}
          aria-valuemax={Number(end.toFixed(1))}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHoverX(null)}
          onKeyDown={handleKeyDown}
        >
          <canvas ref={canvasRef} className="seekbar-map" />
          <div className="seekbar-unplayed" ref={unplayedRef} />
          {markers.map((marker, index) => (
            <div key={`line-${marker.ticks}-${index}`} className="seekbar-marker-line" style={{ left: marker.x }} />
          ))}
          {hoverX !== null && <div className="seekbar-hover" style={{ left: hoverX }} />}
          <div className="seekbar-handle" ref={handleRef} />
        </div>

        {hoverLabel && hoverX !== null && (
          <div className="seekbar-tooltip" style={{ left: clamp(hoverX, 48, Math.max(width - 48, 48)) }}>
            {hoverLabel}
          </div>
        )}
      </div>

      <span className="seekbar-time total">{formatSeconds(end)}</span>
    </div>
  );
});
