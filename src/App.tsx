import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrangementCanvas, type ViewState } from './components/ArrangementCanvas';
import { SeekBar } from './components/SeekBar';
import { audibleExtent, sessionTimeline, type AudibleExtent } from './playback/Timeline';
import { applyTrackNaming, type TrackNaming } from './midi/TrackNaming';
import { followScroll } from './layout/Follow';
import { ColorPanel, autoTrackColors } from './components/ColorPanel';
import { ExportPanel } from './components/ExportPanel';
import { FileDropZone } from './components/FileDropZone';
import { InfoBar } from './components/InfoBar';
import { FilterPanel } from './components/FilterPanel';
import { NoteInspector } from './components/NoteInspector';
import { Toolbar } from './components/Toolbar';
import { TrackPanel } from './components/TrackPanel';
import { VisualPanel } from './components/VisualPanel';
import { downloadBlob, renderPng, sanitizeFileName } from './export/ImageExporter';
import { renderSvg } from './export/SvgExporter';
import { exportFrameSequence, recordWebm } from './export/VideoExporter';
import { evenDimensions, recordMp4 } from './export/Mp4Exporter';
import { findHook, SHORTS_SIZE } from './export/ShortsHook';
import { calculateLayout } from './layout/LayoutEngine';
import type { LayoutResult, Viewport } from './layout/LayoutEngine';
import { domainForTimelineMode, projectDuration } from './layout/LayoutEngine';
import { analyzeProject } from './midi/MidiAnalyzer';
import { MidiParseError, parseMidi } from './midi/MidiParser';
import { TimeMapper } from './midi/TimeMapper';
import type { ColorTheme } from './models/ColorTheme';
import type { InstrumentFamily, MidiProject, TrackState } from './models/MidiProject';
import { defaultTrackState } from './models/MidiProject';
import { instrumentPaletteById, themePresetById } from './models/Palettes';
import { DEFAULT_LOOK_ID, applyLook, lookPresetById, presetBarsOnScreen } from './models/LookPresets';
import {
  deriveInstrumentPalette,
  deriveTheme,
  seedFromTheme,
  type ColorSeed,
} from './models/ThemeBuilder';
import { applyTempoScale, baseTempo } from './midi/TempoScaler';
import {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_SETTINGS,
  type ExportSettings,
  type RenderSettings,
} from './models/RenderSettings';
import { PlaybackController } from './playback/PlaybackController';
import { PreviewSynth } from './playback/PreviewSynth';
import { AudioEngine } from './playback/AudioEngine';
import { analyzeAudio } from './audio/AudioAnalyzer';
import { solveSync, syncNotesFromProject } from './audio/SyncSolver';
import { AudioPanel, type AudioState, type SyncReport } from './components/AudioPanel';
import type { NoteRect } from './renderer/NoteRenderer';
import { ThumbnailPanel, type ThumbnailExportSize } from './components/ThumbnailPanel';
import { DEFAULT_TOOL_SETTINGS, ThumbnailEditorStage, type ToolSettings } from './components/ThumbnailEditor';
import { composeIntroLayers, composeThumbnail, createComposeCache, hitLayer, type IntroLayers } from './thumbnail/Compose';
import { composeIntroScene, type IntroScene } from './thumbnail/IntroScene';
import { ensureFont, fontReady } from './thumbnail/Fonts';
import { EMPTY_EDITS, syncElements, type Box, type ThumbEdits, type ThumbElement } from './thumbnail/Editor';
import { analyzeAudioMood } from './thumbnail/AudioMood';
import { analyzeSongMood, type AudioMood } from './thumbnail/SongMood';
import {
  DEFAULT_THUMBNAIL_OPTIONS,
  designThumbnail,
  extractMaterial,
  type ThumbnailOptions,
} from './thumbnail/ThumbnailDesign';
import { describeRecipe } from './thumbnail/Recipe';
import { encodeForYouTube, encodePng } from './thumbnail/ThumbnailRenderer';
import { formatCount, formatSeconds } from './utils/formatting';
import { clamp } from './utils/math';
import { SongTabs } from './components/SongTabs';
import { musicEnd } from './renderer/CardRenderer';
import {
  deleteSong,
  loadMeta,
  loadSong,
  newSongId,
  saveMeta,
  saveSong,
  type SongSnapshot,
} from './session/SongStore';

type Tab = 'tracks' | 'visual' | 'colour' | 'audio' | 'thumb' | 'export';

/** The preview renders at YouTube's own size, with a lighter texture field. */
const THUMB_PREVIEW = { width: 1280, height: 720, fieldHeight: 450 };

interface BusyState {
  label: string;
  progress: number;
}

