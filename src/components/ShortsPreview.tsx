import { useEffect, useRef, useState } from 'react';
import { renderScene } from '../renderer/CanvasRenderer';
import { RenderCache } from '../renderer/RenderCache';
import type { Scene } from '../renderer/Scene';

interface Props {
  /** The Short's frame at a time in the song, at the preview's size. */
  frameAt: (seconds: number) => Scene;
  width: number;
  height: number;
  /** The Short's span in the song. */
  start: number;
  end: number;
  getPosition: () => number;
  playing: boolean;
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}

/**
 * The Short as it will come out, playing live with the song: vertical, with
 * the caption band and the pop-up texts. It loops over the Short's span, and
 * picks up every change you make in the panel straight away, so you can try
 * texts and positions without exporting.
 */
export function ShortsPreview(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const [showUi, setShowUi] = useState(true);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const cache = new RenderCache();
    let frame = 0;
    let lastShown = -1;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const p = live.current;
      const ctx = canvasRef.current?.getContext('2d', { alpha: false });
      if (!ctx) return;
      let position = p.getPosition();
      // Loop the Short, as YouTube will.
      if (p.playing && (position >= p.end || position < p.start - 0.25)) {
        p.onSeek(p.start);
        position = p.start;
      }
      const at = Math.min(Math.max(position, p.start), p.end);
      renderScene(ctx, p.frameAt(at), cache);
      const shown = Math.floor((at - p.start) * 10);
      if (shown !== lastShown) {
        lastShown = shown;
        setNow(at - p.start);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') live.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const length = Math.max(props.end - props.start, 0.1);
  return (
    <div className="shorts-preview" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="shorts-preview-frame">
        <canvas ref={canvasRef} width={props.width} height={props.height} />
        {showUi && (
          <>
            <span className="shorts-ui-bottom" />
            <span className="shorts-ui-right" />
          </>
        )}
      </div>
      <div className="shorts-preview-bar">
        <button className="btn" onClick={props.onPlayPause}>
          {props.playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn" onClick={() => props.onSeek(props.start)}>
          Restart
        </button>
        <input
          type="range"
          min={0}
          max={length}
          step={0.05}
          value={Math.min(now, length)}
          onChange={(event) => props.onSeek(props.start + Number(event.target.value))}
        />
        <span className="hint" style={{ margin: 0, minWidth: 64 }}>
          {now.toFixed(1)}s / {length.toFixed(0)}s
        </span>
        <label className="hint" style={{ margin: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={showUi} onChange={(event) => setShowUi(event.target.checked)} />
          Shorts buttons
        </label>
        <button className="btn" onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
