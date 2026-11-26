import { clamp } from '../../utils/math';
import type { CellSample, Random } from '../Noise';
import { isWarmHue, lchCss, lchToRgb, mixLch, rgbCss, shift, type Lch } from '../Oklch';
import type { SubjectId } from '../Recipe';
import {
  bloomField,
  clearance,
  inside,
  lineCss,
  rgb,
  type Bloom,
  type Env,
  type Field,
  type RasterLayer,
  type Rect,
} from './Kit';

/**
 * Shapes. Each returns a per-pixel layer, a vector drawing, or both, and says
 * where its focal point is so the title and any second shape can keep clear.
 */

export interface SubjectInput {
  anchor: { x: number; y: number };
  scale: number;
  mirror: boolean;
  /** Where the shape should live, in frame units. */
  bounds: Rect;
  /** Kept clear for the title. */
  quiet: Rect | null;
  /** The main shape, when this is the second one. */
  primary: SubjectResult | null;
  random: Random;
}

export interface SubjectResult {
  raster?: RasterLayer;
  draw?: () => void;
  focal: { x: number; y: number; r: number };
  /** Positive inside the shape's main body, for arcs hung on its edge. */
  outline?: Field;
  /** Round shapes, so a ring can pass behind them. */
  disk?: { x: number; y: number; r: number };
  /** Containers (the frame): where a second shape belongs. */
  inner?: Rect;
}

export function buildSubject(env: Env, id: SubjectId, input: SubjectInput): SubjectResult | null {
  switch (id) {
    case 'bloom':
      return bloom(env, input);
    case 'tear':
      return tear(env, input);
    case 'mass':
      return mass(env, input);
    case 'islands':
      return islands(env, input);
    case 'moon':
      return moon(env, input);
    case 'sun':
      return sun(env, input);
    case 'pillar':
      return pillar(env, input);
    case 'crackle':
      return crackle(env, input);
    case 'shards':
      return shards(env, input);
    case 'frame':
      return frame(env, input);
    case 'glyphs':
      return glyphs(env, input);
    case 'contour':
      return contour(env, input);
    case 'skyline':
      return skyline(env, input);
    case 'ring':
      return ring(env, input);
    default:
      return null;
  }
}

/** Scattered drops around a shape's edge: −1 where there is none. */
function drops(env: Env, f: number, x: number, y: number, reach = 0.28, density = 0.8): boolean {
  return f > -reach && env.detail.fbm(x * 15 + 3.3, y * 15 - 1.7, 3, 0.5, 0) > density - (f + reach) * 0.14;
}

function speck(env: Env, x: number, y: number, threshold = 0.55): boolean {
  return env.detail.value(x * 34, y * 34, true) > threshold;
}

/** Flat colour for solid shapes: deep on paper, vivid elsewhere. */
function solid(env: Env): Lch {
  return env.tone === 'light' ? env.ink.deep : env.ink.main;
}

// ---------------------------------------------------------------------------
// Per-pixel shapes
// ---------------------------------------------------------------------------

