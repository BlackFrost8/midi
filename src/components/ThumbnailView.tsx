import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatSeconds } from '../utils/formatting';

/**
 * Shows a rendered thumbnail canvas at whatever size its box is, sharp on
 * high-DPI screens. The source is drawn, never re-rendered, so two views of the
 * same thumbnail cost one render.
 */
export const ThumbnailView = memo(function ThumbnailView({
  source,
  version,
  durationSeconds,
  rounded,
}: {
  source: HTMLCanvasElement | null;
  /** Bumped whenever the source canvas has new pixels. */
  version: number;
  /** Shown as YouTube's duration badge, so the title can be checked against it. */
  durationSeconds?: number;
  rounded?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() =>
      setBox({ width: canvas.clientWidth, height: canvas.clientHeight }),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !box.width || !box.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [box, source, version]);

  return (
    <div className={`thumb-view${rounded ? ' rounded' : ''}`}>
      <canvas ref={canvasRef} />
      {!source && <div className="thumb-view-empty">Rendering…</div>}
      {durationSeconds !== undefined && durationSeconds > 0 && (
        <span className="thumb-badge">{formatSeconds(durationSeconds)}</span>
      )}
    </div>
  );
});

/**
 * The large preview that covers the arrangement while the Thumb tab is open,
 * fitted to the stage at 16:9.
 */
export const ThumbnailStage = memo(function ThumbnailStage({
  source,
  version,
  label,
}: {
  source: HTMLCanvasElement | null;
  version: number;
  label: string;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => {
      const width = Math.max(area.clientWidth - 64, 0);
      const height = Math.max(area.clientHeight - 88, 0);
      const fitted = Math.min(width, (height * 16) / 9);
      setSize({ width: fitted, height: (fitted * 9) / 16 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="thumb-stage" ref={areaRef}>
      <div className="thumb-stage-inner" style={{ width: size.width }}>
        <div className="thumb-stage-caption">
          <span>Thumbnail</span>
          <span>{label}</span>
        </div>
        <div style={{ width: size.width, height: size.height }}>
          <ThumbnailView source={source} version={version} />
        </div>
      </div>
    </div>
  );
});