export default function App() {
  const [baseProject, setBaseProject] = useState<MidiProject | null>(null);
  const [fileName, setFileName] = useState('arrangement');
  const [trackStates, setTrackStates] = useState<Map<string, TrackState>>(new Map());
  const [settings, setSettings] = useState<RenderSettings>(() =>
    applyLook(structuredClone(DEFAULT_SETTINGS), DEFAULT_LOOK_ID),
  );
  const [exportSettings, setExportSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT_SETTINGS });
  const [view, setView] = useState<ViewState>({ pxPerUnit: 12, scrollUnits: 0, scrollY: 0 });
  const [selection, setSelection] = useState<NoteRect | null>(null);
  const [tab, setTab] = useState<Tab>('tracks');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [synthEnabled, setSynthEnabled] = useState(false);
  const [volume, setVolume] = useState(0.35);

  const [tempoScale, setTempoScale] = useState(1);
  const [trackNaming, setTrackNaming] = useState<TrackNaming>('instrument');

  // ---- Audio track (the user's own mixdown) ----
  const [audioState, setAudioState] = useState<AudioState>({
    name: null,
    duration: 0,
    analysis: null,
    report: null,
    analyzing: null,
    error: null,
  });
  const [trackAudioEnabled, setTrackAudioEnabled] = useState(true);
  const [audioOffset, setAudioOffset] = useState(0);
  /** Where sound is in the loaded recording, so its intro and tail are never cut. */
  const [audioExtent, setAudioExtent] = useState<AudibleExtent | null>(null);
  const [audioVolume, setAudioVolume] = useState(0.9);

  // ---- Thumbnail ----
  const [thumbOptions, setThumbOptions] = useState<ThumbnailOptions>({ ...DEFAULT_THUMBNAIL_OPTIONS });
  const [audioMood, setAudioMood] = useState<AudioMood | null>(null);
  const [analyzingAudioMood, setAnalyzingAudioMood] = useState(false);
  const [thumbVersion, setThumbVersion] = useState(0);
  const thumbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** A small unfiltered copy of the thumbnail, for the filter previews. */
  const thumbSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  /** Rendered parts, title and paint layers, so editing only re-composites. */
  const thumbCacheRef = useRef(createComposeCache());
  // Hand edits to the thumbnail: layers, paint and stamps, with undo history.
  const [thumbEdits, setThumbEdits] = useState<ThumbEdits>(EMPTY_EDITS);
  const thumbCommittedRef = useRef<ThumbEdits>(EMPTY_EDITS);
  const thumbPastRef = useRef<ThumbEdits[]>([]);
  const thumbFutureRef = useRef<ThumbEdits[]>([]);
  const [thumbHistory, setThumbHistory] = useState({ undo: 0, redo: 0 });
  const [thumbSelected, setThumbSelected] = useState<string | null>(null);
  const [thumbTools, setThumbTools] = useState<ToolSettings>(DEFAULT_TOOL_SETTINGS);
  const [thumbDraft, setThumbDraft] = useState(false);
  const [thumbBoxes, setThumbBoxes] = useState<Map<string, Box>>(new Map());
  /** Bumped when a title font finishes loading, to redraw the title in it. */
  const [thumbFontTick, setThumbFontTick] = useState(0);

  // ---- Open songs (tabs along the top), saved in the browser ----
  const [songs, setSongs] = useState<Array<{ id: string; name: string }>>([]);
  const [activeSong, setActiveSong] = useState<string | null>(null);
  /** The active song's MIDI file, kept so it can be saved and reopened. */
  const midiBytesRef = useRef<ArrayBuffer | null>(null);
  /** The active song's recording, kept for the same reason. */
  const audioFileRef = useRef<{ file: Blob; name: string } | null>(null);
  /** Per-track stems: which tracks have one (state, for the UI) and their files (for saving). */
  const [stems, setStems] = useState<Array<{ trackId: string; name: string }>>([]);
  const stemFilesRef = useRef(new Map<string, Blob>());
  /** Last known state of every open song, so switching tabs is instant. */
  const snapshotsRef = useRef(new Map<string, SongSnapshot>());
  /** Reads the active song's current state; refreshed every render. */
  const captureRef = useRef<() => SongSnapshot | null>(() => null);
  /** True once saved songs have been restored, so the first save does not overwrite them. */
  const [storeReady, setStoreReady] = useState(false);

  const playbackRef = useRef(new PlaybackController());
  const synthRef = useRef<PreviewSynth | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const layoutRef = useRef<LayoutResult | null>(null);
  /** Content width the current zoom was last set or kept against. */
  const zoomWidthRef = useRef(0);
  const pendingFitRef = useRef(false);
  /**
   * Bars to fit across the frame once a layout exists: a number, null for the
   * whole song, or 'look' to use whatever the active look calls for.
   */
  const pendingBarsRef = useRef<number | null | 'look'>('look');
  /** The active look, readable from callbacks that should not re-subscribe on every settings change. */
  const lookIdRef = useRef<string>(DEFAULT_LOOK_ID);
  lookIdRef.current = settings.lookId;
  const abortRef = useRef<AbortController | null>(null);

  if (!synthRef.current) synthRef.current = new PreviewSynth();
  if (!audioRef.current) audioRef.current = new AudioEngine();

  /** True when the loaded recording is the timebase. */
  const audioDriving = Boolean(audioState.name) && trackAudioEnabled;

  // The tempo edit re-derives every seconds value from the unchanged beat grid,
  // so the picture is identical and only the timing moves.
  const project = useMemo(
    () => (baseProject ? applyTrackNaming(applyTempoScale(baseProject, tempoScale), trackNaming) : null),
    [baseProject, tempoScale, trackNaming],
  );

  /** The recording placed on the visual clock, when one is loaded. */
  const audioPlacement = useMemo(
    () => (audioExtent && audioState.name ? { ...audioExtent, offset: audioOffset } : null),
    [audioExtent, audioOffset, audioState.name],
  );

  /**
   * What the session plays and exports: the MIDI, widened to the recording's
   * intro and tail. Ending at the last note would cut a reverb off mid-ring.
   */
  const outro = settings.outroCard ? Math.max(0, settings.outroSeconds ?? 5) : 0;
  const timeline = useMemo(() => {
    const base = sessionTimeline(project?.durationSeconds ?? 0, audioPlacement);
    // The end card runs on past the last note.
    return project && outro > 0 ? { ...base, end: Math.max(base.end, musicEnd(project) + outro) } : base;
  }, [audioPlacement, project, outro]);
  /** Where playback stops: the last note, or the end of the end card. */
  const playEnd = project ? (outro > 0 ? Math.max(project.durationSeconds, musicEnd(project) + outro) : project.durationSeconds) : 0;

  const mapper = useMemo(
    () =>
      project
        ? new TimeMapper(project.ppq, project.tempos, project.timeSignatures)
        : new TimeMapper(480, [], []),
    [project],
  );

  /** Length from zero to the session's end in a layout's domain, for "fit the whole song". */
  const sessionSpan = useCallback(
    (layout: LayoutResult) => {
      if (!project) return 1;
      const end = 0;
      return Math.max(projectDuration(project, layout.domain), end, 1e-6);
    },
    [mapper, project, timeline.end],
  );

  const stats = useMemo(() => (project ? analyzeProject(project) : null), [project]);

  /** Tone, colour and energy of the song, read from the MIDI and any loaded recording. */
  const songMood = useMemo(
    () => (project ? analyzeSongMood(project, fileName, audioMood) : null),
    [audioMood, fileName, project],
  );
  const material = useMemo(() => (project ? extractMaterial(project) : null), [project]);
  const thumbDesign = useMemo(
    () =>
      songMood && material
        ? designThumbnail(songMood, material, {
            ...thumbOptions,
            colour: { ...thumbOptions.colour, defaultMain: settings.accentColor },
          })
        : null,
    [material, songMood, thumbOptions, settings.accentColor],
  );

  /** Instrument families in the loaded file — the derived gradient spans these. */
  const presentFamilies = useMemo(
    () => (project ? new Set(project.tracks.map((track) => track.family)) : undefined),
    [project],
  );

  // ---- Playback readout (throttled; the canvas reads the controller directly) ----
  useEffect(() => {
    const playback = playbackRef.current;
    let raf = 0;
    let last = 0;
    const poll = (timestamp: number) => {
      raf = requestAnimationFrame(poll);
      if (timestamp - last < 90) return;
      last = timestamp;
      setPosition(playback.position);
      setPlaying(playback.playing);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- File loading ----
  /**
   * Makes a MIDI file the active song: parses it and sets every control, either
   * fresh (a newly opened file) or from a saved snapshot (switching tabs, or
   * reopening the app).
   */
  const openMidi = useCallback(
    async (buffer: ArrayBuffer, name: string, id: string, restore: SongSnapshot | null) => {
      setError(null);
      setBusy({ label: restore ? `Opening ${restore.fileName}…` : 'Analyzing MIDI…', progress: 0 });
      // Yield once so the busy state paints before the parse blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 16));

      try {
        const parsed = parseMidi(buffer.slice(0), name);

        if (!parsed.tracks.length) {
          throw new MidiParseError('That file parsed correctly but contains no notes on any track.');
        }

        const saved = new Map(restore?.trackStates ?? []);
        const states = new Map<string, TrackState>();
        for (const track of parsed.tracks) states.set(track.id, { ...defaultTrackState(), ...(saved.get(track.id) ?? {}) });

        playbackRef.current.stop();
        playbackRef.current.duration = parsed.durationSeconds;
        playbackRef.current.loopEnd = parsed.durationSeconds;

        // The previous song's recording goes with it.
        audioRef.current?.unload();
        setAudioExtent(null);
        setAudioState({ name: null, duration: 0, analysis: null, report: null, analyzing: null, error: null });
        audioFileRef.current = restore?.audio ? { file: restore.audio.file, name: restore.audio.name } : null;
        stemFilesRef.current = new Map();
        setStems([]);

        if (restore) {
          setTempoScale(restore.tempoScale ?? 1);
          setTrackNaming(restore.trackNaming ?? 'instrument');
          setSettings({ ...structuredClone(DEFAULT_SETTINGS), ...restore.settings });
          setExportSettings({ ...DEFAULT_EXPORT_SETTINGS, ...restore.exportSettings });
          setThumbOptions({
            ...DEFAULT_THUMBNAIL_OPTIONS,
            ...restore.thumbOptions,
            colour: { ...DEFAULT_THUMBNAIL_OPTIONS.colour, ...restore.thumbOptions?.colour },
          });
          if (restore.audio) {
            setAudioOffset(restore.audio.offset);
            setAudioVolume(restore.audio.volume);
            setTrackAudioEnabled(restore.audio.enabled);
          }
        } else {
          setTempoScale(1);
          // A new song designs its own thumbnail. Layout choices and exact colours
          // belonged to the old one; the colour adjustments and text settings carry over.
          setThumbOptions((previous) => ({
            ...previous,
            variation: 0,
            ground: 'auto',
            subject: 'auto',
            secondary: 'auto',
            details: null,
            title: null,
            colour: { ...previous.colour, main: null, accent: null },
          }));
          // Camera keyframes and the title belong to the song they were made for.
          setSettings((previous) => ({ ...previous, cameraKeys: [], titleText: '' }));
          setExportSettings((previous) => ({ ...previous, rangeStart: null, rangeEnd: null }));
          setAudioOffset(0);
        }

        const edits = restore?.thumbEdits ?? EMPTY_EDITS;
        setThumbEdits(edits);
        thumbCommittedRef.current = edits;
        thumbPastRef.current = [];
        thumbFutureRef.current = [];
        setThumbHistory({ undo: 0, redo: 0 });
        setThumbSelected(null);

        midiBytesRef.current = buffer;
        setBaseProject(parsed);
        setFileName(restore?.fileName ?? name.replace(/\.(mid|midi)$/i, ''));
        setTrackStates(states);
        setSelection(null);
        setActiveSong(id);
        setView({ pxPerUnit: 12, scrollUnits: 0, scrollY: 0 });
        // Open the file at the active look's zoom. Cinematic needs a few bars
        // across the frame, not the whole song, or there is nothing to scroll.
        pendingBarsRef.current = 'look';
        pendingFitRef.current = true;

        synthRef.current?.load(parsed);
        synthRef.current?.sync(0);

        // Bring the recording back, quietly (no jump to the Audio tab).
        if (restore?.audio && audioRef.current?.available) {
          const engine = audioRef.current;
          try {
            const loaded = await engine.load(new File([restore.audio.file], restore.audio.name));
            setAudioExtent(audibleExtent(loaded.buffer));
            engine.offset = restore.audio.offset;
            engine.setVolume(restore.audio.volume);
            setAudioState({ name: loaded.name, duration: loaded.buffer.duration, analysis: null, report: null, analyzing: null, error: null });
            // And the stems that went with it.
            const restored: Array<{ trackId: string; name: string }> = [];
            for (const stem of restore.stems ?? []) {
              if (!states.has(stem.trackId)) continue;
              try {
                await engine.loadStem(stem.trackId, new File([stem.file], stem.name));
                stemFilesRef.current.set(stem.trackId, stem.file);
                restored.push({ trackId: stem.trackId, name: stem.name });
              } catch {
                // A stem that no longer decodes is skipped.
              }
            }
            setStems(restored);
          } catch {
            audioFileRef.current = null;
          }
        }
        return true;
      } catch (caught) {
        const message =
          caught instanceof MidiParseError
            ? caught.message
            : caught instanceof Error
              ? `Could not load that file: ${caught.message}`
              : 'Could not load that file.';
        setError(message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /** Saves the active song where switching and reloading will find it. */
  const stashActive = useCallback(() => {
    const snapshot = captureRef.current();
    if (!snapshot) return;
    snapshotsRef.current.set(snapshot.id, snapshot);
    void saveSong(snapshot);
  }, []);

  /** Opens a file in a new tab (or switches to it, if that exact file is already open). */
  const loadFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      const name = file.name.replace(/\.(mid|midi)$/i, '');
      for (const [id, snapshot] of snapshotsRef.current) {
        if (snapshot.fileName === name && snapshot.midi.byteLength === buffer.byteLength && id !== activeSong) {
          stashActive();
          await openMidi(snapshot.midi, file.name, id, snapshot);
          return;
        }
      }
      stashActive();
      const id = newSongId();
      if (await openMidi(buffer, file.name, id, null)) {
        setSongs((previous) => [...previous, { id, name }]);
      }
    },
    [activeSong, openMidi, stashActive],
  );

  const switchSong = useCallback(
    async (id: string) => {
      if (id === activeSong || busy) return;
      stashActive();
      const snapshot = snapshotsRef.current.get(id) ?? (await loadSong(id));
      if (snapshot) await openMidi(snapshot.midi, snapshot.fileName, id, snapshot);
    },
    [activeSong, busy, openMidi, stashActive],
  );

  const closeSong = useCallback(
    async (id: string) => {
      if (busy) return;
      const name = songs.find((song) => song.id === id)?.name ?? 'this song';
      if (
        !window.confirm(
          `Close "${name}"?

Its saved look, tracks, camera keyframes, thumbnail and recording will be removed. This cannot be undone.`,
        )
      )
        return;
      const index = songs.findIndex((song) => song.id === id);
      const rest = songs.filter((song) => song.id !== id);
      snapshotsRef.current.delete(id);
      void deleteSong(id);
      setSongs(rest);
      if (id !== activeSong) return;
      const next = rest[Math.min(index, rest.length - 1)];
      if (next) {
        const snapshot = snapshotsRef.current.get(next.id) ?? (await loadSong(next.id));
        if (snapshot) {
          await openMidi(snapshot.midi, snapshot.fileName, next.id, snapshot);
          return;
        }
      }
      // Nothing left open.
      playbackRef.current.stop();
      audioRef.current?.unload();
      audioFileRef.current = null;
      midiBytesRef.current = null;
      setAudioExtent(null);
      setAudioState({ name: null, duration: 0, analysis: null, report: null, analyzing: null, error: null });
      setBaseProject(null);
      setActiveSong(null);
    },
    [activeSong, busy, openMidi, songs],
  );

  // ---- Viewport reporting from the canvas ----
  const handleViewportReady = useCallback(
    (viewport: Viewport, layout: LayoutResult) => {
      viewportRef.current = viewport;
      layoutRef.current = layout;
      const previousWidth = zoomWidthRef.current;
      zoomWidthRef.current = layout.contentWidth;

      // A zoom request needs a measured content width, which only exists once
      // the canvas has laid out at least one frame.
      if (pendingFitRef.current && project) {
        pendingFitRef.current = false;
        const pending = pendingBarsRef.current;
        pendingBarsRef.current = 'look';
        const bars =
          pending === 'look' ? presetBarsOnScreen(lookPresetById(lookIdRef.current), project) : pending;
        setView({
          pxPerUnit:
            bars === null
              ? layout.contentWidth / sessionSpan(layout)
              : pxPerUnitForBars(project, layout, bars),
          scrollUnits: 0,
          scrollY: 0,
        });
      } else if (previousWidth > 0 && Math.abs(layout.contentWidth - previousWidth) > 0.5) {
        // Zoom is a span of music, not a pixel density. When the frame gets
        // wider or narrower (window resize, sidebar toggle, a different export
        // shape) keep the same bars across it, so neither the preview nor the
        // export that copies its framing silently changes. Decided here, next
        // to the fit above, so the two are always applied in frame order.
        const ratio = layout.contentWidth / previousWidth;
        setView((previous) => ({ ...previous, pxPerUnit: previous.pxPerUnit * ratio }));
      }
    },
    [project, sessionSpan],
  );

  /**
   * Applies a whole look. The zoom half is deferred to the next layout, since
   * bars-on-screen only means something once the content width is known.
   */
  const applyLookPreset = useCallback(
    (id: string) => {
      setSettings((previous) => applyLook(previous, id));
      lookIdRef.current = id;
      const bars = presetBarsOnScreen(lookPresetById(id), project);
      const layout = layoutRef.current;
      if (layout && project) {
        setView((previous) => ({
          ...previous,
          pxPerUnit:
            bars === null
              ? layout.contentWidth / sessionSpan(layout)
              : pxPerUnitForBars(project, layout, bars),
        }));
      } else {
        pendingBarsRef.current = bars;
        pendingFitRef.current = true;
      }
    },
    [project, sessionSpan],
  );

  /** Bars currently spanning the frame, for the zoom slider. */
  const barsOnScreen = useMemo(() => {
    const layout = layoutRef.current;
    if (!layout || !project) return 8;
    const perBar = barSpanInDomain(project, layout);
    if (perBar <= 0) return 8;
    return layout.contentWidth / view.pxPerUnit / perBar;
  }, [project, view.pxPerUnit]);

  const setBarsOnScreen = useCallback(
    (bars: number) => {
      const layout = layoutRef.current;
      if (!layout || !project) return;
      setView((previous) => ({ ...previous, pxPerUnit: pxPerUnitForBars(project, layout, bars) }));
    },
    [project],
  );

  const fitView = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout || !project) return;
    setView({ pxPerUnit: layout.contentWidth / sessionSpan(layout), scrollUnits: 0, scrollY: 0 });
  }, [project, sessionSpan]);

  const zoomBy = useCallback(
    (factor: number) => {
      const layout = layoutRef.current;
      if (!layout || !project) return;
      const duration = Math.max(projectDuration(project, layout.domain), 1e-6);
      const floor = (layout.contentWidth / duration) * 0.9;
      setView((previous) => {
        const next = clamp(previous.pxPerUnit * factor, floor, 4000);
        // Zoom about the centre of the visible span.
        const centre = previous.scrollUnits + layout.contentWidth / previous.pxPerUnit / 2;
        return {
          ...previous,
          pxPerUnit: next,
          scrollUnits: clamp(centre - layout.contentWidth / next / 2, 0, duration),
        };
      });
    },
    [project],
  );

  // ---- Mutators ----
  const cameraTracks = useMemo(
    () => (project ? project.tracks.map((track) => ({ id: track.id, name: trackStates.get(track.id)?.label ?? track.name })) : []),
    [project, trackStates],
  );
  const getPlayhead = useCallback(() => playbackRef.current.position, []);
  /** A saved look replaces the look, but this song's title and camera keyframes stay. */
  const applySavedLook = useCallback((look: Partial<RenderSettings>) => {
    setSettings((previous) => ({
      ...previous,
      ...structuredClone(look),
      titleText: previous.titleText,
      cameraKeys: previous.cameraKeys,
      showAdvancedLook: previous.showAdvancedLook,
    }));
    if (look.lookId) lookIdRef.current = look.lookId;
    // Frame the song the way the look does.
    pendingBarsRef.current = 'look';
    pendingFitRef.current = true;
  }, []);

  const patchSettings = useCallback((patch: Partial<RenderSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const patchTheme = useCallback((patch: Partial<ColorTheme>) => {
    setSettings((previous) => ({ ...previous, theme: { ...previous.theme, ...patch } }));
  }, []);

  const patchTrackState = useCallback((trackId: string, patch: Partial<TrackState>) => {
    setTrackStates((previous) => {
      const next = new Map(previous);
      const current = next.get(trackId);
      if (!current) return previous;
      next.set(trackId, { ...current, ...patch });
      return next;
    });
  }, []);

  const setAllVisible = useCallback((visible: boolean) => {
    setTrackStates((previous) => {
      const next = new Map<string, TrackState>();
      for (const [id, state] of previous) next.set(id, { ...state, visible });
      return next;
    });
  }, []);

  const clearSolo = useCallback(() => {
    setTrackStates((previous) => {
      const next = new Map<string, TrackState>();
      for (const [id, state] of previous) next.set(id, { ...state, solo: false });
      return next;
    });
  }, []);

  const applyThemePreset = useCallback((id: string) => {
    const preset = themePresetById(id);
    const seed = seedFromTheme(preset.theme);
    setSettings((previous) => ({
      ...previous,
      themeId: preset.id,
      theme: { ...preset.theme },
      instrumentPaletteId: preset.instrumentPaletteId,
      instrumentColors: { ...instrumentPaletteById(preset.instrumentPaletteId).colors },
      // Keep the seed aligned so switching to simple mode starts from this
      // preset rather than snapping back to whatever was there before.
      primaryColor: seed.primary,
      accentColor: seed.accent,
      backgroundColor: seed.background,
    }));
  }, []);

  /**
   * Simple mode: two colours in, a whole theme and instrument gradient out.
   * Marks the theme as custom so the preset grid does not claim a false match.
   */
  const applySeed = useCallback(
    (patch: Partial<ColorSeed> & { gradientSpread?: number }) => {
      setSettings((previous) => {
        const seed: ColorSeed = {
          primary: patch.primary ?? previous.primaryColor,
          accent: patch.accent ?? previous.accentColor,
          background: patch.background ?? previous.backgroundColor,
        };
        const spread = patch.gradientSpread ?? previous.gradientSpread;
        return {
          ...previous,
          primaryColor: seed.primary,
          accentColor: seed.accent,
          backgroundColor: seed.background,
          gradientSpread: spread,
          themeId: 'custom',
          theme: deriveTheme(seed),
          instrumentPaletteId: 'derived',
          instrumentColors: deriveInstrumentPalette(seed, spread, presentFamilies),
          // The spread only shows when notes take their instrument's colour, so
          // moving it switches a single-colour picture over to the gradient.
          noteColorMode:
            patch.gradientSpread !== undefined && previous.noteColorMode !== 'instrument' && previous.noteColorMode !== 'track'
              ? 'instrument'
              : previous.noteColorMode,
        };
      });
    },
    [presentFamilies],
  );

  const applyInstrumentPalette = useCallback(
    (id: string) => {
      setSettings((previous) => {
        // "derived" is not a real preset — regenerate it from the seed instead
        // of falling back to an unrelated palette.
        if (id === 'derived') {
          const seed: ColorSeed = {
            primary: previous.primaryColor,
            accent: previous.accentColor,
            background: previous.backgroundColor,
          };
          return {
            ...previous,
            instrumentPaletteId: 'derived',
            instrumentColors: deriveInstrumentPalette(seed, previous.gradientSpread, presentFamilies),
          };
        }
        const palette = instrumentPaletteById(id);
        return {
          ...previous,
          instrumentPaletteId: palette.id,
          instrumentColors: { ...palette.colors },
        };
      });
    },
    [presentFamilies],
  );

  const setInstrumentColor = useCallback((family: InstrumentFamily, color: string) => {
    setSettings((previous) => ({
      ...previous,
      instrumentColors: { ...previous.instrumentColors, [family]: color },
    }));
  }, []);

  const autoAssignTrackColors = useCallback(() => {
    if (!project) return;
    const colors = autoTrackColors(project.tracks.length);
    setTrackStates((previous) => {
      const next = new Map<string, TrackState>();
      project.tracks.forEach((track, index) => {
        const state = previous.get(track.id) ?? defaultTrackState();
        next.set(track.id, { ...state, color: colors[index] });
      });
      return next;
    });
    patchSettings({ noteColorMode: 'track' });
  }, [patchSettings, project]);

  const clearTrackColors = useCallback(() => {
    setTrackStates((previous) => {
      const next = new Map<string, TrackState>();
      for (const [id, state] of previous) next.set(id, { ...state, color: null });
      return next;
    });
  }, []);


  // ---- Audio preview ----
  const toggleAudio = useCallback(async () => {
    const synth = synthRef.current;
    if (!synth?.available) return;
    if (synthEnabled) {
      synth.stop();
      setSynthEnabled(false);
      return;
    }
    await synth.resume();
    synth.setVolume(volume);
    synth.sync(playbackRef.current.position);
    setSynthEnabled(true);
  }, [synthEnabled, volume]);

  // Keep the engine's settings current without rebuilding it.
  useEffect(() => {
    const engine = audioRef.current;
    if (!engine) return;
    engine.offset = audioOffset;
    engine.setVolume(audioVolume);
  }, [audioOffset, audioVolume]);

  /**
   * Hand the transport its timebase. While a recording is driving playback the
   * playhead reads the audio clock every frame, so the two cannot drift apart.
   */
  useEffect(() => {
    const playback = playbackRef.current;
    playback.clock = audioDriving ? () => audioRef.current?.visualPosition() ?? null : null;
    if (!audioDriving) audioRef.current?.pause();
    return () => {
      playback.clock = null;
    };
  }, [audioDriving]);

  /**
   * Follow transport events (play, pause, stop, seek) with the audio. The
   * controller only emits on those, never per frame, so this does not fire in
   * the render loop. A restart is skipped when the audio is already within
   * 50 ms of the requested position, which keeps a scrub from re-triggering
   * the source on every pointer move.
   */
  useEffect(() => {
    if (!audioDriving) return;
    const engine = audioRef.current;
    if (!engine) return;

    return playbackRef.current.subscribe((position, isPlaying) => {
      if (!isPlaying) {
        // Reaching the last note stops the playhead, not the music: leave the
        // recording playing so its reverb tail rings out. Stop, a seek or
        // pressing Play again still cut it off as usual.
        if (position >= playbackRef.current.duration - 1e-3) return;
        engine.pause();
        return;
      }
      const current = engine.visualPosition();
      if (current === null || Math.abs(current - position) > 0.05) engine.play(position);
    });
  }, [audioDriving]);

  const handlePlayPause = useCallback(() => {
    const playback = playbackRef.current;
    playback.toggle();
    if (synthEnabled) {
      if (playback.playing) synthRef.current?.sync(playback.position);
      else synthRef.current?.stop();
    }
    setPlaying(playback.playing);
  }, [synthEnabled]);

  /**
   * Jump to a point in the song from the play bar or keyboard. Keeps playing
   * if it was playing, and moves the view so the playhead lands where the
   * follow mode would have put it — never somewhere off screen.
   */
  const seekTo = useCallback(
    (seconds: number) => {
      const playback = playbackRef.current;
      playback.seek(seconds);
      if (synthEnabled) synthRef.current?.sync(playback.position);
      setPosition(playback.position);

      const layout = layoutRef.current;
      if (!project || !layout) return;
      const unit = layout.domain === 'beats' ? mapper.secondsToBeats(playback.position) : playback.position;
      const duration = sessionSpan(layout);
      setView((previous) => {
        const span = layout.contentWidth / Math.max(previous.pxPerUnit, 1e-6);
        const scrollUnits = followScroll({
          mode: settings.followMode,
          anchor: settings.followAnchor,
          unit,
          span,
          duration,
          scroll: previous.scrollUnits,
        });
        return scrollUnits === previous.scrollUnits ? previous : { ...previous, scrollUnits };
      });
    },
    [mapper, project, settings.followAnchor, settings.followMode, synthEnabled],
  );

  const handleStop = useCallback(() => {
    playbackRef.current.stop();
    synthRef.current?.stop();
    synthRef.current?.sync(playbackRef.current.position);
    setPlaying(false);
    setPosition(playbackRef.current.position);
  }, []);

  /**
   * Jump to the start without stopping: if it was playing it keeps playing from
   * bar 1, which is what you want when re-taking a recording.
   */
  const handleReturnToStart = useCallback(() => {
    const playback = playbackRef.current;
    playback.seek(playback.start);
    synthRef.current?.stop();
    synthRef.current?.sync(playback.position);
    setPosition(playback.position);
    setView((previous) => ({ ...previous, scrollUnits: 0 }));
  }, []);

  const handleTempoScale = useCallback(
    (next: number) => {
      // Hold the musical position steady across the change: convert the current
      // seconds to beats at the old tempo and back at the new one.
      const playback = playbackRef.current;
      const beats = mapper.secondsToBeats(playback.position);
      setTempoScale(next);
      if (baseProject) {
        const scaled = applyTempoScale(baseProject, next);
        const nextMapper = new TimeMapper(scaled.ppq, scaled.tempos, scaled.timeSignatures);
        const span = sessionTimeline(scaled.durationSeconds, audioPlacement);
        playback.start = span.start;
        playback.duration = scaled.durationSeconds;
        playback.loopStart = span.start;
        playback.loopEnd = scaled.durationSeconds;
        playback.seek(nextMapper.beatsToSeconds(beats));
        setPosition(playback.position);
        if (synthEnabled) synthRef.current?.load(scaled);
        synthRef.current?.sync(playback.position);
      }
    },
    [synthEnabled, baseProject, mapper, audioPlacement],
  );

  // ---- Audio track ----
  const loadAudioFile = useCallback(async (file: File) => {
    const engine = audioRef.current;
    if (!engine?.available) return;
    setAudioState((previous) => ({ ...previous, error: null }));
    try {
      await engine.resume();
      const loaded = await engine.load(file);
      audioFileRef.current = { file, name: loaded.name };
      setAudioExtent(audibleExtent(loaded.buffer));
      engine.offset = audioOffset;
      engine.setVolume(audioVolume);
      setAudioState({
        name: loaded.name,
        duration: loaded.buffer.duration,
        analysis: null,
        report: null,
        analyzing: null,
        error: null,
      });
      setTab('audio');
    } catch (caught) {
      setAudioState((previous) => ({
        ...previous,
        error: caught instanceof Error ? caught.message : 'Could not load that audio file.',
      }));
    }
  }, [audioOffset, audioVolume]);

  const unloadAudio = useCallback(() => {
    audioRef.current?.unload();
    audioFileRef.current = null;
    stemFilesRef.current = new Map();
    setStems([]);
    setAudioExtent(null);
    setAudioState({
      name: null,
      duration: 0,
      analysis: null,
      report: null,
      analyzing: null,
      error: null,
    });
  }, []);

  // ---- Stems ----
  const addStem = useCallback(async (trackId: string, file: File) => {
    const engine = audioRef.current;
    if (!engine) return;
    try {
      await engine.resume();
      await engine.loadStem(trackId, file);
      stemFilesRef.current.set(trackId, file);
      setStems((previous) => [...previous.filter((stem) => stem.trackId !== trackId), { trackId, name: file.name }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load that stem.');
    }
  }, []);

  const removeStem = useCallback((trackId: string) => {
    audioRef.current?.removeStem(trackId);
    stemFilesRef.current.delete(trackId);
    setStems((previous) => previous.filter((stem) => stem.trackId !== trackId));
  }, []);

  /**
   * Several stems at once, matched to tracks by name: "Bass.wav" goes to the
   * Bass track, "02 Grand Piano.aif" to Grand Piano. Returns the files that
   * matched nothing.
   */
  const matchStems = useCallback(
    async (files: File[]): Promise<string[]> => {
      if (!project) return files.map((file) => file.name);
      const words = (text: string) =>
        text
          .toLowerCase()
          .replace(/\.[a-z0-9]+$/, '')
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 1 && !/^\d+$/.test(word));
      const unmatched: string[] = [];
      const taken = new Set<string>();
      for (const file of files) {
        const fileWords = words(file.name);
        let best: { id: string; score: number } | null = null;
        for (const track of project.tracks) {
          if (taken.has(track.id)) continue;
          const name = trackStates.get(track.id)?.label ?? track.name;
          const trackWords = words(name);
          const score = trackWords.filter((word) => fileWords.includes(word)).length / Math.max(trackWords.length, 1);
          if (score > 0 && (!best || score > best.score)) best = { id: track.id, score };
        }
        if (best && best.score >= 0.5) {
          taken.add(best.id);
          await addStem(best.id, file);
        } else unmatched.push(file.name);
      }
      return unmatched;
    },
    [addStem, project, trackStates],
  );

  // Solo and mute reach the sound: stems follow the tracks exactly; without
  // stems a soloed part can be brought forward by focusing the recording on
  // its register (approximate: a finished mix cannot be taken apart).
  useEffect(() => {
    const engine = audioRef.current;
    if (!engine || !project) return;
    const withNotes = project.tracks.filter((track) => track.notes.length);
    const has = new Set(stems.map((stem) => stem.trackId));
    const anySolo = withNotes.some((track) => trackStates.get(track.id)?.solo);
    const audible = (id: string) => {
      const state = trackStates.get(id);
      return state ? (anySolo ? state.solo : !state.muted) : true;
    };
    const levels = new Map<string, number>();
    let mix = 1;
    let focus: { low: number; high: number } | null = null;
    if (withNotes.length && withNotes.every((track) => has.has(track.id))) {
      // Every track has its stem: the stems are the mix, and mute and solo are exact.
      mix = 0;
      for (const track of withNotes) levels.set(track.id, audible(track.id) ? 1 : 0);
    } else if (anySolo) {
      const soloed = withNotes.filter((track) => trackStates.get(track.id)?.solo);
      if (soloed.every((track) => has.has(track.id))) {
        mix = 0;
        for (const track of soloed) levels.set(track.id, 1);
      } else if (settings.soloFocus ?? true) {
        const pitched = soloed.filter((track) => !track.isPercussion);
        if (pitched.length === soloed.length && pitched.length) {
          const low = Math.min(...pitched.map((track) => track.minPitch));
          const high = Math.max(...pitched.map((track) => track.maxPitch));
          const hz = (pitch: number) => 440 * Math.pow(2, (pitch - 69) / 12);
          // From a little under the lowest note to the upper harmonics of the highest.
          focus = { low: Math.max(20, hz(low) * 0.7), high: Math.min(20000, hz(high) * 6) };
        }
      }
    }
    engine.setMix({ mix, stems: levels, focus });
  }, [project, stems, trackStates, settings.soloFocus]);

  const pickAudioFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void loadAudioFile(file);
    };
    input.click();
  }, [loadAudioFile]);

  /**
   * Routes a dropped file to the MIDI parser or the audio loader.
   *
   * The MIDI extension is checked first and the MIME sniff explicitly excludes
   * midi: browsers report `.mid` as `audio/midi`, so trusting the MIME type
   * alone would hand every MIDI file to the audio decoder.
   */
  const loadAnyFile = useCallback(
    async (file: File) => {
      const isMidi = /\.(mid|midi|rmi)$/i.test(file.name) || /midi/i.test(file.type);
      const isAudio =
        !isMidi &&
        (/\.(wav|wave|mp3|m4a|aac|ogg|oga|flac|opus|weba)$/i.test(file.name) ||
          file.type.startsWith('audio/'));

      if (isAudio) await loadAudioFile(file);
      else await loadFile(file);
    },
    [loadAudioFile, loadFile],
  );

  /**
   * Lines the arrangement up with the loaded recording.
   *
   * Every note start in the MIDI is matched against the attacks heard in the
   * audio across the whole song, which yields both the offset and the speed
   * (see SyncSolver). The speed is applied as a tempo change: a recording
   * rendered at another tempo than the file states, or slowed down or sped up
   * afterwards, then stays locked from the first bar to the last. When the
   * tempos already agree the solver returns exactly 1 and nothing is re-timed.
   *
   * If too little of the song can be matched (a sparse or very ambient piece),
   * it falls back to lining up the first note and leaves the tempo alone.
   */
  const handleAutoSync = useCallback(async () => {
    const engine = audioRef.current;
    const buffer = engine?.audio?.buffer;
    if (!buffer || !baseProject) return;

    setAudioState((previous) => ({ ...previous, analyzing: 0, error: null }));
    // Let the progress bar paint before the analysis occupies the thread.
    await new Promise((resolve) => setTimeout(resolve, 16));

    try {
      // Measured against the unscaled project, so the result is absolute.
      const fit = await solveSync(buffer, syncNotesFromProject(baseProject), (fraction) =>
        setAudioState((previous) => ({ ...previous, analyzing: fraction * 0.85 })),
      );
      const analysis = await analyzeAudio(buffer, (fraction) =>
        setAudioState((previous) => ({ ...previous, analyzing: 0.85 + fraction * 0.15 })),
      );
      const originalBpm = baseTempo(baseProject);

      let report: SyncReport;
      if (fit && fit.confidence >= 0.2) {
        if (Math.abs(fit.tempoScale - tempoScale) > 1e-9) handleTempoScale(fit.tempoScale);
        setAudioOffset(fit.offset);
        engine.offset = fit.offset;
        report = {
          method: 'notes',
          offset: fit.offset,
          tempoScale: fit.tempoScale,
          originalBpm,
          checkpoints: fit.checkpoints,
          totalCheckpoints: fit.totalCheckpoints,
          residualMs: fit.residualMs,
          confidence: fit.confidence,
        };
      } else {
        const firstNote = baseProject.tracks.reduce(
          (earliest, track) => (track.notes.length ? Math.min(earliest, track.notes[0].startSeconds) : earliest),
          Infinity,
        );
        const midiStart = Number.isFinite(firstNote) ? firstNote : 0;
        const offset = analysis.firstOnset - midiStart / tempoScale;
        setAudioOffset(offset);
        engine.offset = offset;
        report = {
          method: 'onset',
          offset,
          tempoScale,
          originalBpm,
          confidence: fit?.confidence ?? 0,
        };
      }

      setAudioState((previous) => ({ ...previous, analysis, report, analyzing: null }));
    } catch (caught) {
      setAudioState((previous) => ({
        ...previous,
        analyzing: null,
        error: caught instanceof Error ? caught.message : 'Analysis failed.',
      }));
    }
  }, [baseProject, handleTempoScale, tempoScale]);

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        // Typing fields keep every key. A checkbox, slider or colour swatch you
        // just clicked keeps its own keys (arrows move a slider) but not Space,
        // which still plays and pauses rather than flipping the last toggle.
        const input = target.tagName === 'INPUT' ? (target as HTMLInputElement).type : null;
        const typing =
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          (input !== null && !['checkbox', 'radio', 'range', 'color', 'button'].includes(input));
        if (typing) return;
        if (input !== null && event.code !== 'Space') return;
      }
      // Leave browser and system shortcuts (Ctrl+F, Ctrl+Enter, Alt+Arrow…) alone.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Enter and Shift+B both return to the top of the arrangement.
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        handleReturnToStart();
      } else if (event.code === 'KeyB' && event.shiftKey) {
        event.preventDefault();
        handleReturnToStart();
      } else if (event.code === 'Space') {
        event.preventDefault();
        handlePlayPause();
      } else if (event.key === 'f' || event.key === 'F') {
        fitView();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 2;
        seekTo(playbackRef.current.position + (event.key === 'ArrowRight' ? step : -step));
      } else if (event.key === '?') {
        event.preventDefault();
        setInfoOpen((open) => !open);
      } else if (event.key === 'Escape') {
        setSelection(null);
        setInfoOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitView, handlePlayPause, handleReturnToStart, seekTo]);

  // ---- Thumbnail intro ----
  const wantsThumbIntro = settings.introCard && (settings.introStyle === 'thumbnail' || settings.introStyle === 'both');
  const introThumbRef = useRef<IntroLayers | null>(null);
  const introSceneRef = useRef<IntroScene | null>(null);
  const wantsFlyThrough = wantsThumbIntro && (settings.introMotion ?? 'dissolve') === 'rush';
  // The intro is drawn at the video's own size (up to 4K), so it is as sharp in the preview as in the export.
  const introScale = Math.min(1, 3840 / Math.max(exportSettings.width, 1), 2160 / Math.max(exportSettings.height, 1));
  const introWidth = Math.round(exportSettings.width * introScale);
  const introHeight = Math.round(exportSettings.height * introScale);
  const introCacheRef = useRef(createComposeCache());
  const [introThumbVersion, setIntroThumbVersion] = useState(0);
  useEffect(() => {
    if (!wantsThumbIntro || !thumbDesign) return;
    const handle = window.setTimeout(() => {
      void ensureFont(thumbDesign.font).then(() => {
        introThumbRef.current = composeIntroLayers(thumbDesign, thumbEdits, introWidth, introHeight, introCacheRef.current);
        introSceneRef.current = wantsFlyThrough ? composeIntroScene(thumbDesign, thumbEdits, introWidth, introHeight) : null;
        setIntroThumbVersion((version) => version + 1);
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [wantsThumbIntro, wantsFlyThrough, thumbDesign, thumbEdits, introWidth, introHeight]);
  const introSource = useMemo(
    () => {
      const layers = wantsThumbIntro ? introThumbRef.current : null;
      return {
        start: Math.min(0, timeline.start),
        image: layers?.base ?? null,
        title: layers?.title ?? null,
        titleDepth: layers?.titleDepth ?? null,
        titleCenter: layers?.titleCenter ?? null,
        titlePath: layers?.titlePath ?? null,
        pieces: layers?.pieces,
        scene3d: wantsFlyThrough ? introSceneRef.current : null,
      };
    },
    // introThumbVersion marks a new picture in the same canvas.
    [timeline.start, wantsThumbIntro, wantsFlyThrough, introThumbVersion],
  );
  /** The thumbnail at the export's own size, so a 4K video gets a sharp 4K intro. */
  const introForExport = () => {
    if (!wantsThumbIntro || !thumbDesign) return { start: introSource.start, image: null };
    const layers = composeIntroLayers(thumbDesign, thumbEdits, exportSettings.width, exportSettings.height);
    return {
      start: introSource.start,
      image: layers.base,
      title: layers.title,
      titleDepth: layers.titleDepth,
      titleCenter: layers.titleCenter,
      titlePath: layers.titlePath,
      pieces: layers.pieces,
      scene3d: wantsFlyThrough ? composeIntroScene(thumbDesign, thumbEdits, exportSettings.width, exportSettings.height) : null,
    };
  };

  // ---- Export ----
  const exportBase = useCallback(() => {
    if (!project) return null;
    return {
      project,
      settings,
      trackStates,
      width: exportSettings.width,
      height: exportSettings.height,
      fitWholeArrangement: exportSettings.fitWholeArrangement,
      sourceViewport: viewportRef.current ?? undefined,
      mapper,
      intro: introForExport(),
    };
  }, [exportSettings, mapper, project, settings, timeline.end, trackStates, introSource, thumbDesign, thumbEdits]);

  const runExport = useCallback(
    async (label: string, task: (signal: AbortSignal, report: (fraction: number, text: string) => void) => Promise<void>) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy({ label, progress: 0 });
      setError(null);
      try {
        await task(controller.signal, (fraction, text) => setBusy({ label: text, progress: fraction }));
      } catch (caught) {
        if ((caught as Error)?.name !== 'AbortError') {
          setError(caught instanceof Error ? caught.message : 'Export failed.');
        }
      } finally {
        abortRef.current = null;
        setBusy(null);
      }
    },
    [],
  );

  const handleExportPng = useCallback(() => {
    const base = exportBase();
    if (!base) return;
    void runExport('Rendering PNG…', async () => {
      const blob = await renderPng({
        ...base,
        playheadSeconds: playbackRef.current.position,
        opaqueBackground: exportSettings.opaqueBackground,
        fileName: fileName,
      });
      downloadBlob(blob, `${sanitizeFileName(fileName)}_${base.width}x${base.height}.png`);
    });
  }, [exportBase, exportSettings.opaqueBackground, fileName, runExport]);

  const handleExportSvg = useCallback(() => {
    const base = exportBase();
    if (!base) return;
    void runExport('Building SVG…', async () => {
      const svg = renderSvg({
        ...base,
        playheadSeconds: playbackRef.current.position,
        opaqueBackground: exportSettings.opaqueBackground,
      });
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${sanitizeFileName(fileName)}.svg`);
    });
  }, [exportBase, exportSettings.opaqueBackground, fileName, runExport]);

  const videoRange = useCallback(() => {
    if (!project) return { start: 0, end: 0 };
    // Defaults to the whole session, recording intro and tail included.
    const start = clamp(exportSettings.rangeStart ?? timeline.start, timeline.start, timeline.end);
    const end = clamp(exportSettings.rangeEnd ?? timeline.end, start + 0.2, Math.max(timeline.end, start + 0.2));
    return { start, end };
  }, [exportSettings.rangeEnd, exportSettings.rangeStart, project, timeline]);

  const handleExportVideo = useCallback(() => {
    const base = exportBase();
    if (!base) return;
    const { start, end } = videoRange();
    void runExport('Recording…', async (signal, report) => {
      const blob = await recordWebm({
        ...base,
        fps: exportSettings.fps,
        bitrateMbps: exportSettings.bitrateMbps,
        startSeconds: start,
        endSeconds: end,
        followAnchor: base.settings.followAnchor,
        onProgress: report,
        signal,
      });
      downloadBlob(blob, `${sanitizeFileName(fileName)}_${base.width}x${base.height}.webm`);
    });
  }, [exportBase, exportSettings.bitrateMbps, exportSettings.fps, fileName, runExport, videoRange]);

  const handleExportMp4 = useCallback(() => {
    const base = exportBase();
    if (!base) return;
    const { start, end } = videoRange();
    void runExport('Encoding MP4…', async (signal, report) => {
      // The audio as you hear it: stems and solo (and the solo focus) included.
      // (An engine made before a live code update may lack renderMix: fall back to the plain recording.)
      const engine = audioRef.current;
      const buffer = !exportSettings.includeAudio || !engine
        ? null
        : typeof engine.renderMix === 'function'
          ? await engine.renderMix()
          : (engine.audio?.buffer ?? null);
      const blob = await recordMp4({
        ...base,
        fps: exportSettings.fps,
        bitrateMbps: exportSettings.bitrateMbps,
        startSeconds: start,
        endSeconds: end,
        followAnchor: base.settings.followAnchor,
        // Lay the loaded recording under the video at the alignment you set,
        // so the export needs no second pass in an editor.
        audio: buffer && exportSettings.includeAudio ? { buffer, offset: audioOffset } : null,
        onProgress: report,
        signal,
      });
      const { width, height } = evenDimensions(base.width, base.height);
      downloadBlob(blob, `${sanitizeFileName(fileName)}_${width}x${height}.mp4`);
    });
  }, [
    audioOffset,
    exportBase,
    exportSettings.bitrateMbps,
    exportSettings.fps,
    exportSettings.includeAudio,
    fileName,
    runExport,
    videoRange,
  ]);

  // The Short: its length, and where it starts (your choice, or the strongest moment).
  const shortsSeconds = exportSettings.shortsSeconds ?? 30;
  const autoHook = useMemo(
    () => (project ? findHook(project, shortsSeconds, trackStates) : 0),
    [project, shortsSeconds, trackStates],
  );
  const shortsStart = project
    ? clamp(exportSettings.shortsStart ?? autoHook, 0, Math.max(0, project.durationSeconds - 1))
    : 0;

  const handlePreviewShort = useCallback(() => {
    seekTo(shortsStart);
    if (!playing) handlePlayPause();
  }, [handlePlayPause, playing, seekTo, shortsStart]);

  const handleExportShort = useCallback(() => {
    if (!project) return;
    const { width, height } = SHORTS_SIZE;
    const start = shortsStart;
    const end = Math.min(start + shortsSeconds, Math.max(timeline.end, start + 1));
    const caption = (exportSettings.shortsCaption ?? '').trim() || (settings.titleText || project.title || '').trim();
    // Follow the playhead, with no cards: the Short opens straight on the music and loops cleanly.
    const shortSettings = {
      ...settings,
      introCard: false,
      outroCard: false,
      followMode: 'continuous' as const,
      followAnchor: 0.4,
      shortsCaption: caption,
      shortsStart: start,
    };
    // About eight seconds across the narrow frame, so the notes have room.
    const probe = { width, height, pixelRatio: 1, pxPerUnit: 1, scrollUnits: 0, scrollY: 0 };
    const layout = calculateLayout({ project, settings: shortSettings, trackStates, viewport: probe });
    const spanUnits = layout.domain === 'beats' ? mapper.secondsToBeats(start + 8) - mapper.secondsToBeats(start) : 8;
    const sourceViewport = { ...probe, pxPerUnit: layout.contentWidth / Math.max(spanUnits, 1e-3) };
    void runExport('Encoding Short…', async (signal, report) => {
      const engine = audioRef.current;
      const buffer = !engine
        ? null
        : typeof engine.renderMix === 'function'
          ? await engine.renderMix()
          : (engine.audio?.buffer ?? null);
      const blob = await recordMp4({
        project,
        settings: shortSettings,
        trackStates,
        width,
        height,
        fitWholeArrangement: false,
        sourceViewport,
        mapper,
        fps: exportSettings.fps,
        bitrateMbps: Math.max(12, Math.min(exportSettings.bitrateMbps, 30)),
        startSeconds: start,
        endSeconds: end,
        followAnchor: 0.4,
        audio: buffer ? { buffer, offset: audioOffset } : null,
        onProgress: report,
        signal,
      });
      downloadBlob(blob, `${sanitizeFileName(fileName)}_short.mp4`);
    });
  }, [audioOffset, exportSettings, fileName, mapper, project, runExport, settings, shortsSeconds, shortsStart, timeline.end, trackStates]);

  const handleExportFrames = useCallback(() => {
    const base = exportBase();
    if (!base) return;
    const { start, end } = videoRange();
    void runExport('Rendering frames…', async (signal, report) => {
      const picker = (
        window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker;
      if (!picker) throw new Error('Folder access is not available in this browser.');
      const directory = await picker();
      const stem = sanitizeFileName(fileName).replace(/\s+/g, '_');
      const count = await exportFrameSequence({
        ...base,
        fps: exportSettings.fps,
        bitrateMbps: exportSettings.bitrateMbps,
        startSeconds: start,
        endSeconds: end,
        followAnchor: base.settings.followAnchor,
        directory,
        fileStem: stem,
        onProgress: report,
        signal,
      });
      setError(
        `Wrote ${formatCount(count)} PNG frames. Run the ffmpeg command from the Export tab in that folder to build an MP4.`,
      );
    });
  }, [exportBase, exportSettings.bitrateMbps, exportSettings.fps, fileName, runExport, videoRange]);

  // ---- Thumbnail ----

  /** Measure the recording's loudness, brightness and punch once per file. */
  useEffect(() => {
    const buffer = audioRef.current?.audio?.buffer;
    if (!audioState.name || !buffer) {
      setAudioMood(null);
      return;
    }
    let cancelled = false;
    setAnalyzingAudioMood(true);
    analyzeAudioMood(buffer)
      .then((mood) => {
        if (!cancelled) setAudioMood(mood);
      })
      .catch(() => {
        if (!cancelled) setAudioMood(null);
      })
      .finally(() => {
        if (!cancelled) setAnalyzingAudioMood(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audioState.name]);

  /**
   * Render the preview while the Thumb tab is open. The artwork is cached by
   * what it depends on, so editing the title only redraws the text.
   */
  useEffect(() => {
    const thumbTab = tab === 'thumb';
    if (!thumbTab || !thumbDesign) return;
    const handle = window.setTimeout(
      () => {
        if (!fontReady(thumbDesign.font)) void ensureFont(thumbDesign.font).then(() => setThumbFontTick((tick) => tick + 1));
        const preview = thumbCanvasRef.current ?? document.createElement('canvas');
        thumbCanvasRef.current = preview;
        // The finished layers are cached, so a drag only re-stacks them.
        let snapshot: HTMLCanvasElement | undefined;
        if (!thumbDraft) {
          snapshot = thumbSnapshotRef.current ?? document.createElement('canvas');
          snapshot.width = 256;
          snapshot.height = 144;
          thumbSnapshotRef.current = snapshot;
        }
        const result = composeThumbnail(preview, thumbDesign, thumbEdits, THUMB_PREVIEW.width, THUMB_PREVIEW.height, {
          fieldHeight: THUMB_PREVIEW.fieldHeight,
          finish: true,
          cache: thumbCacheRef.current,
          snapshot,
          draft: thumbDraft,
        });
        const synced = syncElements(thumbEdits, result.partKinds);
        if (synced !== thumbEdits) {
          thumbCommittedRef.current = synced;
          setThumbEdits(synced);
        }
        setThumbBoxes(result.boxes);
        setThumbVersion((version) => version + 1);
      },
      thumbDraft ? 0 : 40,
    );
    return () => window.clearTimeout(handle);
  }, [tab, thumbDesign, thumbEdits, thumbDraft, thumbFontTick]);

  // ---- Saving open songs ----
  captureRef.current = () =>
    activeSong && midiBytesRef.current
      ? {
          id: activeSong,
          fileName,
          midi: midiBytesRef.current,
          settings,
          trackStates: [...trackStates],
          exportSettings,
          thumbOptions,
          thumbEdits: thumbCommittedRef.current,
          tempoScale,
          trackNaming,
          audio: audioFileRef.current
            ? { ...audioFileRef.current, offset: audioOffset, volume: audioVolume, enabled: trackAudioEnabled }
            : null,
          stems: stems.flatMap((stem) => {
            const file = stemFilesRef.current.get(stem.trackId);
            return file ? [{ trackId: stem.trackId, name: stem.name, file }] : [];
          }),
        }
      : null;

  // Reopen whatever was open last time.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const meta = await loadMeta();
      const loaded: SongSnapshot[] = [];
      for (const id of meta?.order ?? []) {
        const song = await loadSong(id);
        if (song) loaded.push(song);
      }
      if (cancelled) return;
      for (const song of loaded) snapshotsRef.current.set(song.id, song);
      setSongs(loaded.map((song) => ({ id: song.id, name: song.fileName })));
      const active = loaded.find((song) => song.id === meta?.active) ?? loaded[0];
      if (active) await openMidi(active.midi, active.fileName, active.id, active);
      setStoreReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [openMidi]);

  // Save the active song a moment after anything about it changes.
  useEffect(() => {
    if (!storeReady || !activeSong) return;
    const handle = window.setTimeout(() => {
      const snapshot = captureRef.current();
      if (!snapshot || snapshot.id !== activeSong) return;
      snapshotsRef.current.set(snapshot.id, snapshot);
      void saveSong(snapshot);
    }, 700);
    return () => window.clearTimeout(handle);
  }, [
    storeReady,
    activeSong,
    settings,
    trackStates,
    exportSettings,
    thumbOptions,
    thumbEdits,
    tempoScale,
    trackNaming,
    audioOffset,
    audioVolume,
    trackAudioEnabled,
    audioState.name,
    fileName,
    stems,
  ]);

  useEffect(() => {
    if (!storeReady) return;
    void saveMeta({ order: songs.map((song) => song.id), active: activeSong });
  }, [storeReady, songs, activeSong]);

  // Save on the way out too, so the last second of work is not lost.
  useEffect(() => {
    const onHide = () => {
      const snapshot = captureRef.current();
      if (snapshot) void saveSong(snapshot);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // Keep a song's tab name in step with its title.
  useEffect(() => {
    if (!activeSong) return;
    setSongs((previous) =>
      previous.some((song) => song.id === activeSong && song.name !== fileName)
        ? previous.map((song) => (song.id === activeSong ? { ...song, name: fileName } : song))
        : previous,
    );
  }, [activeSong, fileName]);

  /** The control behind the last committed edit, so a slider drag is one undo step. */
  const thumbMergeRef = useRef<{ key: string; time: number } | null>(null);
  const handleThumbEdits = useCallback((next: ThumbEdits, commit: boolean, mergeKey?: string) => {
    setThumbEdits(next);
    if (!commit) return;
    const now = performance.now();
    const last = thumbMergeRef.current;
    thumbMergeRef.current = mergeKey ? { key: mergeKey, time: now } : null;
    if (mergeKey && last && last.key === mergeKey && now - last.time < 1500 && thumbPastRef.current.length) {
      // Same control, moments later: fold into the step already on the stack.
      thumbCommittedRef.current = next;
      return;
    }
    if (next !== thumbCommittedRef.current) {
      thumbPastRef.current = [...thumbPastRef.current.slice(-60), thumbCommittedRef.current];
      thumbFutureRef.current = [];
      thumbCommittedRef.current = next;
      setThumbHistory({ undo: thumbPastRef.current.length, redo: 0 });
    }
  }, []);

  const undoThumb = useCallback(() => {
    thumbMergeRef.current = null;
    const previous = thumbPastRef.current.pop();
    if (!previous) return;
    thumbFutureRef.current.push(thumbCommittedRef.current);
    thumbCommittedRef.current = previous;
    setThumbEdits(previous);
    setThumbHistory({ undo: thumbPastRef.current.length, redo: thumbFutureRef.current.length });
  }, []);

  const redoThumb = useCallback(() => {
    thumbMergeRef.current = null;
    const next = thumbFutureRef.current.pop();
    if (!next) return;
    thumbPastRef.current.push(thumbCommittedRef.current);
    thumbCommittedRef.current = next;
    setThumbEdits(next);
    setThumbHistory({ undo: thumbPastRef.current.length, redo: thumbFutureRef.current.length });
  }, []);

  const hitThumbLayer = useCallback(
    (element: ThumbElement, p: { x: number; y: number }) => hitLayer(thumbCacheRef.current, element, thumbBoxes.get(element.id), p),
    [thumbBoxes],
  );

  const patchThumbOptions = useCallback((patch: Partial<ThumbnailOptions>) => {
    setThumbOptions((previous) => ({ ...previous, ...patch }));
  }, []);

  const handleExportThumbnail = useCallback(
    (size: ThumbnailExportSize) => {
      if (!thumbDesign) return;
      const { width, height } =
        size === 'youtube'
          ? { width: 1280, height: 720 }
          : size === 'hd'
            ? { width: 1920, height: 1080 }
            : size === 'square'
              ? // Laid out afresh for the square, so nothing is cropped away.
                { width: 1000, height: 1000 }
              : { width: 3840, height: 2160 };
      void runExport('Rendering thumbnail…', async () => {
        // Let the busy bar paint before the render occupies the thread.
        await new Promise((resolve) => setTimeout(resolve, 16));
        await ensureFont(thumbDesign.font);
        const canvas = document.createElement('canvas');
        composeThumbnail(canvas, thumbDesign, thumbEdits, width, height, { finish: true });
        const { blob, extension } =
          size === 'youtube' ? await encodeForYouTube(canvas) : { blob: await encodePng(canvas), extension: 'png' };
        canvas.width = 0;
        canvas.height = 0;
        downloadBlob(blob, `${sanitizeFileName(fileName)}_thumbnail_${width}x${height}.${extension}`);
      });
    },
    [fileName, runExport, thumbDesign, thumbEdits],
  );

  // Keep the playback span in step with the file and the recording.
  useEffect(() => {
    if (!project) return;
    const playback = playbackRef.current;
    playback.start = timeline.start;
    // The playhead stops at the last note (or at the end of the end card); a
    // recording's tail plays on past it.
    const end = outro > 0 ? Math.max(project.durationSeconds, musicEnd(project) + outro) : project.durationSeconds;
    playback.duration = end;
    playback.loopStart = timeline.start;
    playback.loopEnd = end;
    // Unloading a recording can leave the playhead in a tail that no longer exists.
    if (playback.position < timeline.start || playback.position > end) {
      playback.seek(clamp(playback.position, timeline.start, end));
    }
  }, [project, timeline, outro]);

  useEffect(() => {
    synthRef.current?.setVolume(volume);
  }, [volume]);

  const zoomPercent = useMemo(() => {
    const layout = layoutRef.current;
    if (!layout || !project) return 100;
    const duration = Math.max(projectDuration(project, layout.domain), 1e-6);
    return (view.pxPerUnit / (layout.contentWidth / duration)) * 100;
  }, [project, view.pxPerUnit]);

  const domain = domainForTimelineMode(settings.timelineMode);

  const openMidiPicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi,audio/midi,audio/x-midi';
    input.multiple = true;
    input.onchange = async () => {
      // Several files open as several tabs, one after another.
      for (const file of Array.from(input.files ?? [])) await loadFile(file);
    };
    input.click();
  };

  return (
    <div className={`app${songs.length ? ' has-songs' : ''}`}>
      {songs.length > 0 && (
        <SongTabs
          songs={songs}
          active={activeSong}
          onSelect={(id) => void switchSong(id)}
          onClose={(id) => void closeSong(id)}
          onOpen={openMidiPicker}
        />
      )}
      <Toolbar
        project={project}
        playing={playing}
        position={position}
        duration={playEnd}
        zoomPercent={zoomPercent}
        sidebarOpen={sidebarOpen}
        audioEnabled={synthEnabled && !audioDriving}
        audioAvailable={Boolean(synthRef.current?.available) && !audioDriving}
        volume={volume}
        onOpen={openMidiPicker}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        onReturnToStart={handleReturnToStart}
        onZoom={zoomBy}
        onZoomFit={fitView}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        infoOpen={infoOpen}
        onToggleInfo={() => setInfoOpen((open) => !open)}
        onToggleAudio={() => void toggleAudio()}
        onVolume={setVolume}
      />
      {infoOpen && <InfoBar onClose={() => setInfoOpen(false)} />}

      <div className="app-body">
        <div className="stage-column">
          <div className="stage-area">
          <FileDropZone
            idle={!project}
            onFiles={(files) =>
              void (async () => {
                // Several MIDI files open as several tabs, one after another.
                for (const file of files) await loadAnyFile(file);
              })()
            }
          >
            {project && (
              <ArrangementCanvas
                project={project}
                settings={settings}
                trackStates={trackStates}
                mapper={mapper}
                playback={playbackRef.current}
                synth={synthRef.current}
                audioEnabled={synthEnabled && !audioDriving}
                view={view}
                onViewChange={setView}
                selectedNoteId={selection?.note.id ?? null}
                onSelectNote={setSelection}
                onViewportReady={handleViewportReady}
                frameAspect={exportSettings.width / Math.max(exportSettings.height, 1)}
                sessionEndSeconds={timeline.end}
                intro={introSource}
              />
            )}
          </FileDropZone>

          {project && (
            <NoteInspector project={project} selection={selection} onClose={() => setSelection(null)} />
          )}

          {project && tab === 'thumb' && thumbDesign && (
            <ThumbnailEditorStage
              source={thumbCanvasRef.current}
              version={thumbVersion}
              label={describeRecipe(thumbDesign.recipe)}
              edits={thumbEdits}
              onEdits={handleThumbEdits}
              boxes={thumbBoxes}
              tools={thumbTools}
              selectedId={thumbSelected}
              onSelect={setThumbSelected}
              onDraft={setThumbDraft}
              onUndo={undoThumb}
              onRedo={redoThumb}
              hitTest={hitThumbLayer}
            />
          )}
          </div>

          {project && (
            <SeekBar
              project={project}
              settings={settings}
              trackStates={trackStates}
              playback={playbackRef.current}
              mapper={mapper}
              playing={playing}
              onPlayPause={handlePlayPause}
              onSeek={seekTo}
              start={timeline.start}
              end={playEnd}
            />
          )}

          {busy && (
            <div className="busy">
              <span>{busy.label}</span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button className="mini-btn" onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}
        </div>

        <div className={`sidebar${sidebarOpen ? '' : ' collapsed'}`}>
          <div className="tabs">
            {(['tracks', 'visual', 'colour', 'audio', 'thumb', 'export'] as Tab[]).map((name) => (
              <button
                key={name}
                className={`tab${tab === name ? ' active' : ''}`}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>

          {!project && (
            <div className="panel">
              <p className="hint">No file loaded.</p>
            </div>
          )}

          {project && tab === 'tracks' && (
            <TrackPanel
              project={project}
              settings={settings}
              trackStates={trackStates}
              onTrackState={patchTrackState}
              onAllVisible={setAllVisible}
              onClearSolo={clearSolo}
              naming={trackNaming}
              onNaming={setTrackNaming}
            />
          )}
          {project && tab === 'visual' && (
            <VisualPanel
              settings={settings}
              onSettings={patchSettings}
              onApplyLook={applyLookPreset}
              barsOnScreen={barsOnScreen}
              onBarsOnScreen={setBarsOnScreen}
              originalTempo={baseProject ? baseTempo(baseProject) : 120}
              tempoScale={tempoScale}
              onTempoScale={handleTempoScale}
              tracks={cameraTracks}
              getPosition={getPlayhead}
              onSeek={seekTo}
              duration={project?.durationSeconds ?? 0}
              onApplySavedLook={applySavedLook}
              frameAspect={exportSettings.width / Math.max(exportSettings.height, 1)}
              onPreviewOutro={() => project && seekTo(musicEnd(project) + (settings.outroSeconds ?? 5) * 0.85)}
            />
          )}
          {tab === 'colour' && (
            <ColorPanel
              settings={settings}
              project={project}
              trackStates={trackStates}
              onSettings={patchSettings}
              onTheme={patchTheme}
              onSeed={applySeed}
              onInstrumentColor={setInstrumentColor}
              onApplyThemePreset={applyThemePreset}
              onApplyInstrumentPalette={applyInstrumentPalette}
              onAutoAssignTrackColors={autoAssignTrackColors}
              onClearTrackColors={clearTrackColors}
            />
          )}
          {tab === 'audio' && (
            <AudioPanel
              audio={audioState}
              enabled={trackAudioEnabled}
              offset={audioOffset}
              volume={audioVolume}
              position={position}
              tempoScale={tempoScale}
              onPick={pickAudioFile}
              onUnload={unloadAudio}
              onEnabled={setTrackAudioEnabled}
              onOffset={setAudioOffset}
              onVolume={setAudioVolume}
              onAutoSync={() => void handleAutoSync()}
              tracks={cameraTracks}
              stems={stems}
              onAddStem={(trackId, file) => void addStem(trackId, file)}
              onRemoveStem={removeStem}
              onMatchStems={matchStems}
              soloFocus={settings.soloFocus ?? true}
              onSoloFocus={(soloFocus) => patchSettings({ soloFocus })}
            />
          )}
          {project && tab === 'thumb' && thumbDesign && (
            <ThumbnailPanel
              design={thumbDesign}
              options={thumbOptions}
              onOptions={patchThumbOptions}
              preview={thumbCanvasRef.current}
              previewVersion={thumbVersion}
              durationSeconds={timeline.end - timeline.start}
              analyzingAudio={analyzingAudioMood}
              accent={settings.accentColor}
              edits={thumbEdits}
              onEdits={handleThumbEdits}
              tools={thumbTools}
              onTools={setThumbTools}
              selectedId={thumbSelected}
              onSelect={setThumbSelected}
              onUndo={undoThumb}
              onRedo={redoThumb}
              history={thumbHistory}
              filter={
                <FilterPanel
                  design={thumbDesign}
                  options={thumbOptions}
                  onOptions={patchThumbOptions}
                  snapshot={thumbSnapshotRef.current}
                  snapshotVersion={thumbVersion}
                />
              }
            />
          )}
          {project && tab === 'export' && (
            <ExportPanel
              project={project}
              timeline={timeline}
              hasAudio={Boolean(audioState.name)}
              exportSettings={exportSettings}
              onExportSettings={(patch) => setExportSettings((previous) => ({ ...previous, ...patch }))}
              busy={Boolean(busy)}
              onExportPng={handleExportPng}
              onExportSvg={handleExportSvg}
              onExportVideo={handleExportVideo}
              onExportMp4={handleExportMp4}
              onExportFrames={handleExportFrames}
              onExportThumbnail={thumbDesign ? handleExportThumbnail : undefined}
              shortsStart={shortsStart}
              onExportShort={handleExportShort}
              onPreviewShort={handlePreviewShort}
              position={position}
              onCancel={() => abortRef.current?.abort()}
            />
          )}
        </div>
      </div>

      <div className="status">
        {stats ? (
          <>
            <span>
              TRACKS <b>{stats.trackCount}</b>
            </span>
            <span>
              NOTES <b>{formatCount(stats.noteCount)}</b>
            </span>
            <span>
              TEMPO <b>{stats.tempoLabel} BPM</b>
            </span>
            <span>
              METER <b>{stats.timeSignatureLabel}</b>
            </span>
            <span>
              BARS <b>{stats.barCount}</b>
            </span>
            <span>
              LENGTH <b>{formatSeconds(stats.durationSeconds)}</b>
            </span>
            {stats.markerCount > 0 && (
              <span>
                MARKERS <b>{stats.markerCount}</b>
              </span>
            )}
            <span className="status-spacer" />
            <span>AXIS <b>{domain === 'beats' ? 'MUSICAL' : 'TIME'}</b></span>
          </>
        ) : (
          <span>Drop a .mid file anywhere to begin</span>
        )}
        <span className="status-spacer" />
        <button className="status-info" onClick={() => setInfoOpen(true)}>
          <span className="kbd">?</span> all shortcuts
        </button>
        <span className="kbd">Space</span>
        <span>play</span>
        <span className="kbd">Enter</span>
        <span>back to start</span>
        <span className="kbd">Wheel</span>
        <span>tracks</span>
        <span className="kbd">Ctrl+Wheel</span>
        <span>zoom</span>
        <span className="kbd">F</span>
        <span>fit</span>
      </div>
    </div>
  );
}

/** Length of one bar expressed in the layout's active time domain. */
function barSpanInDomain(project: MidiProject, layout: LayoutResult): number {
  const sig = project.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  const beatsPerBar = (sig.numerator * 4) / sig.denominator;
  if (layout.domain === 'beats') return beatsPerBar;
  const bpm = project.tempos[0]?.bpm ?? 120;
  return (beatsPerBar * 60) / bpm;
}

/** Horizontal scale that puts `bars` bars across the content area. */
function pxPerUnitForBars(project: MidiProject, layout: LayoutResult, bars: number): number {
  const span = barSpanInDomain(project, layout) * Math.max(bars, 0.5);
  return layout.contentWidth / Math.max(span, 1e-6);
}