/** A ragged ink bloom: soft halo, body, and a darker (or brighter) heart. */
function bloom(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const size = s.scale * (s.primary ? 0.5 : 1);
  const side = s.mirror ? -1 : 1;
  const edge = s.anchor.y < 0.25 || s.anchor.y > 0.8;
  const kind = edge ? 'edge' : r.pick(env.design.mood.energy > 0.5 ? ['streak', 'streak', 'island'] : ['island', 'streak']);
  const shape: Bloom =
    kind === 'edge'
      ? { cx: s.anchor.x, cy: s.anchor.y, rx: 0.62 * size, ry: 0.42 * size, angle: r.range(-0.6, -0.2) * side, warp: 1.5, detail: 0.35 }
      : kind === 'streak'
        ? { cx: s.anchor.x, cy: s.anchor.y, rx: r.range(0.5, 0.62) * size, ry: r.range(0.12, 0.17) * size, angle: r.range(-0.65, -0.35) * side, warp: 1.4, detail: 0.35 }
        : { cx: s.anchor.x, cy: s.anchor.y, rx: r.range(0.3, 0.37) * size, ry: r.range(0.25, 0.31) * size, angle: r.range(-0.5, 0.5), warp: 1.6, detail: 0.4 };

  const { ink } = env;
  const warm = isWarmHue(env.design.palette.base.h);
  const core =
    env.tone === 'dark'
      ? ink.light
      : warm || env.design.mood.valence > 0.55
        ? shift(ink.main, env.tone === 'light' ? 0.07 : 0.05, 0.85, 4)
        : ink.deep;
  const field = bloomField(env, shape);
  return {
    raster: {
      colors: rgb([ink.halo, mixLch(ink.ground, ink.main, 0.45), ink.main, core]),
      sample: (x, y) => {
        const f = field(x, y);
        if (f > 0.5) return 3;
        if (f > 0.22) return 2;
        if (f > 0.06) return 1;
        if (f > -0.06 && speck(env, x, y)) return 0;
        if (drops(env, f, x, y)) return 2;
        return -1;
      },
    },
    focal: { x: shape.cx, y: shape.cy, r: Math.max(shape.rx, shape.ry) },
    outline: field,
  };
}

/** A long, flat, ragged tear across the frame. */
function tear(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const size = s.scale * (s.primary ? 0.5 : 1);
  const shape: Bloom = {
    cx: s.anchor.x,
    cy: clamp(s.anchor.y - 0.1, 0.25, 0.6),
    rx: r.range(0.68, 0.85) * size,
    ry: r.range(0.12, 0.18) * size,
    angle: r.range(-0.62, -0.38) * (s.mirror ? -1 : 1),
    warp: 1.5,
    detail: 0.35,
  };
  return flatShape(env, shape);
}

/** A flat mass rising from the bottom edge, or hanging from the top. */
function mass(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const size = s.scale * (s.primary ? 0.55 : 1);
  const fromTop = s.anchor.y < 0.3;
  const shape: Bloom = {
    cx: s.anchor.x,
    cy: fromTop ? r.range(-0.08, 0.02) : r.range(0.96, 1.05),
    rx: r.range(0.55, 0.68) * size,
    ry: r.range(0.42, 0.5) * size,
    angle: r.range(-0.35, -0.1) * (s.mirror ? -1 : 1),
    warp: 1.7,
    detail: 0.4,
  };
  const result = flatShape(env, shape);
  result.focal = { x: shape.cx, y: fromTop ? 0.25 : 0.75, r: shape.rx * 0.8 };
  return result;
}

function flatShape(env: Env, shape: Bloom): SubjectResult {
  const field = bloomField(env, shape);
  const body = solid(env);
  return {
    raster: {
      colors: rgb([env.ink.halo, body, shift(body, env.tone === 'light' ? 0.1 : 0.06, 0.88, 7)]),
      sample: (x, y) => {
        const f = field(x, y);
        if (f > 0 && f < 0.12 && env.detail.value(x * 22, y * 22, true) > 0.78) return 2;
        if (f > 0) return 1;
        if (f > -0.08 && speck(env, x, y, 0.6)) return 0;
        if (drops(env, f, x, y, 0.3, 0.81)) return 1;
        return -1;
      },
    },
    focal: { x: shape.cx, y: shape.cy, r: Math.max(shape.rx, shape.ry) * 0.7 },
    outline: field,
  };
}

