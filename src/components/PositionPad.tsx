import { useRef } from 'react';

interface Props {
  label: string;
  /** Position as fractions of the frame, 0–1. */
  x: number;
  y: number;
  /** Width ÷ height of the video frame, so the pad has its shape. */
  aspect: number;
  align: 'left' | 'center' | 'right';
  onChange: (x: number, y: number) => void;
}

/**
 * A miniature of the video frame: drag the marker to move the text. The
 * marker is the text's anchor, the side it is aligned to, drawn with a short
 * bar showing which way the text runs from it.
 */
export function PositionPad({ label, x, y, aspect, align, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (event: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const fx = Math.min(0.98, Math.max(0.02, (event.clientX - box.left) / box.width));
    const fy = Math.min(0.96, Math.max(0.04, (event.clientY - box.top) / box.height));
    onChange(Number(fx.toFixed(3)), Number(fy.toFixed(3)));
  };
  const barLeft = align === 'left' ? 0 : align === 'center' ? -50 : -100;
  return (
    <div className="field">
      <label>{label}</label>
      <div
        ref={ref}
        className="position-pad"
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={(event) => {
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          move(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons & 1) move(event);
        }}
        title="Drag to move the text"
      >
        <span className="position-pad-safe" />
        <span className="position-pad-bar" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `translate(${barLeft}%, -50%)` }} />
        <span className="position-pad-dot" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
      </div>
    </div>
  );
}
