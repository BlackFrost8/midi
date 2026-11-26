import { clamp } from '../utils/math';
import { createRandom, mixSeed } from './Noise';
import { hexToLch, isWarmHue, type Lch } from './Oklch';
import type { SongMood } from './SongMood';

/**
 * The thumbnail's colours: derived from the song, then adjusted by whatever the
 * user set in the Colour section.
 */

export type ColourScheme = 'auto' | 'mono' | 'analogous' | 'complementary' | 'split' | 'triadic';
export type GroundTone = 'light' | 'dark' | 'colour';
export type TextColour = 'auto' | 'white' | 'dark' | 'accent' | 'custom';
/** What the gradient colours. */
export type GradientTarget = 'background' | 'primary' | 'secondary' | 'details' | 'title';
export type GradientDirection = 'horizontal' | 'vertical' | 'diagonal';

export const GRADIENT_TARGETS: Array<{ id: GradientTarget; name: string }> = [
  { id: 'background', name: 'Background' },
  { id: 'primary', name: 'Main shape' },
  { id: 'secondary', name: 'Second shape' },
  { id: 'details', name: 'Details' },
  { id: 'title', name: 'Title' },
];

export interface ColourOptions {
  scheme: ColourScheme;
  /** Exact main colour, or null to derive it from the song. */
  main: string | null;
  /** Exact accent colour, or null to derive it from the scheme. */
  accent: string | null;
  /**
   * The colour the thumbnail starts from when no main colour is typed: the
   * accent chosen in the Colour tab. null falls back to the song's key.
   */
  defaultMain?: string | null;
  /** Two to five colours for gradient backgrounds; empty derives them. */
  gradient?: string[];
  /** What the gradient is applied to. */
  gradientTargets?: GradientTarget[];
  gradientDirection?: GradientDirection;
  ground: GroundTone | 'auto';
  /** Degrees added to the derived hue. */
  hueShift: number;
  /** Chroma multiplier for derived colours. */
  vividness: number;
  /** Lightness offset for derived colours. */
  lightness: number;
  text: TextColour;
}

export const DEFAULT_COLOUR_OPTIONS: ColourOptions = {
  scheme: 'auto',
  main: null,
  accent: null,
  defaultMain: null,
  gradient: [],
  gradientTargets: ['background'],
  gradientDirection: 'diagonal',
  ground: 'auto',
  hueShift: 0,
  vividness: 1,
  lightness: 0,
  text: 'auto',
};

export const SCHEMES: Array<{ id: ColourScheme; name: string }> = [
  { id: 'auto', name: 'Auto' },
  { id: 'mono', name: 'Mono' },
  { id: 'analogous', name: 'Analogous' },
  { id: 'complementary', name: 'Complementary' },
  { id: 'split', name: 'Split' },
  { id: 'triadic', name: 'Triadic' },
];

/** One-click starting points, each layered over the song's own colours. */
export const PALETTE_PRESETS: Array<{ id: string; name: string; options: Partial<ColourOptions> }> = [
  { id: 'song', name: 'Song', options: {} },
  { id: 'pastel', name: 'Pastel', options: { lightness: 0.12, vividness: 0.6, ground: 'light' } },
  { id: 'deep', name: 'Deep', options: { lightness: -0.12, vividness: 1.25, ground: 'dark' } },
  { id: 'neon', name: 'Neon', options: { vividness: 1.6, ground: 'dark', scheme: 'complementary' } },
  { id: 'mono', name: 'Mono', options: { scheme: 'mono', vividness: 0.8 } },
  { id: 'triad', name: 'Triad', options: { scheme: 'triadic', ground: 'colour', vividness: 1.15 } },
  { id: 'dusk', name: 'Dusk', options: { scheme: 'split', lightness: -0.06, vividness: 0.85 } },
  { id: 'bright', name: 'Bright', options: { lightness: 0.08, vividness: 1.35, ground: 'colour' } },
];

export interface ThumbPalette {
  base: Lch;
  accent: Lch;
  /** A third colour from the scheme, for gradients, splits and fragments. */
  third: Lch;
  scheme: Exclude<ColourScheme, 'auto'>;
  /** Where the main hue came from, e.g. "E minor" or "title: crimson". */
  hueSource: string;
  hueName: string;
  /** A ground tone the user or the title asked for; null lets the design choose. */
  tone: GroundTone | null;
  /** The user typed this main colour; renderers use it as it is. */
  exactMain: boolean;
  /** Stops for gradient backgrounds, when the user set them and aimed them at the background. */
  gradient: Lch[];
  /** The gradient's stops whatever it is aimed at, for colouring shapes and the title. */
  gradientStops: Lch[];
  /** The user typed this accent colour; renderers use it as it is. */
  exactAccent: boolean;
}

/**
 * Colour from key, mood and title, then the user's adjustments.
 *
 * The key's tonic sets the hue by walking the circle of fifths round the colour
 * wheel (C red, G orange, D gold, A chartreuse, E green… F rose), so related
 * keys get related colours. Energy sets how vivid it is, valence how light. A
 * colour word in the title overrides the hue.
 */