/** A scattered archipelago of small torn shapes. */
function islands(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const around = s.primary?.focal;
  const count = around ? r.int(3, 6) : r.int(5, 9);
  const pieces: Array<{ field: Field; cx: number; cy: number; reach: number; color: number }> = [];
  for (let i = 0; i < count * 3 && pieces.length < count; i++) {
    let cx: number;
    let cy: number;
    // On its own, one large island anchors the group and the rest scatter round it.
    const mother = !around && pieces.length === 0;
    if (around) {
      const angle = r.range(0, Math.PI * 2);
      const distance = around.r * r.range(1.15, 1.9) + 0.05;
      cx = around.x + Math.cos(angle) * distance;
      cy = around.y + Math.sin(angle) * distance * 0.8;
    } else if (mother) {
      cx = s.anchor.x;
      cy = s.anchor.y;
    } else {
      cx = s.anchor.x + r.range(-0.45, 0.45) * s.scale;
      cy = s.anchor.y + r.range(-0.34, 0.34) * s.scale;
    }
    const size = (mother ? r.range(0.13, 0.19) : r.range(0.035, around ? 0.07 : 0.1)) * s.scale;
    if (inside(s.quiet, cx, cy) || cx < 0.03 || cx > env.A - 0.03 || cy < 0.04 || cy > 0.96) continue;
    const shape: Bloom = { cx, cy, rx: size * r.range(0.8, 1.6), ry: size, angle: r.range(-1, 1), warp: 1.2, detail: 0.4, offset: i * 13.7 };
    pieces.push({ field: bloomField(env, shape), cx, cy, reach: Math.max(shape.rx, shape.ry) * 2, color: r.chance(0.25) ? 1 : 0 });
  }
  return {
    raster: {
      colors: rgb([solid(env), env.ink.accent]),
      sample: (x, y) => {
        for (const piece of pieces) {
          if (Math.abs(x - piece.cx) > piece.reach || Math.abs(y - piece.cy) > piece.reach) continue;
          if (piece.field(x, y) > 0) return piece.color;
        }
        return -1;
      },
    },
    focal: around ?? { x: s.anchor.x, y: s.anchor.y, r: 0.3 * s.scale },
  };
}

/** A moon with stepped shading, shedding a stream of fragments. */
function moon(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const secondary = Boolean(s.primary);
  const radius = (secondary ? r.range(0.09, 0.13) : r.range(0.24, 0.3)) * s.scale;
  const { x: cx, y: cy } = s.anchor;
  const base = env.design.palette.base;
  const body: Lch =
    env.tone === 'dark'
      ? { l: 0.62, c: Math.max(0.1, base.c), h: base.h }
      : env.tone === 'light'
        ? isWarmHue(base.h)
          ? { l: 0.68, c: Math.max(0.13, base.c * 1.2), h: base.h }
          : { l: 0.36, c: Math.max(0.1, base.c * 1.1), h: base.h }
        : env.ink.main;
  const streamAngle = r.range(0.2, 1.2) * (cx > env.A / 2 ? 1 : -1) + (cx > env.A / 2 ? 0 : Math.PI);
  const sdx = Math.cos(streamAngle);
  const sdy = Math.sin(streamAngle);
  const debris = !secondary && r.chance(0.75);
  const { noise, detail } = env;

  return {
    raster: {
      colors: rgb([shift(body, -0.12, 1.05, -8), body, shift(body, 0.14, 0.8, 10)]),
      sample: (x, y) => {
        const dx = (x - cx) / radius;
        const dy = (y - cy) / radius;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1 + (detail.fbm(x * 12, y * 12, 3, 0.5, 0) - 0.5) * 0.09) {
          const nz = Math.sqrt(Math.max(0, 1 - Math.min(d, 1) ** 2));
          const light = dx * -0.55 + dy * -0.6 + nz * 0.58;
          const value = light * 0.7 + (noise.fbm(x * 4.5, y * 4.5, 5, 0.55, 2) - 0.5) * 1.1;
          return value < 0.02 ? 0 : value < 0.5 ? 1 : 2;
        }
        if (!debris) return -1;
        const ox = x - cx;
        const oy = y - cy;
        const along = ox * sdx + oy * sdy;
        if (along < radius * 0.6) return -1;
        const across = -ox * sdy + oy * sdx;
        const spread = 0.08 + (along - radius) * 0.35;
        const stream = Math.exp(-(across * across) / (spread * spread)) * Math.exp(-Math.max(along - radius, 0) / 0.55);
        if (stream * detail.fbm(x * 18, y * 18, 3, 0.5, 0) > 0.42 - stream * 0.12) return along < radius * 1.5 ? 1 : 0;
        return -1;
      },
    },
    focal: { x: cx, y: cy, r: radius },
    disk: { x: cx, y: cy, r: radius },
    outline: (x, y) => 1 - Math.hypot(x - cx, y - cy) / radius,
  };
}

