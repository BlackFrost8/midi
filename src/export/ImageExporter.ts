import { renderScene } from '../renderer/CanvasRenderer';
import { RenderCache } from '../renderer/RenderCache';
import { buildExportScene, type ExportSceneInput } from './SceneBuilder';

export interface PngExportOptions extends ExportSceneInput {
  opaqueBackground: boolean;
  fileName: string;
}

/** Browsers refuse to allocate canvases beyond a per-engine area limit. */
const MAX_CANVAS_AREA = 268_435_456; // 16384², the common Chromium ceiling

export function validateExportSize(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) {
    return 'Export size must be at least 16 × 16.';
  }
  if (width > 16384 || height > 16384) {
    return 'Each dimension must be 16384 pixels or less.';
  }
  if (width * height > MAX_CANVAS_AREA) {
    return 'That resolution exceeds the browser canvas limit. Try a smaller size.';
  }
  return null;
}

/**
 * Renders one frame at the requested resolution on a detached canvas and hands
 * back a PNG blob. Nothing from the live UI is involved.
 */
export async function renderPng(options: PngExportOptions): Promise<Blob> {
  const error = validateExportSize(options.width, options.height);
  if (error) throw new Error(error);

  // Web fonts must be resolved before measuring or the labels shift.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext('2d', { alpha: !options.opaqueBackground });
  if (!ctx) throw new Error('Could not create a 2D context for export.');

  const scene = buildExportScene(options);
  renderScene(ctx, scene, new RenderCache(), { opaqueBackground: options.opaqueBackground });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');

  // Release the backing store promptly; 8K frames are ~130MB each.
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90) || 'arrangement'
  );
}