export function buildPalette(mood: SongMood, seed: number, options: ColourOptions): ThumbPalette {
  const random = createRandom(mixSeed(seed, 0xc0102));
  const fifths = (mood.keyRoot * 7) % 12;
  let hue = 25 + fifths * 30 + random.range(-10, 10);
  let hueSource = mood.keyLabel;
  let chromaScale = 1;
  let tone: GroundTone | null = null;

  const hint = mood.colorHint;
  if (hint) {
    if (hint.hue !== null) {
      hue = hint.hue + random.range(-5, 5);
      hueSource = `title: “${hint.word}”`;
    }
    chromaScale = hint.chroma;
    if (hint.ground) tone = hint.ground;
  }
  if (options.ground !== 'auto') tone = options.ground;
  hue = wrapHue(hue + options.hueShift);

  const chroma = clamp(
    (0.075 + 0.1 * mood.energy + 0.035 * (1 - mood.ambience)) * chromaScale * options.vividness,
    0.015,
    0.3,
  );
  let lightness = 0.52 + 0.26 * mood.valence + 0.05 * mood.brightness - 0.07 * mood.tension;
  // Warm hues stay light (yuzu, peach, coral), or they read as rust and mud.
  if (isWarmHue(hue)) lightness = Math.max(lightness, 0.74);
  lightness = clamp(lightness + options.lightness, 0.25, 0.94);

  let songBase: Lch = { l: lightness, c: chroma, h: hue };
  // The accent chosen in the Colour tab leads, so the thumbnail matches the
  // video. The song's energy still sets how vivid it is, unless the accent is
  // a black, white or grey with no colour to keep.
  if (options.defaultMain && !hint?.hue) {
    const chosen = adjust(hexToLch(options.defaultMain), options);
    songBase = chosen.c < 0.035 ? songBase : { l: lightness, c: Math.max(chroma, chosen.c * 0.9), h: chosen.h };
    if (chosen.c >= 0.035) hueSource = 'your accent';
  }
  let base = songBase;
  if (options.main) {
    base = adjust(hexToLch(options.main), options);
    hueSource = 'custom';
  }
  // Black, white and grey have no hue of their own to build a scheme from, so
  // the song's colour stands in for working out the partners.
  const ref = base.c < 0.035 ? songBase : base;

  const scheme: ThumbPalette['scheme'] =
    options.scheme !== 'auto' ? options.scheme : mood.tension > 0.5 ? 'complementary' : 'analogous';
  const side = random.sign();
  const vivid = clamp(ref.c * 1.15 + 0.03, 0.06, 0.26);
  const accentL = clamp(0.74 + options.lightness * 0.5, 0.3, 0.92);

  let accent: Lch;
  let third: Lch;
  switch (scheme) {
    case 'mono':
      accent = { l: base.l > 0.6 ? base.l - 0.32 : base.l + 0.26, c: base.c * 0.9, h: base.h };
      third = { l: base.l > 0.6 ? base.l - 0.15 : base.l + 0.12, c: base.c * 0.7, h: base.h };
      break;
    case 'complementary':
      accent = { l: accentL, c: vivid, h: wrapHue(ref.h + 180 + random.range(-15, 15)) };
      third = { l: clamp(base.l + 0.1, 0, 0.95), c: ref.c * 0.6, h: wrapHue(ref.h + 25 * side) };
      break;
    case 'split':
      accent = { l: accentL, c: vivid, h: wrapHue(ref.h + 150 * side) };
      third = { l: clamp(accentL - 0.1, 0, 1), c: vivid * 0.9, h: wrapHue(ref.h - 150 * side) };
      break;
    case 'triadic':
      accent = { l: accentL, c: vivid, h: wrapHue(ref.h + 120 * side) };
      third = { l: clamp(accentL - 0.08, 0, 1), c: vivid * 0.9, h: wrapHue(ref.h - 120 * side) };
      break;
    default:
      accent = { l: accentL, c: vivid, h: wrapHue(ref.h + side * random.range(30, 50)) };
      third = { l: clamp(base.l - 0.08, 0, 1), c: ref.c, h: wrapHue(ref.h - side * random.range(20, 35)) };
  }
  if (options.accent) accent = adjust(hexToLch(options.accent), options);
  const stops = (options.gradient ?? []).slice(0, 5).map((hex) => adjust(hexToLch(hex), options));

  return {
    base,
    accent,
    third,
    scheme,
    hueSource,
    hueName: hueName(base),
    tone,
    exactMain: Boolean(options.main),
    gradient: (options.gradientTargets ?? ['background']).includes('background') ? stops : [],
    gradientStops: stops,
    exactAccent: Boolean(options.accent),
  };
}

/**
 * The hue, vividness and lightness sliders apply to colours you typed as well
 * as derived ones, so moving them always changes the picture. At their
 * defaults a typed colour comes through exactly.
 */
function adjust(color: Lch, options: ColourOptions): Lch {
  return {
    l: clamp(color.l + options.lightness, 0, 1),
    c: Math.max(color.c * options.vividness, 0),
    h: wrapHue(color.h + options.hueShift),
  };
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

const HUE_NAMES: Array<[number, string]> = [
  [10, 'rose'],
  [32, 'crimson'],
  [52, 'coral'],
  [72, 'amber'],
  [98, 'gold'],
  [128, 'chartreuse'],
  [155, 'green'],
  [180, 'jade'],
  [212, 'teal'],
  [238, 'sky'],
  [268, 'cobalt'],
  [292, 'indigo'],
  [318, 'violet'],
  [342, 'magenta'],
  [361, 'rose'],
];

export function hueName(color: Lch): string {
  if (color.c < 0.035) return color.l > 0.8 ? 'white' : color.l < 0.25 ? 'black' : 'grey';
  for (const [limit, name] of HUE_NAMES) if (color.h < limit) return name;
  return 'rose';
}