/** A sun with a stepped, ragged corona fading into the ground. */
function sun(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const secondary = Boolean(s.primary);
  const radius = (secondary ? r.range(0.07, 0.11) : r.range(0.16, 0.22)) * s.scale;
  const { x: cx, y: cy } = s.anchor;
  const disc = env.tone === 'light' ? env.ink.main : env.ink.light;
  const rings = [1.22, 1.5, 1.88].map((step) => step + r.range(-0.05, 0.05));
  const { noise } = env;
  return {
    raster: {
      colors: rgb([disc, mixLch(disc, env.ink.ground, 0.38), mixLch(disc, env.ink.ground, 0.62), mixLch(disc, env.ink.ground, 0.82)]),
      sample: (x, y) => {
        const d = Math.hypot(x - cx, y - cy) / radius + (noise.fbm(x * 3.2, y * 3.2, 5, 0.55, 2) - 0.5) * 0.28;
        if (d < 1) return 0;
        for (let i = 0; i < rings.length; i++) if (d < rings[i]) return i + 1;
        return -1;
      },
    },
    focal: { x: cx, y: cy, r: radius * 1.6 },
    disk: { x: cx, y: cy, r: radius },
    outline: (x, y) => 1 - Math.hypot(x - cx, y - cy) / (radius * rings[2]),
  };
}

/** A tall ragged column of light. */
function pillar(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const cx = s.anchor.x;
  const width = r.range(0.07, 0.13) * s.scale * (s.primary ? 0.6 : 1);
  const fadeTop = r.chance(0.5) ? r.range(0.05, 0.35) : -1;
  const { noise, detail, ink } = env;
  const body = env.tone === 'light' ? ink.deep : ink.main;
  return {
    raster: {
      colors: rgb([ink.halo, body, env.tone === 'light' ? ink.main : ink.light]),
      sample: (x, y) => {
        const sway = (noise.fbm(y * 2.5 + 3.1, cx * 2 + 7.7, 4) - 0.5) * 0.16 + (detail.fbm(x * 12, y * 12, 2, 0.5, 0) - 0.5) * 0.025;
        let f = 1 - Math.abs(x - cx - sway) / width;
        if (fadeTop > 0 && y < fadeTop) f -= (fadeTop - y) * 4;
        if (f > 0.6) return 2;
        if (f > 0.12) return 1;
        if (f > -0.35 && speck(env, x, y, 0.62)) return 0;
        return -1;
      },
    },
    focal: { x: cx, y: 0.5, r: width * 1.5 },
    outline: (x) => 1 - Math.abs(x - cx) / width,
  };
}

