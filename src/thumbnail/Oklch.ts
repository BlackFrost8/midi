/**
 * OKLCH → sRGB, with gamut mapping by chroma reduction.
 *
 * The thumbnail palettes are built in OKLCH because lightness there is
 * perceptual: two colours at L 0.7 look equally light whatever their hue, which
 * is what makes a posterised cloud read as one soft surface rather than bands.
 */

export interface Rgb8 {
  r: number;
  g: number;
  b: number;
}

export interface Lch {
  l: number;
  c: number;
  h: number;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

function inGamut([r, g, b]: [number, number, number]): boolean {
  const e = 1e-4;
  return r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && b >= -e && b <= 1 + e;
}

/** Converts OKLCH to 8-bit sRGB, pulling chroma in until the colour fits. */
export function oklch(l: number, c: number, h: number): Rgb8 {
  const lightness = Math.max(0, Math.min(1, l));
  let chroma = Math.max(0, c);
  let linear = oklchToLinear(lightness, chroma, h);
  if (!inGamut(linear)) {
    let lo = 0;
    let hi = chroma;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(lightness, mid, h))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
    linear = oklchToLinear(lightness, chroma, h);
  }
  const to8 = (v: number) => Math.round(Math.max(0, Math.min(1, linearToSrgb(Math.max(0, v)))) * 255);
  return { r: to8(linear[0]), g: to8(linear[1]), b: to8(linear[2]) };
}

export function lchToRgb(color: Lch): Rgb8 {
  return oklch(color.l, color.c, color.h);
}

export function rgbCss({ r, g, b }: Rgb8, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lchCss(color: Lch, alpha = 1): string {
  return rgbCss(lchToRgb(color), alpha);
}

export function rgbHex({ r, g, b }: Rgb8): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance of an 8-bit colour. */
export function relativeLuminance({ r, g, b }: Rgb8): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Oranges, ambers and yellows turn to brown and olive when darkened, so they
 * have to stay light to stay luminous.
 */
export function isWarmHue(hue: number): boolean {
  const h = ((hue % 360) + 360) % 360;
  return h > 40 && h < 128;
}

/** Shifts an LCH colour; hue wraps, lightness and chroma clamp. */
export function shift(color: Lch, dl = 0, dcScale = 1, dh = 0): Lch {
  return {
    l: Math.max(0, Math.min(1, color.l + dl)),
    c: Math.max(0, color.c * dcScale),
    h: (((color.h + dh) % 360) + 360) % 360,
  };
}

function srgbToLinear(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 8-bit sRGB → OKLCH. */
export function rgbToLch({ r, g, b }: Rgb8): Lch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: Math.hypot(a, bb), h };
}

export function hexToLch(hex: string): Lch {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!match) return { l: 0.7, c: 0.1, h: 0 };
  return rgbToLch({ r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) });
}

export function lchHex(color: Lch): string {
  return rgbHex(lchToRgb(color));
}

/** Blends two colours through OKLab, so the midpoint never detours through grey or a third hue. */
export function mixLch(from: Lch, to: Lch, t: number): Lch {
  const ra = (from.h * Math.PI) / 180;
  const rb = (to.h * Math.PI) / 180;
  const a = from.c * Math.cos(ra) + (to.c * Math.cos(rb) - from.c * Math.cos(ra)) * t;
  const b = from.c * Math.sin(ra) + (to.c * Math.sin(rb) - from.c * Math.sin(ra)) * t;
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: from.l + (to.l - from.l) * t, c: Math.hypot(a, b), h };
}
