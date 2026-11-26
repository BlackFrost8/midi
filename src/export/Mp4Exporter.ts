import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { renderScene } from '../renderer/CanvasRenderer';
import { RenderCache } from '../renderer/RenderCache';
import { validateExportSize } from './ImageExporter';
import { makeFrameFactory, type VideoExportOptions } from './VideoExporter';

/**
 * H.264 / MP4 export via WebCodecs.
 *
 * Unlike the WebM path this does not capture in real time: each frame is drawn
 * and handed to the encoder in turn, so a slow frame makes the export take
 * longer rather than getting dropped. The result is frame-exact and uploads to
 * YouTube without a transcode step.
 */

/** Ordered by capability; the first one the browser accepts wins. */
const AVC_PROFILES = [
  'avc1.640034', // High 5.2 — 8K
  'avc1.640033', // High 5.1 — 4K
  'avc1.640032', // High 5.0 — 1440p
  'avc1.640028', // High 4.0 — 1080p
  'avc1.4d4028', // Main 4.0
  'avc1.42e028', // Baseline 4.0
];

export function supportsMp4(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

export function supportsAudioEncoding(): boolean {
  return typeof window !== 'undefined' && 'AudioEncoder' in window && 'AudioData' in window;
}

/** Audio to lay under the video, taken from the loaded track. */
export interface Mp4AudioInput {
  buffer: AudioBuffer;
  /** Seconds to add to a visual position to reach the matching audio position. */
  offset: number;
  bitrate?: number;
}

/** AAC frames per AudioData handed to the encoder. */
const AUDIO_CHUNK = 4096;

/**
 * Encodes the slice of the recording that lines up with the exported range and
 * feeds it to the muxer.
 *
 * The slice is taken at `visualTime + offset`, the same alignment used for
 * playback, so whatever you hear in the app is what lands in the file. Where
 * the range runs past either end of the recording the gap is filled with
 * silence rather than shifting the audio, which would break the sync.
 */
async function encodeAudio(
  muxer: Muxer<ArrayBufferTarget>,
  input: Mp4AudioInput,
  startSeconds: number,
  endSeconds: number,
  signal?: AbortSignal,
): Promise<void> {
  const { buffer, offset } = input;
  const sampleRate = buffer.sampleRate;
  const channels = Math.min(buffer.numberOfChannels, 2);
  const totalFrames = Math.max(Math.round((endSeconds - startSeconds) * sampleRate), 1);

  // Where in the recording the exported range begins. May be negative when the
  // visuals start before the first sample.
  const sourceStart = Math.round((startSeconds + offset) * sampleRate);
  const sourceData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) sourceData.push(buffer.getChannelData(c));

  let encodeError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });

  encoder.configure({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: input.bitrate ?? 192_000,
  });

  const planar = new Float32Array(AUDIO_CHUNK * channels);

  for (let written = 0; written < totalFrames; written += AUDIO_CHUNK) {
    if (signal?.aborted) break;
    if (encodeError) throw encodeError;

    const frames = Math.min(AUDIO_CHUNK, totalFrames - written);
    planar.fill(0);

    for (let c = 0; c < channels; c++) {
      const channel = sourceData[c];
      const base = c * frames;
      for (let i = 0; i < frames; i++) {
        const index = sourceStart + written + i;
        planar[base + i] = index >= 0 && index < channel.length ? channel[index] : 0;
      }
    }

    const data = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: Math.round((written / sampleRate) * 1_000_000),
      data: planar.subarray(0, frames * channels),
    });
    encoder.encode(data);
    data.close();

    while (encoder.encodeQueueSize > 16) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (encodeError) throw encodeError;
    }
  }

  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
}

/** H.264 requires even dimensions; odd values fail to configure. */
export function evenDimensions(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(2, Math.floor(width / 2) * 2), height: Math.max(2, Math.floor(height / 2) * 2) };
}

async function pickCodec(
  width: number,
  height: number,
  framerate: number,
  bitrate: number,
): Promise<string> {
  for (const codec of AVC_PROFILES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        framerate,
        bitrate,
      });
      if (support.supported) return codec;
    } catch {
      // Some builds throw instead of reporting unsupported; keep looking.
    }
  }
  throw new Error(
    'This browser cannot encode H.264 at that resolution. Try a smaller size, or export WebM / PNG frames.',
  );
}

export async function recordMp4(
  options: VideoExportOptions & { audio?: Mp4AudioInput | null },
): Promise<Blob> {
  if (!supportsMp4()) {
    throw new Error('MP4 export needs WebCodecs, which this browser does not provide. Use WebM instead.');
  }

  const { width, height } = evenDimensions(options.width, options.height);
  const sizeError = validateExportSize(width, height);
  if (sizeError) throw new Error(sizeError);

  if (document.fonts?.ready) await document.fonts.ready;

  const fps = Math.max(1, Math.round(options.fps));
  const bitrate = Math.round(options.bitrateMbps * 1_000_000);
  const codec = await pickCodec(width, height, fps, bitrate);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D context for MP4 export.');

  const frameAt = makeFrameFactory({ ...options, width, height });
  const cache = new RenderCache();

  // Only declare an audio track when there is something to put in it; an empty
  // declared track produces a file some players refuse.
  const audio = options.audio && supportsAudioEncoding() ? options.audio : null;
  const audioChannels = audio ? Math.min(audio.buffer.numberOfChannels, 2) : 0;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    ...(audio
      ? {
          audio: {
            codec: 'aac' as const,
            numberOfChannels: audioChannels,
            sampleRate: audio.buffer.sampleRate,
          },
        }
      : {}),
    // Moves the index to the front of the file so it streams and scrubs.
    fastStart: 'in-memory',
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });

  encoder.configure({
    codec,
    width,
    height,
    framerate: fps,
    bitrate,
    latencyMode: 'quality',
  });

  const duration = Math.max(options.endSeconds - options.startSeconds, 1 / fps);
  const frameCount = Math.max(Math.ceil(duration * fps), 1);
  const microsPerFrame = 1_000_000 / fps;

  try {
    for (let i = 0; i < frameCount; i++) {
      if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;

      renderScene(ctx, frameAt(options.startSeconds + i / fps), cache);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * microsPerFrame),
        duration: Math.round(microsPerFrame),
      });
      // A keyframe every two seconds keeps seeking responsive.
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      // Let the encoder drain rather than queuing thousands of frames of RAM.
      while (encoder.encodeQueueSize > 8) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (encodeError) throw encodeError;
      }

      options.onProgress?.((i + 1) / frameCount, `Encoding frame ${i + 1} of ${frameCount}`);
    }

    await encoder.flush();
    if (encodeError) throw encodeError;

    if (audio) {
      options.onProgress?.(1, 'Encoding audio');
      await encodeAudio(muxer, audio, options.startSeconds, options.endSeconds, options.signal);
    }

    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