/** A crack network over a ragged region, a few cells lit. */
function crackle(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const region: Bloom = {
    cx: s.anchor.x,
    cy: clamp(s.anchor.y, 0.4, 0.6),
    rx: env.A * r.range(0.3, 0.36) * s.scale * (s.primary ? 0.5 : 1),
    ry: r.range(0.38, 0.46) * s.scale * (s.primary ? 0.5 : 1),
    angle: r.range(-0.4, 0.4),
    warp: 1.3,
    detail: 0.2,
  };
  const mask = bloomField(env, region);
  const mood = env.design.mood;
  const scale = 7 + mood.density * 4 + r.range(0, 1.5);
  const fillChance = 0.03 + mood.tension * 0.03;
  const cell: CellSample = { f1: 0, f2: 0, id: 0 };
  const { noise, detail, ink } = env;

  return {
    raster: {
      colors: [ink.line, lchToRgb(solid(env)), lchToRgb(ink.accent)],
      sample: (x, y) => {
        let m = mask(x, y);
        if (m < -0.15) return -1;
        // The cracks run out before they reach the title, along a ragged edge.
        m = Math.min(m, clearance(s.quiet, x, y) * 3 - 0.3 + (detail.fbm(x * 4, y * 4, 3) - 0.5) * 0.2);
        if (m < -0.15) return -1;
        const wx = x + (noise.fbm(x * 1.5 + 2.2, y * 1.5, 4) - 0.5) * 0.45;
        const wy = y + (noise.fbm(x * 1.5, y * 1.5 + 9.1, 4) - 0.5) * 0.45;
        noise.cellular(wx * scale, wy * scale, cell);
        const width = 0.035 + 0.055 * detail.fbm(x * 3, y * 3, 3, 0.5, 1);
        const edge = cell.f2 - cell.f1;
        if (m < 0) return edge < width * 0.55 && detail.fbm(x * 6, y * 6, 2) > 0.55 ? 0 : -1;
        if (edge < width) return 0;
        if (cell.id < fillChance) return cell.id < fillChance * 0.45 ? 2 : 1;
        return -1;
      },
    },
    focal: { x: region.cx, y: region.cy, r: region.ry },
  };
}

/** A lit double border around a window of ground. */
function frame(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const { ink, noise, A } = env;
  const base = env.design.palette.base;
  const lit: Lch = env.tone === 'dark' ? { l: 0.68, c: Math.max(0.17, base.c * 1.3), h: base.h } : solid(env);
  const margin = r.range(0.065, 0.085);
  const band = r.range(0.026, 0.034);
  const gap = band * r.range(0.4, 0.55);
  const line = band * r.range(0.26, 0.34);
  const inner = band + gap + line;
  const tilt = r.range(0.3, 0.7);
  const glow = (x: number, y: number) => (x / A) * tilt + y * (1 - tilt) + (noise.fbm(x * 3, y * 3, 5, 0.55, 2) - 0.5) * 0.9;
  const colors = [shift(lit, -0.07, 1.04, -10), lit, shift(lit, 0.06, 0.95, 10), mixLch(lit, ink.accent, 0.55)];

  const draw = () => {
    if (env.tone !== 'dark') return;
    // Light spill: stroke just outside a clip so only the blur lands inside.
    const { ctx, W, H } = env;
    const spill = lchCss(lit, 0.55);
    const o = { x: margin * H, y: margin * H, w: W - 2 * margin * H, h: H - 2 * margin * H };
    ctx.save();
    ctx.beginPath();
    ctx.rect(o.x + inner * H, o.y + inner * H, o.w - 2 * inner * H, o.h - 2 * inner * H);
    ctx.clip();
    ctx.shadowColor = spill;
    ctx.shadowBlur = 0.06 * H;
    ctx.strokeStyle = spill;
    ctx.lineWidth = 0.01 * H;
    const k = (inner - 0.006) * H;
    ctx.strokeRect(o.x + k, o.y + k, o.w - 2 * k, o.h - 2 * k);
    ctx.restore();
  };

  return {
    raster: {
      colors: rgb(colors),
      sample: (x, y) => {
        const d = Math.min(x - margin, A - margin - x, y - margin, 1 - margin - y);
        if (d >= 0 && (d < band || (d >= band + gap && d < inner))) {
          const g = glow(x, y);
          return g < 0.35 ? 0 : g < 0.62 ? 1 : g < 0.85 ? 2 : 3;
        }
        return -1;
      },
    },
    draw,
    focal: { x: A / 2, y: 0.5, r: 0.5 },
    inner: { x0: margin + inner + 0.05, y0: margin + inner + 0.05, x1: A - margin - inner - 0.05, y1: 1 - margin - inner - 0.05 },
  };
}

