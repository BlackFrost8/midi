import { mixLch, shift, type Lch } from '../Oklch';
import type { GroundId } from '../Recipe';
import { level, quantiles, rgb, textureField, type Env, type RasterLayer } from './Kit';

/**
 * Backgrounds. Every one works on every tone: the two ends of the ground
 * (Ink.ground and Ink.groundFar) are paper and tint on light, void and deep
 * colour on dark, and the main colour and its scheme partner on colour.
 */
export function groundLayer(env: Env, id: GroundId): RasterLayer {
  switch (id) {
    case 'clouds':
      return clouds(env);
    case 'gradient':
      return gradient(env);
    case 'split':
      return split(env);
    case 'strata':
      return strata(env);
    case 'pixel':
      return pixel(env);
    default:
      return plain(env);
  }
}

/** Which way "a little more texture" goes on this tone. */
function stepDirection(env: Env): number {
  return env.tone === 'light' ? -1 : 1;
}

/** One flat tone with a faint second tone drifting through it. */
function plain(env: Env): RasterLayer {
  const g = env.ink.ground;
  const step = env.tone === 'dark' ? 0.02 : env.tone === 'light' ? -0.013 : 0.022;
  const tex = textureField(env);
  const [t] = quantiles(env, tex, [0.74]);
  return { colors: rgb([g, shift(g, step, 1.15, 2)]), sample: (x, y) => (tex(x, y) > t ? 1 : 0) };
}

/** Soft stepped clouds in one colour, with a lighter band drifting across. */
function clouds(env: Env): RasterLayer {
  const random = env.rng(10);
  const g = env.ink.ground;
  const s = stepDirection(env);
  const strong = env.tone === 'colour' ? 1 : 0.7;
  const colors: Lch[] = [
    shift(g, -0.028 * s * strong, 1.02, -2),
    g,
    shift(g, 0.022 * s * strong, env.tone === 'dark' ? 1.6 : 0.96, 2),
    shift(g, 0.045 * s * strong, env.tone === 'dark' ? 2.2 : 0.9, 4),
    shift(g, 0.085 * s * strong, env.tone === 'dark' ? 3 : 0.72, 7),
  ];

  const angle = random.range(-0.42, 0.18);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const bandCentre = random.range(0.3, 0.7);
  const bandWidth = random.range(0.1, 0.18);
  const bandGain = random.range(0.1, 0.2);
  const warp = 0.7 + env.design.mood.ambience * 0.7;
  const midX = env.A / 2;
  const { noise, detail } = env;

  const field = (x: number, y: number) => {
    const wx = noise.fbm(x * 0.9 + 5.2, y * 0.9 + 1.3, 3) - 0.5;
    const wy = noise.fbm(x * 0.9 - 3.1, y * 0.9 + 7.7, 3) - 0.5;
    const cloud = noise.fbm((x + wx * warp) * 1.5, (y + wy * warp) * 1.5, 6, 0.56, 3);
    const across = -sin * (x - midX) + cos * (y - 0.5) + 0.5;
    const band = Math.exp(-((across - bandCentre) ** 2) / (bandWidth * bandWidth));
    return cloud + band * bandGain + (detail.fbm(x * 10, y * 10, 2, 0.5, 0) - 0.5) * 0.04;
  };
  const thresholds = quantiles(env, field, [0.07, 0.78, 0.9, 0.965]);
  return { colors: rgb(colors), sample: (x, y) => level(field(x, y), thresholds) };
}

/** A stepped fade between the two ends of the ground, with ragged steps. */
function gradient(env: Env): RasterLayer {
  const random = env.rng(11);
  const steps = random.int(5, 8);
  const reverse = random.chance(0.5);
  const [from, to] = reverse ? [env.ink.groundFar, env.ink.ground] : [env.ink.ground, env.ink.groundFar];
  // A gradient you set runs through all its colours, in bands like a print.
  const stops = env.design.palette.gradient;
  const colors =
    stops.length >= 2
      ? Array.from({ length: Math.max(steps, stops.length * 2) }, (_, i) => {
          const count = Math.max(steps, stops.length * 2);
          const t = (i / (count - 1)) * (stops.length - 1);
          const k = Math.min(Math.floor(t), stops.length - 2);
          return mixLch(stops[k], stops[k + 1], t - k);
        })
      : Array.from({ length: steps }, (_, i) => mixLch(from, to, i / (steps - 1)));

  const angle = random.range(0, Math.PI * 2);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Normalise the projection so the fade spans the whole frame whatever the angle.
  const corners = [0, env.A].flatMap((x) => [0, 1].map((y) => x * dx + y * dy));
  const lo = Math.min(...corners);
  const hi = Math.max(...corners);
  const curve = random.range(0.7, 1.5);
  const { noise, detail } = env;

  return {
    colors: rgb(colors),
    sample: (x, y) => {
      const along = (x * dx + y * dy - lo) / (hi - lo);
      const ragged =
        (noise.fbm(x * 2.2 + 9.1, y * 2.2, 5, 0.55, 2) - 0.5) * 0.3 + (detail.fbm(x * 9, y * 9, 2, 0.5, 0) - 0.5) * 0.06;
      const t = Math.min(Math.max(Math.pow(Math.min(Math.max(along, 0), 1), curve) + ragged, 0), 0.9999);
      return Math.floor(t * colors.length);
    },
  };
}

