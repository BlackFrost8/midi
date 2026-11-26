import type { ColorTheme, InstrumentPalette } from './ColorTheme';
import type { InstrumentFamily } from './MidiProject';
import { intensify, luminance, mix, readableTextOn, rotateHue } from '../utils/colors';

/**
 * Three colours the user actually cares about. Everything else in the theme is
 * derived from them, so the common case is picking two swatches rather than
 * editing twenty-seven slots.
 */
export interface ColorSeed {
  /** Notes and text. */
  primary: string;
  /** Playhead, clip headers, glow — the colour that carries the mood. */
  accent: string;
  background: string;
}

/**
 * Builds a complete theme from the seed.
 *
 * Every derived colour is a blend between the background and either the accent
 * or the primary, which keeps contrast sane whether the background is near-black
 * or near-white: the same blend factor means "barely visible" in both cases.
 */
export function deriveTheme(seed: ColorSeed): ColorTheme {
  const { primary, accent, background } = seed;
  const dark = luminance(background) < 0.5;

  /** Background tinted toward the accent. */
  const toAccent = (t: number) => mix(background, accent, t);
  /** Background tinted toward the primary. */
  const toPrimary = (t: number) => mix(background, primary, t);
  /** Background pushed away from the viewer (darker on dark, lighter on light). */
  const recede = (t: number) => mix(background, dark ? '#000000' : '#ffffff', t);

  const clipHeader = mix(accent, primary, 0.5);

  return {
    background,
    backgroundGlow: toAccent(0.2),

    panel: recede(0.35),
    panelBorder: toAccent(0.16),
    trackText: toPrimary(0.92),
    trackSubtext: toPrimary(0.4),
    trackIcon: toPrimary(0.62),
    trackIndicator: accent,

    gridBar: toAccent(0.15),
    gridBeat: toAccent(0.07),
    trackSeparator: toAccent(0.11),

    clipHeader,
    clipHeaderText: readableTextOn(clipHeader),
    clipBody: toAccent(0.05),
    clipBorder: toAccent(0.18),

    note: primary,
    noteActive: intensify(primary, dark, 0.55),
    noteGlow: accent,
    noteSelected: accent,

    playhead: intensify(accent, dark, 0.6),
    playheadGlow: accent,

    rulerBackground: recede(0.25),
    rulerText: toPrimary(0.48),
    rulerLine: toAccent(0.16),

    sectionText: mix(accent, primary, 0.45),
    sectionLine: toAccent(0.3),

    titleText: toPrimary(0.9),
  };
}

/**
 * Family order for the derived palette. Neighbouring entries are musically
 * related, so the generated gradient groups the strings together, then the
 * brass, and so on, rather than scattering hues at random.
 */
const GRADIENT_ORDER: InstrumentFamily[] = [
  'piano',
  'organ',
  'guitar',
  'strings',
  'violin',
  'viola',
  'cello',
  'bass',
  'brass',
  'woodwinds',
  'choir',
  'voice',
  'synth',
  'pad',
  'arpeggio',
  'percussion',
  'drums',
  'unknown',
];

/**
 * Spreads the instrument colours along a gradient anchored on the accent.
 *
 * The ramp runs primary → accent → a hue-rotated accent, so the whole palette
 * stays in the same family as the two colours the user chose. `spread` controls
 * how far the far end rotates: 0 gives a monochrome ramp, 1 goes most of the way
 * round the wheel.
 */
export function deriveInstrumentPalette(
  seed: ColorSeed,
  spread: number,
  /**
   * Families present in the loaded file. When given, the gradient is stretched
   * across just those, so a twelve-part orchestral score uses the whole ramp
   * instead of crowding into the third of it that happens to hold strings.
   */
  present?: Iterable<InstrumentFamily>,
): InstrumentPalette {
  const { primary, accent, background } = seed;
  const dark = luminance(background) < 0.5;

  const start = mix(primary, accent, 0.2);
  const middle = accent;
  const end = rotateHue(accent, spread * 130);

  const ramp = (t: number) =>
    t < 0.5 ? mix(start, middle, t * 2) : mix(middle, end, (t - 0.5) * 2);

  // Positive amount means "more contrast against the background".
  const shade = (color: string, amount: number): string => {
    if (amount === 0) return color;
    const target = amount > 0 ? (dark ? '#ffffff' : '#000000') : dark ? '#000000' : '#ffffff';
    return mix(color, target, Math.abs(amount));
  };

  const inUse = present ? new Set(present) : null;
  const spreadOver =
    inUse && inUse.size >= 2 ? GRADIENT_ORDER.filter((family) => inUse.has(family)) : GRADIENT_ORDER;

  const positions = new Map<InstrumentFamily, number>();
  spreadOver.forEach((family, index) => {
    positions.set(family, spreadOver.length > 1 ? index / (spreadOver.length - 1) : 0.5);
  });

  const colors = {} as InstrumentPalette;
  GRADIENT_ORDER.forEach((family, index) => {
    // Families not in the file still get a sensible colour from their position
    // in the canonical order, so switching files never leaves a gap.
    const t = positions.get(family) ?? index / (GRADIENT_ORDER.length - 1);
    // A small lightness wobble keeps neighbouring families apart even where the
    // gradient itself barely moves.
    colors[family] = shade(ramp(t), ((index % 3) - 1) * 0.09);
  });

  return colors;
}

/**
 * Recovers a plausible seed from a hand-built theme, so switching a preset into
 * simple mode starts from the right three colours instead of resetting.
 */
export function seedFromTheme(theme: ColorTheme): ColorSeed {
  return {
    primary: theme.note,
    accent: theme.playheadGlow,
    background: theme.background,
  };
}