// ---------------------------------------------------------------------------
// Vector shapes
// ---------------------------------------------------------------------------

/** Shards flung from a vortex: small and dense at the eye, long at the rim. */
function shards(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const { cx, cy } = { cx: s.anchor.x, cy: s.anchor.y };
  const mood = env.design.mood;
  const count = Math.round((420 + mood.density * 650 + mood.energy * 350) * (s.primary ? 0.35 : 1));
  const reach = Math.hypot(Math.max(cx, env.A - cx), Math.max(cy, 1 - cy)) * (s.primary ? 0.5 : 1.05);
  const swirl = r.range(-0.9, 0.9);
  const tintChance = 0.1 + mood.tension * 0.12;
  const voidSeed = r.range(0, 50);
  const pieces = Array.from({ length: count }, () => ({
    radius: Math.pow(r.next(), 1.5) * reach,
    theta: r.range(0, Math.PI * 2),
    length: r.range(0.4, 1.35),
    width: r.range(0.16, 0.36),
    alpha: r.next(),
    tint: r.chance(tintChance),
    skew: r.range(-0.25, 0.25),
  }));

  const draw = () => {
    const { ctx, H, noise, ink } = env;
    const eye = ctx.createRadialGradient(cx * H, cy * H, 0, cx * H, cy * H, 0.42 * H);
    eye.addColorStop(0, lchCss(ink.accent, env.tone === 'light' ? 0.2 : 0.36));
    eye.addColorStop(1, lchCss(ink.accent, 0));
    ctx.fillStyle = eye;
    ctx.fillRect(0, 0, env.W, H);
    const tint = { l: env.tone === 'light' ? 0.55 : 0.78, c: ink.accent.c, h: ink.accent.h };
    for (const piece of pieces) {
      const theta = piece.theta + piece.radius * swirl;
      const x = cx + Math.cos(theta) * piece.radius;
      const y = cy + Math.sin(theta) * piece.radius;
      if (x < -0.1 || x > env.A + 0.1 || y < -0.1 || y > 1.1) continue;
      if (piece.radius > 0.12 && noise.fbm(x * 1.3 + voidSeed, y * 1.3, 4) < 0.42) continue;
      if (inside(s.quiet, x, y) && piece.alpha > 0.08) continue;
      const length = (0.005 + piece.radius * 0.1) * piece.length;
      const width = length * piece.width;
      const direction = theta + piece.skew * 0.4;
      const dx = Math.cos(direction);
      const dy = Math.sin(direction);
      const alpha = (0.3 + 0.7 * piece.alpha) * (piece.radius < 0.06 ? 0.6 : 1);
      ctx.fillStyle = piece.tint ? lchCss(tint, alpha) : rgbCss(ink.line, alpha);
      ctx.beginPath();
      ctx.moveTo((x + dx * length * 0.5) * H, (y + dy * length * 0.5) * H);
      ctx.lineTo((x - dx * length * 0.1 - dy * width * 0.5) * H, (y - dy * length * 0.1 + dx * width * 0.5) * H);
      ctx.lineTo((x - dx * length * 0.5) * H, (y - dy * length * 0.5) * H);
      ctx.lineTo((x - dx * length * 0.05 + dy * width * 0.5) * H, (y - dy * length * 0.05 - dx * width * 0.5) * H);
      ctx.closePath();
      ctx.fill();
    }
  };
  return { draw, focal: { x: cx, y: cy, r: 0.3 } };
}

