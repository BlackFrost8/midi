export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_SHORT = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_ALPHA = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function parseHex(hex: string): Rgb {
  const value = hex.trim();
  const alpha = HEX_ALPHA.exec(value);
  if (alpha) {
    return {
      r: parseInt(alpha[1], 16),
      g: parseInt(alpha[2], 16),
      b: parseInt(alpha[3], 16),
    };
  }
  const long = HEX_LONG.exec(value);
  if (long) {
    return { r: parseInt(long[1], 16), g: parseInt(long[2], 16), b: parseInt(long[3], 16) };
  }
  const short = HEX_SHORT.exec(value);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  return { r: 255, g: 255, b: 255 };
}

export function isValidHex(hex: string): boolean {
  const v = hex.trim();
  return HEX_SHORT.test(v) || HEX_LONG.test(v) || HEX_ALPHA.test(v);
}

function toHexPart(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`;
}

/** `rgba()` string from a hex colour plus an explicit alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}

export function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

/** Relative luminance (sRGB, gamma-corrected) — used to pick readable text. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Black or white, whichever reads better on the given background. */
export function readableTextOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#07090A' : '#F2F6F6';
}

/** Evenly spaced hues on a fixed saturation/lightness ring — used for auto-assigning track colours. */
export function hueRing(count: number, saturation = 0.55, lightness = 0.66, offset = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = (offset + (i * 360) / Math.max(count, 1)) % 360;
    out.push(hslToHex(hue, saturation, lightness));
  }
  return out;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = parseHex(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  return { h: ((h * 60) % 360 + 360) % 360, s, l };
}

/** Rotates hue while preserving saturation and lightness. */
export function rotateHue(hex: string, degrees: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}

/**
 * Pushes a colour further from the background — toward white on a dark theme,
 * toward black on a light one. Used for "this note is sounding right now".
 */
export function intensify(hex: string, onDarkBackground: boolean, amount = 0.5): string {
  return mix(hex, onDarkBackground ? '#ffffff' : '#000000', amount);
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}
