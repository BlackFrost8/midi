import { useEffect, useRef } from 'react';
import type { RenderSettings } from '../models/RenderSettings';
import { drawGradientIcon, hitEnvelope, iconGradientColors } from '../renderer/IconPaint';
import type { IconName } from '../renderer/iconLibrary';

interface Props {
  settings: RenderSettings;
  icons: IconName[];
}

const HEIGHT = 64;
/**
 * A two-second demo phrase, so the pulse can be judged without playing the
 * song: two short hits, then a chord held for most of a beat and a half.
 */
const LOOP = 2;
const DEMO: Array<{ at: number; held: number }> = [
  { at: 0, held: 0.12 },
  { at: 0.5, held: 0.12 },
  { at: 1, held: 0.85 },
];

function demoPulse(seconds: number): number {
  const t = seconds % LOOP;
  let level = 0;
  // The previous loop's held chord can still be fading at the top of this one.
  for (const shift of [0, LOOP]) {
    for (const hit of DEMO) level = Math.max(level, hitEnvelope(t + shift - hit.at, hit.held));
  }
  return level;
}

/**
 * The song's own icons in the current gradient, pulsing to a demo phrase with
 * a little stagger between them — what the track panel will do with real
 * notes, held chords included.
 * Drawn with the same code as the arrangement.
 */
export function IconGradientPreview({ settings, icons }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef({ settings, icons });
  latest.current = { settings, icons };

  useEffect(() => {
    let frame = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const { settings: current, icons: shown } = latest.current;
      const width = canvas.clientWidth;
      if (width <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
      if (canvas.height !== Math.round(HEIGHT * dpr)) canvas.height = Math.round(HEIGHT * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = current.theme.panel;
      ctx.fillRect(0, 0, width, HEIGHT);

      const colors = iconGradientColors(current);
      const size = 34;
      const gap = Math.max((width - shown.length * size) / (shown.length + 1), 6);
      const seconds = time / 1000;
      shown.forEach((icon, i) => {
        const swell = demoPulse(seconds + LOOP - i * 0.11);
        drawGradientIcon(ctx, icon, gap + i * (size + gap), (HEIGHT - size) / 2, size, {
          colors,
          style: current.iconGradientStyle,
          opacity: current.iconGradientOpacity,
          pulse: swell * 0.85 * current.iconPulseStrength,
          lineWidth: 1.6,
          blurScale: dpr * 0.6,
        });
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={ref} className="icon-gradient-preview" style={{ height: HEIGHT }} />;
}