/** The melody as rows of glyphs: loud notes solid, soft ones hollow, long ones larger, downbeats boxed. */
function glyphs(env: Env, s: SubjectInput): SubjectResult {
  const notes = env.design.material.melody;
  const b = s.bounds;
  const draw = () => {
    if (!notes.length) return;
    const { ctx, H, ink } = env;
    const rows = notes.length > 24 ? 3 : notes.length > 12 ? 2 : 1;
    const cols = Math.ceil(notes.length / rows);
    const left = b.x0 + 0.03;
    const right = b.x1 - 0.03;
    const rowHeight = (b.y1 - b.y0) / rows;
    const cell = (right - left) / Math.max(cols - 1, 1);
    const glyph = Math.min(cell * 0.3, rowHeight * 0.22, 0.04);
    const colour = lineCss(env, 0.95);
    const lit = lchCss(ink.accent);
    const lineWidth = Math.max(1, 0.0026 * H);

    for (let row = 0; row < rows; row++) {
      const slice = notes.slice(row * cols, (row + 1) * cols);
      if (!slice.length) continue;
      const pitches = slice.map((note) => note.pitch).sort((p, q) => p - q);
      const median = pitches[Math.floor(pitches.length / 2)];
      const loudest = slice.reduce((best, note, i) => (note.velocity > slice[best].velocity ? i : best), 0);
      const centreY = b.y0 + rowHeight * (row + 0.5);
      const points = slice.map((note, i) => ({
        x: left + i * cell,
        y: centreY - clamp((note.pitch - median) / 12, -1, 1) * rowHeight * 0.26,
        r: glyph * (0.55 + 0.45 * note.length),
      }));

      // Connectors stop short of each glyph instead of running under it.
      ctx.strokeStyle = lineCss(env, 0.4);
      ctx.lineWidth = lineWidth * 0.8;
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1];
        const q = points[i];
        const length = Math.hypot(q.x - p.x, q.y - p.y);
        if (length <= p.r * 1.3 + q.r * 1.3) continue;
        const ux = (q.x - p.x) / length;
        const uy = (q.y - p.y) / length;
        ctx.beginPath();
        ctx.moveTo((p.x + ux * p.r * 1.3) * H, (p.y + uy * p.r * 1.3) * H);
        ctx.lineTo((q.x - ux * q.r * 1.3) * H, (q.y - uy * q.r * 1.3) * H);
        ctx.stroke();
      }

      slice.forEach((note, i) => {
        const { x, y } = points[i];
        const radius = points[i].r * H;
        const style = i === loudest ? lit : colour;
        ctx.strokeStyle = style;
        ctx.fillStyle = style;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        if (note.velocity > 0.78) {
          ctx.arc(x * H, y * H, radius * 0.62, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x * H, y * H, radius, 0, Math.PI * 2);
          ctx.stroke();
        } else if (note.velocity > 0.55) {
          ctx.arc(x * H, y * H, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x * H, y * H, Math.max(radius * 0.2, lineWidth), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.arc(x * H, y * H, radius * 0.8, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (note.downbeat) {
          const box = radius * 1.45;
          ctx.lineWidth = lineWidth * 0.8;
          ctx.strokeRect(x * H - box, y * H - box, box * 2, box * 2);
        }
      });
    }
  };
  return { draw, focal: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, r: 0.3 } };
}

/** The melody as a stepped line with fading echoes beneath it, like contour lines. */
function contour(env: Env, s: SubjectInput): SubjectResult {
  const notes = env.design.material.melody;
  const r = s.random;
  const b = s.bounds;
  const echoes = r.int(2, 5);
  const gap = r.range(0.022, 0.04);
  const draw = () => {
    if (!notes.length) return;
    const { ctx, H, ink } = env;
    const pitches = notes.map((note) => note.pitch);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches, low + 6);
    // A line, not a wall: cap its height and centre it in the space.
    const height = Math.min(Math.max(b.y1 - b.y0 - gap * echoes - 0.04, 0.08), 0.26);
    const top = (b.y0 + b.y1) / 2 - (height + gap * echoes) / 2;
    const xOf = (t: number) => b.x0 + t * (b.x1 - b.x0);
    const yOf = (pitch: number) => top + (1 - (pitch - low) / (high - low)) * height;
    const path = () => {
      ctx.beginPath();
      notes.forEach((note, i) => {
        const x0 = xOf(note.time) * H;
        const x1 = xOf(Math.min(note.time + note.span, i + 1 < notes.length ? notes[i + 1].time : 1)) * H;
        const y = yOf(note.pitch) * H;
        if (i === 0) ctx.moveTo(x0, y);
        else ctx.lineTo(x0, y);
        ctx.lineTo(x1, y);
      });
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let e = echoes; e >= 1; e--) {
      ctx.save();
      ctx.translate(0, e * gap * H);
      ctx.strokeStyle = lchCss(mixLch(ink.main, ink.ground, 0.25 + (e / echoes) * 0.55));
      ctx.lineWidth = Math.max(1, 0.004 * H);
      path();
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = lchCss(env.tone === 'light' ? ink.deep : ink.light);
    ctx.lineWidth = Math.max(2, 0.011 * H);
    path();
    ctx.stroke();
    ctx.restore();
  };
  return { draw, focal: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, r: 0.3 } };
}

