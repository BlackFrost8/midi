import type { PaintBrush, TextureId } from '../thumbnail/Editor';

/** Small line icons for the paint brushes, shapes and textures. */
export function BrushIcon({ id }: { id: PaintBrush }) {
  return (
    <svg className="brush-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {BRUSH_ART[id]}
    </svg>
  );
}

export function TextureIcon({ id }: { id: TextureId }) {
  return (
    <svg className="brush-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <defs>
        <clipPath id={`tex-${id}`}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
        </clipPath>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <g clipPath={`url(#tex-${id})`} fill="currentColor" stroke="currentColor">
        {TEXTURE_ART[id]}
      </g>
    </svg>
  );
}

const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const solid = { fill: 'currentColor', stroke: 'none' } as const;

const BRUSH_ART: Record<PaintBrush, JSX.Element> = {
  round: <path {...line} strokeWidth={3.2} d="M4 16c3-6 5-7 8-4s5 2 8-4" />,
  ink: <path {...solid} d="M3 18c4-1 7-5 10-9 2-3 5-5 8-5-2 2-4 5-6 8-3 4-7 6-12 6.5Z" />,
  dry: (
    <g {...line} strokeWidth={1.1}>
      <path d="M3 9c4-2 8-2 18-1" strokeDasharray="7 2 4 1.5" />
      <path d="M3 12c5-2 9-1.5 18-.5" strokeDasharray="10 1.5 3 2" />
      <path d="M3 15c4-1.5 9-1 18 0" strokeDasharray="5 2.5 8 1" />
      <path d="M4 17.5c5-1 9-.5 16 .5" strokeDasharray="3 3 6 2" />
    </g>
  ),
  chalk: (
    <g {...solid}>
      {[
        [4, 15], [6, 13.5], [7.5, 14.8], [9, 12.5], [10.5, 13.8], [12, 11.5], [13.5, 12.8], [15, 10.5], [16.5, 11.8], [18, 9.5], [19.5, 10.6],
        [5.2, 16.4], [8.3, 15.6], [11.2, 14.9], [14.3, 13.9], [17.4, 12.7], [20, 8.4],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1.4" height="1.4" />
      ))}
    </g>
  ),
  spray: (
    <g {...solid}>
      {[
        [12, 12, 1.1], [10, 10.5, 0.8], [14, 10, 0.7], [13.5, 14, 0.9], [9.5, 13.8, 0.7], [11.8, 8.4, 0.6], [16, 12.6, 0.6], [8, 12, 0.6],
        [15.6, 8.6, 0.5], [7.4, 9, 0.5], [17.6, 15, 0.5], [6.6, 15.4, 0.5], [12.4, 16.6, 0.6], [18.4, 10.2, 0.4], [5.6, 11.6, 0.4], [10.6, 6.6, 0.4],
      ].map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
      ))}
    </g>
  ),
  marker: <path {...line} strokeWidth={5} strokeLinecap="square" strokeOpacity={0.8} d="M5 17 19 7" />,
  eraser: (
    <g {...line} strokeWidth={1.6}>
      <path d="m10 19 10-10-5-5L4 15l4 4h12" />
      <path d="m7.5 11.5 5 5" />
    </g>
  ),
  land: (
    <path
      {...solid}
      d="M4 13c0-3 2-6 5-6 1.5 0 2-1.5 4-1.5s2.5 2 4.5 2.5 3 2 2.5 4-2 2.5-1.5 4-1.5 3-4 2.5-3 1-5 .5S6 17 5 16.5 4 15 4 13Zm15.5 6.2a1 1 0 1 1 0 .1Z"
    />
  ),
  blob: <path {...solid} d="M6 8c2-4 8-4 11-1s3 7 0 10-9 3-11 0-2-6 0-9Z" />,
  circle: <circle {...solid} cx="12" cy="12" r="7.5" />,
  moon: <path {...solid} d="M15 4a8 8 0 1 0 5 13.5A7 7 0 0 1 15 4Z" />,
  ring: <ellipse {...line} strokeWidth={2.4} cx="12" cy="12" rx="8.5" ry="4.5" transform="rotate(-18 12 12)" />,
  shard: <path {...solid} d="M13 3 19 17l-9 4L5 12Z" />,
  sparkle: <path {...solid} d="M12 2c.8 5 2 7.2 9 10-7 2.8-8.2 5-9 10-.8-5-2-7.2-9-10 7-2.8 8.2-5 9-10Z" />,
  drop: <path {...solid} d="M12 3c3 5 6 8 6 11.5a6 6 0 0 1-12 0C6 11 9 8 12 3Z" />,
};

const TEXTURE_ART: Record<TextureId, JSX.Element> = {
  none: <rect x="3" y="3" width="18" height="18" opacity="0.85" />,
  canvas: (
    <g strokeWidth={1.2} fill="none" opacity="0.85">
      {[6, 10, 14, 18].map((v) => (
        <path key={`h${v}`} d={`M3 ${v}h18`} />
      ))}
      {[6, 10, 14, 18].map((v) => (
        <path key={`v${v}`} d={`M${v} 3v18`} strokeOpacity="0.5" />
      ))}
    </g>
  ),
  paper: (
    <g stroke="none" opacity="0.85">
      <path d="M3 3h18v18H3Z" opacity="0.35" />
      {[[6, 7], [11, 5], [16, 8], [8, 12], [14, 13], [18, 16], [6, 17], [12, 18]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />
      ))}
    </g>
  ),
  sponge: (
    <g stroke="none" opacity="0.85">
      <path d="M3 3h18v18H3Z" />
      {[[7, 8, 2.2], [14, 6, 1.6], [17, 12, 2.4], [9, 15, 1.8], [14, 18, 1.4], [5, 19, 1.2]].map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="var(--ui-surface-2)" />
      ))}
    </g>
  ),
  hatch: (
    <g strokeWidth={1.6} fill="none" opacity="0.85">
      {[-6, -1, 4, 9, 14, 19, 24].map((v) => (
        <path key={v} d={`M${v} 22 ${v + 18} 4`} />
      ))}
    </g>
  ),
  dots: (
    <g stroke="none" opacity="0.85">
      {[6, 10.5, 15, 19.5].flatMap((x) => [6, 10.5, 15, 19.5].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />))}
    </g>
  ),
  grit: (
    <g stroke="none" opacity="0.85">
      {[[5, 5], [8, 7], [12, 4], [16, 6], [19, 9], [6, 10], [10, 11], [14, 10], [18, 13], [4, 14], [9, 15], [13, 16], [17, 18], [6, 19], [11, 20], [20, 20]].map(
        ([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="1.6" height="1.6" />
        ),
      )}
    </g>
  ),
};
