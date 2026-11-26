import { renderScene } from '../renderer/CanvasRenderer';
import { RenderCache } from '../renderer/RenderCache';
import type { Viewport } from '../layout/LayoutEngine';
import { buildExportScene, type ExportSceneInput } from './SceneBuilder';
import { validateExportSize } from './ImageExporter';

export interface VideoExportOptions extends Omit<ExportSceneInput, 'playheadSeconds'> {
  fps: number;
  bitrateMbps: number;
  startSeconds: number;
  endSeconds: number;
  /** Where the playhead sits horizontally when the view follows it (0–1). */
  followAnchor: number;
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
}

export interface FrameSequenceOptions extends VideoExportOptions {
  directory: FileSystemDirectoryHandle;
  fileStem: string;
}

/** Best available WebM codec, most preferred first. */
const CODECS = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function supportedVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of CODECS) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export function supportsFrameSequence(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Creates the per-frame scene factory shared by every video path.
 *
 * The frame is built from the visual settings, so the video matches what the
 * arrangement looks like on screen:
 *
 *  - lane height, tracks in view and vertical scroll come from the settings
 *    and the live viewport (handled in `buildExportScene`);
 *  - horizontal motion follows `settings.followMode` — "off" holds the framing
 *    still, "page" jumps a screen at a time, "continuous" keeps the playhead
 *    pinned at `followAnchor`;
 *  - with `fitWholeArrangement` on, the whole song is already in frame, so
 *    there is nothing to follow and the playhead simply sweeps across.
 *
 * Scroll is computed from the timestamp alone rather than accumulated, so any
 * frame can be rendered independently and the result is identical whether it
 * came from the real-time recorder or the offline encoder.
 */
export function makeFrameFactory(options: VideoExportOptions) {
  const { project, settings, trackStates, width, height, mapper } = options;

  // Establish the horizontal scale once so it cannot drift between frames.
  const probe = buildExportScene({
    project,
    settings,
    trackStates,
    width,
    height,
    playheadSeconds: options.startSeconds,
    fitWholeArrangement: options.fitWholeArrangement,
    sourceViewport: options.sourceViewport,
    mapper,
    spanEndSeconds: options.spanEndSeconds,
  });
  const basePxPerUnit = probe.viewport.pxPerUnit;
  const domain = probe.layout.domain;
  const contentWidth = probe.layout.contentWidth;
  const domainDuration = probe.layout.domainDuration;
  const source = options.sourceViewport;
  const scrollYForExport = source ? source.scrollY * (height / Math.max(source.height, 1)) : 0;

  const span = contentWidth / basePxPerUnit;
  const maxScroll = Math.max(domainDuration - span, 0);
  const startScroll = options.sourceViewport?.scrollUnits ?? 0;
  const follow = settings.followMode;

  return (time: number) => {
    // The picture holds on the last note while a recording's tail plays out
    // under it, exactly as the preview does.
    const seconds = Math.min(time, project.durationSeconds);
    let scrollUnits = 0;

    if (!options.fitWholeArrangement) {
      const unit = domain === 'beats' ? mapper.secondsToBeats(seconds) : seconds;

      if (follow === 'off') {
        // Hold the framing the user set up and let the playhead cross it.
        scrollUnits = Math.min(startScroll, maxScroll);
      } else if (follow === 'page') {
        // Whole-screen jumps, anchored to the start of the song so every page
        // boundary lands in the same place no matter which frame is rendered.
        // Not capped at the song's end, so a recording's tail keeps paging.
        const page = span > 0 ? Math.floor(unit / span) : 0;
        scrollUnits = Math.max(0, page * span);
      } else {
        // Pinned playhead, exactly as on screen: the camera holds still only
        // until the playhead reaches its anchor, then moves with the music —
        // through the last bar too, so the ending scrolls out instead of the
        // playhead drifting to the right edge.
        scrollUnits = Math.max(0, unit - span * options.followAnchor);
      }
    }

    const sourceViewport: Viewport = {
      width,
      height,
      pixelRatio: 1,
      pxPerUnit: basePxPerUnit,
      scrollUnits,
      // Carry the on-screen vertical scroll so a "tracks in view" framing is
      // reproduced in the video instead of snapping back to the first lane.
      // It is in screen pixels, so rescale it to the export height.
      scrollY: options.fitWholeArrangement ? 0 : scrollYForExport,
    };

    return buildExportScene({
      project,
      settings,
      trackStates,
      width,
      height,
      playheadSeconds: seconds,
      // Reuse the fixed scale by always going through the "source viewport"
      // branch; the ratio resolves to 1 because the widths match.
      fitWholeArrangement: false,
      sourceViewport,
      mapper,
      // The intro and end cards run on the real clock: the end card plays
      // after the last note, where the arrangement itself holds still.
      intro: options.intro,
      clockSeconds: time,
    });
  };
}

/**
 * Records a WebM by drawing in real time and letting MediaRecorder timestamp
 * frames from the wall clock. This keeps audio-relative timing exact: if a
 * frame is late, it is duplicated rather than shifting everything after it.
 */
export async function recordWebm(options: VideoExportOptions): Promise<Blob> {
  const sizeError = validateExportSize(options.width, options.height);
  if (sizeError) throw new Error(sizeError);

  const mimeType = supportedVideoMimeType();
  if (!mimeType) throw new Error('This browser cannot record video. Try the PNG frame sequence instead.');

  if (document.fonts?.ready) await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D context for video export.');

  const frameAt = makeFrameFactory(options);
  const cache = new RenderCache();
  const duration = Math.max(options.endSeconds - options.startSeconds, 0.1);

  const stream = canvas.captureStream(options.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(options.bitrateMbps * 1_000_000),
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Recording failed.'));
  });

  // Draw the first frame before starting so the stream never opens on a blank canvas.
  renderScene(ctx, frameAt(options.startSeconds), cache);
  recorder.start();

  const started = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      if (options.signal?.aborted) {
        resolve();
        return;
      }
      const elapsed = (performance.now() - started) / 1000;
      const t = options.startSeconds + elapsed;
      if (elapsed >= duration) {
        renderScene(ctx, frameAt(options.endSeconds), cache);
        resolve();
        return;
      }
      renderScene(ctx, frameAt(t), cache);
      options.onProgress?.(elapsed / duration, `Recording ${Math.round((elapsed / duration) * 100)}%`);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // A short tail gives the encoder time to flush the final frames.
  await new Promise((resolve) => setTimeout(resolve, 250));
  recorder.stop();
  await finished;
  stream.getTracks().forEach((track) => track.stop());

  canvas.width = 0;
  canvas.height = 0;

  if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  return new Blob(chunks, { type: mimeType.split(';')[0] });
}