/** Two fields meeting along a ragged line. */
function split(env: Env): RasterLayer {
  const random = env.rng(12);
  const px = env.A * random.range(0.35, 0.65);
  const py = random.range(0.35, 0.65);
  const angle = random.range(-1.1, 1.1);
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const roughness = random.range(0.15, 0.4);
  const a = env.ink.ground;
  const b = env.ink.groundFar;
  const step = env.tone === 'light' ? -0.015 : 0.02;
  const tex = textureField(env, 5);
  const [t] = quantiles(env, tex, [0.72]);
  const { noise, detail } = env;

  return {
    colors: rgb([a, shift(a, step, 1.1, 2), b, shift(b, step, 1.1, 2)]),
    sample: (x, y) => {
      const side =
        (x - px) * nx +
        (y - py) * ny +
        (noise.fbm(x * 1.8, y * 1.8 + 4.4, 5, 0.55, 2) - 0.5) * roughness +
        (detail.fbm(x * 12, y * 12, 2, 0.5, 0) - 0.5) * 0.04;
      return (side > 0 ? 2 : 0) + (tex(x, y) > t ? 1 : 0);
    },
  };
}

/** Horizontal bands like a horizon or rock strata, each edge torn. */
function strata(env: Env): RasterLayer {
  const random = env.rng(13);
  const bands = random.int(5, 8);
  const edges = Array.from({ length: bands - 1 }, () => random.range(0.08, 0.95)).sort((p, q) => p - q);
  const reverse = random.chance(0.5);
  const [from, to] = reverse ? [env.ink.groundFar, env.ink.ground] : [env.ink.ground, env.ink.groundFar];
  const colors = Array.from({ length: bands }, (_, i) => mixLch(from, to, Math.pow(i / (bands - 1), 1.3)));
  const tilt = random.range(-0.08, 0.08);
  const { noise, detail } = env;

  return {
    colors: rgb(colors),
    sample: (x, y) => {
      const yy =
        y +
        (x - env.A / 2) * tilt +
        (noise.fbm(x * 1.6 + 2.7, y * 3, 5, 0.55, 2) - 0.5) * 0.12 +
        (detail.fbm(x * 14, y * 14, 2, 0.5, 0) - 0.5) * 0.02;
      let band = 0;
      while (band < edges.length && yy > edges[band]) band++;
      return band;
    },
  };
}

/** Chunky pixels quantised from a cloud field — for chiptune and synth-led songs. */
function pixel(env: Env): RasterLayer {
  const random = env.rng(14);
  const cell = 1 / random.int(9, 16);
  const g = env.ink.ground;
  // Mostly the ground's own family; the main colour only in the brightest cells.
  const colors = rgb([
    g,
    shift(g, env.tone === 'light' ? -0.035 : 0.035, 1.1, 3),
    mixLch(g, env.ink.groundFar, 0.5),
    env.ink.groundFar,
    env.ink.main,
  ]);
  const { noise, detail } = env;
  const field = (x: number, y: number) => {
    const cx = (Math.floor(x / cell) + 0.5) * cell;
    const cy = (Math.floor(y / cell) + 0.5) * cell;
    // Smooth, clustered clouds of pixels — a little per-cell jitter, not static.
    return noise.fbm(cx * 1.4, cy * 1.4, 3, 0.5, 4) + (detail.value(cx * 53.1, cy * 47.7, true) - 0.5) * 0.04;
  };
  const thresholds = quantiles(env, field, [0.55, 0.8, 0.93, 0.985]);
  return { colors, sample: (x, y) => level(field(x, y), thresholds) };
}