/** How busy each bar is, intro to outro, as a skyline of stacked cells. */
function skyline(env: Env, s: SubjectInput): SubjectResult {
  const activity = env.design.material.activity;
  const b = s.bounds;
  const draw = () => {
    if (!activity.length) return;
    const { ctx, H, ink } = env;
    const columns = activity.length;
    const step = (b.x1 - b.x0) / columns;
    const cellsTall = 12;
    const cell = (b.y1 - b.y0) / cellsTall;
    const pad = Math.min(step, cell) * 0.16;
    const peak = activity.indexOf(Math.max(...activity));
    activity.forEach((value, i) => {
      const stack = Math.max(1, Math.round(value * cellsTall));
      for (let k = 0; k < stack; k++) {
        const x = b.x0 + i * step;
        const y = b.y1 - (k + 1) * cell;
        const colour = i === peak && k === stack - 1 ? ink.accent : mixLch(ink.main, ink.light, k / cellsTall);
        ctx.fillStyle = lchCss(colour);
        ctx.fillRect((x + pad) * H, (y + pad) * H, (step - pad * 2) * H, (cell - pad * 2) * H);
      }
    });
  };
  return { draw, focal: { x: (b.x0 + b.x1) / 2, y: b.y1 - 0.15, r: 0.25 } };
}

/** A tilted glowing ring, passing behind whatever round shape it circles. */
function ring(env: Env, s: SubjectInput): SubjectResult {
  const r = s.random;
  const disk = s.primary?.disk ?? null;
  const cx = disk ? disk.x : s.anchor.x;
  const cy = disk ? disk.y : s.anchor.y;
  const radius = disk ? disk.r : r.range(0.18, 0.26) * s.scale;
  const rx = radius * r.range(1.65, 1.95);
  const ry = radius * r.range(0.24, 0.36);
  const tilt = r.range(-0.38, -0.12) * (cx > env.A / 2 ? 1 : -1);
  const draw = () => {
    const { ctx, H, ink } = env;
    const dark = env.tone !== 'light';
    ctx.save();
    ctx.lineWidth = Math.max(1.2, 0.0045 * H);
    ctx.strokeStyle = dark ? lineCss(env, 0.92) : lchCss({ l: 0.42, c: ink.accent.c, h: ink.accent.h }, 0.9);
    ctx.shadowColor = lchCss(ink.accent, dark ? 0.8 : 0.35);
    ctx.shadowBlur = 0.025 * H;
    const arc = (from: number, to: number) => {
      ctx.beginPath();
      ctx.ellipse(cx * H, cy * H, rx * H, ry * H, tilt, from, to);
      ctx.stroke();
    };
    if (disk) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, env.W, H);
      ctx.arc(cx * H, cy * H, radius * H * 1.01, 0, Math.PI * 2);
      ctx.clip('evenodd');
      arc(Math.PI, Math.PI * 2);
      ctx.restore();
      arc(0, Math.PI);
    } else {
      arc(0, Math.PI * 2);
    }
    ctx.restore();
  };
  return { draw, focal: { x: cx, y: cy, r: rx } };
}