/**
 * Writes a numbered PNG per frame into a directory the user picks. Slower than
 * recording, but every frame is rendered offline at full quality with no
 * dropped frames, which is the right path for a final upload.
 */
export async function exportFrameSequence(options: FrameSequenceOptions): Promise<number> {
  const sizeError = validateExportSize(options.width, options.height);
  if (sizeError) throw new Error(sizeError);
  if (document.fonts?.ready) await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D context for frame export.');

  const frameAt = makeFrameFactory(options);
  const cache = new RenderCache();
  const duration = Math.max(options.endSeconds - options.startSeconds, 0);
  const frameCount = Math.max(Math.ceil(duration * options.fps), 1);
  const pad = String(frameCount).length + 1;

  for (let i = 0; i < frameCount; i++) {
    if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

    const t = options.startSeconds + i / options.fps;
    renderScene(ctx, frameAt(t), cache);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error(`Frame ${i} could not be encoded.`);

    const name = `${options.fileStem}_${String(i + 1).padStart(pad, '0')}.png`;
    const handle = await options.directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();

    options.onProgress?.((i + 1) / frameCount, `Frame ${i + 1} of ${frameCount}`);
    // Yield so the UI can paint progress and stay responsive.
    if (i % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  canvas.width = 0;
  canvas.height = 0;
  return frameCount;
}

/** Ready-to-run command for turning an exported frame sequence into an MP4. */
export function ffmpegCommand(fileStem: string, fps: number, digits: number): string {
  return `ffmpeg -framerate ${fps} -i ${fileStem}_%0${digits}d.png -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p ${fileStem}.mp4`;
}
