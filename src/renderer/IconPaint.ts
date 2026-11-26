import type { VisualTrack } from '../models/MidiProject';
import type { IconGradientStyle, RenderSettings } from '../models/RenderSettings';
import { darken, isValidHex, luminance, mix, rotateHue, withAlpha } from '../utils/colors';
import { lowerBound } from '../utils/math';
import { drawIcon, type IconName } from './iconLibrary';

/**
 * Gradient icons and their note-driven pulse.
 *
 * Shared by the arrangement, every export and the small icon previews in the
 * sidebar, so a gradient looks the same wherever it appears.
 */

export const MAX_GRADIENT_COLORS = 4;

/**
 * A gradient built from the accent: a bright highlight, the accent itself,
 * and a deeper neighbouring hue, so it reads as one colour catching light
 * rather than a rainbow.
 */
export function accentGradient(accent: string): string[] {
  return [mix(accent, '#ffffff', 0.6), accent, rotateHue(darken(accent, 0.08), 38)];
}

/** The colours gradient icons use under the current settings. */
export function iconGradientColors(settings: RenderSettings): string[] {
  if (settings.iconGradientSource === 'custom') {
    const custom = settings.iconGradientColors.filter(isValidHex).slice(0, MAX_GRADIENT_COLORS);
    if (custom.length >= 2) return custom;
    if (custom.length === 1) return [custom[0], custom[0]];
  }
  return accentGradient(settings.accentColor);
}

/** A gradient laid across an icon's box in the chosen style. */
export function makeIconGradient(
  ctx: CanvasRenderingContext2D,
  style: IconGradientStyle,
  colors: string[],
  x: number,
  y: number,
  size: number,
): CanvasGradient | string {
  if (colors.length === 0) return '#ffffff';
  if (colors.length === 1) return colors[0];
  const cx = x + size / 2;
  const cy = y + size / 2;

  // A sweep runs round the icon and closes on its first colour, so there is
  // no seam where it ends.
  if (style === 'sweep' && typeof ctx.createConicGradient === 'function') {
    const sweep = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    colors.forEach((color, i) => sweep.addColorStop(i / colors.length, color));
    sweep.addColorStop(1, colors[0]);
    return sweep;
  }

  let gradient: CanvasGradient;
  if (style === 'vertical') gradient = ctx.createLinearGradient(x, y, x, y + size);
  else if (style === 'horizontal') gradient = ctx.createLinearGradient(x, y, x + size, y);
  else if (style === 'radial') gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.62);
  else gradient = ctx.createLinearGradient(x, y, x + size, y + size);

  colors.forEach((color, i) => gradient.addColorStop(i / (colors.length - 1), color));
  return gradient;
}

/** The colour a pulse glows in: the brightest in the gradient. */
export function glowColor(colors: string[]): string {
  return colors.reduce((best, color) => (luminance(color) > luminance(best) ? color : best), colors[0] ?? '#ffffff');
}

// ---------------------------------------------------------------------------
// Pulse
// ---------------------------------------------------------------------------

/** Notes starting this close together are one chord, one hit. */
const CHORD_WINDOW = 0.03;
/** A gap this long ends a phrase: the next hit swells in, the last one fades out slowly. */
const PHRASE_GAP = 1.5;
/** Reach back this far for tails that are still fading. */
const TAIL = 9;

/**
 * One hit (a note or a chord) with an envelope shaped by the pace of the music
 * around it: in fast passages a quick swell and a crisp fade, so the icon beats
 * with the notes; in slow ones a long swell, a deep steady glow while the note
 * is held, and a long, soft fade.
 */
interface Hit {
  start: number;
  held: number;
  weight: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** 1 fast … 0 slow. */
  pace: number;
  /** Start of the phrase this hit belongs to. */
  phrase: number;
}

// Keyed by the notes array, so an edited or re-timed track is worked out afresh.
const hitCache = new WeakMap<object, Hit[]>();

function hitsFor(track: VisualTrack): Hit[] {
  const cached = hitCache.get(track.notes);
  if (cached) return cached;
  let notes = track.notes;
  for (let k = 1; k < notes.length; k++) {
    if (notes[k].startSeconds < notes[k - 1].startSeconds) {
      notes = [...notes].sort((a, b) => a.startSeconds - b.startSeconds);
      break;
    }
  }
  const raw: Array<{ start: number; held: number; weight: number }> = [];
  for (let i = 0; i < notes.length; ) {
    const start = notes[i].startSeconds;
    let loudest = 0;
    let count = 0;
    let end = start;
    while (i < notes.length && notes[i].startSeconds - start <= CHORD_WINDOW) {
      loudest = Math.max(loudest, notes[i].velocity);
      end = Math.max(end, notes[i].startSeconds + notes[i].durationSeconds);
      count++;
      i++;
    }
    raw.push({ start, held: end - start, weight: (0.55 + 0.45 * loudest) * Math.min(1 + 0.12 * (count - 1), 1.35) });
  }

  const hits: Hit[] = [];
  let phrase = raw.length ? raw[0].start : 0;
  raw.forEach((hit, i) => {
    const prevGap = i > 0 ? hit.start - raw[i - 1].start : Infinity;
    const nextGap = i < raw.length - 1 ? raw[i + 1].start - hit.start : Infinity;
    if (prevGap >= PHRASE_GAP) phrase = hit.start;
    // The spacing of the hits around this one: quarter-second or tighter is fast, a second or more is slow.
    const near = [prevGap, nextGap].filter((gap) => gap < PHRASE_GAP);
    const spacing = near.length ? near.reduce((a, b) => a + b, 0) / near.length : 1.2;
    let pace = Math.min(1, Math.max(0, (1.0 - spacing) / 0.78));
    // Long held notes are slow music whatever their spacing.
    if (hit.held > 0.8) pace *= 0.5;
    const shape = envelopeShape(pace);
    // The last hit of a phrase fades out slowly. (A phrase's first hit still
    // strikes on its note; the phrase fade-in in notePulse softens it.)
    if (nextGap >= PHRASE_GAP) {
      shape.decay = Math.max(shape.decay, 0.9);
      shape.release = Math.max(shape.release, 1.5);
    }
    hits.push({ ...hit, ...shape, pace, phrase });
  });
  hitCache.set(track.notes, hits);
  return hits;
}

/**
 * Envelope timings for a pace (1 fast … 0 slow). The glow always peaks on the
 * note itself, so it stays in sync; slow music gets a gentler rise, a longer
 * fall to a lower held glow, and a long fade after the note ends. The held
 * level stays well under the peak, so every new note reads as a fresh strike.
 */
function envelopeShape(pace: number) {
  const mix = (fast: number, slow: number) => slow + (fast - slow) * pace;
  return { attack: mix(0.012, 0.07), decay: mix(0.12, 0.65), sustain: mix(0.3, 0.55), release: mix(0.16, 1.3) };
}

function smooth01(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** One hit's glow `age` seconds after it struck. */
function envelope(hit: Hit, age: number): number {
  if (age < 0) return 0;
  const swell = age < hit.attack ? smooth01(age / hit.attack) : 1;
  // The strike falls from the peak to the held glow, not to nothing.
  const strike = age < hit.attack ? swell : hit.sustain + (1 - hit.sustain) * Math.exp(-(age - hit.attack) / hit.decay);
  // Held notes glow steadily for as long as they sound, then ease out.
  if (age <= hit.held) return strike;
  // After the note ends, whatever is left eases out.
  const atEnd = hit.held < hit.attack ? smooth01(hit.held / hit.attack) : hit.sustain + (1 - hit.sustain) * Math.exp(-(hit.held - hit.attack) / hit.decay);
  return Math.min(strike, atEnd) * Math.exp(-(age - hit.held) / hit.release);
}

/**
 * A single hit's glow at a given pace (1 fast … 0 slow), for previews that have
 * no track: the same envelope the icons use.
 */
export function hitEnvelope(age: number, held: number, pace = 0.6): number {
  return envelope({ start: 0, held, weight: 1, ...envelopeShape(pace), pace, phrase: 0 }, age);
}

/**
 * How strongly a track's icon should pulse at a moment, 0–1. Every note or
 * chord is a hit whose envelope follows the pace of the music around it (see
 * Hit), and a phrase fades in over its first second or so. Louder notes pulse
 * harder. Computed from the time alone, so a paused frame and an exported
 * frame look exactly like live playback.
 */
export function notePulse(track: VisualTrack, seconds: number): number {
  const hits = hitsFor(track);
  if (!hits.length) return 0;
  // The newest hit strikes on top of whatever is still glowing (a held note,
  // a tail): it adds to the light rather than hiding behind it, so a melody
  // played over a sustained chord still flashes note by note.
  let held = 0;
  let newest = 0;
  let i = lowerBound(hits, seconds - track.maxDurationSeconds - TAIL, (hit) => hit.start);
  for (; i < hits.length && hits[i].start <= seconds; i++) {
    const hit = hits[i];
    const age = seconds - hit.start;
    if (age > hit.held + TAIL) continue;
    const phraseIn = 0.6 + 0.4 * smooth01((seconds - hit.phrase) / 1.2);
    const level = envelope(hit, age) * hit.weight * phraseIn;
    // Hits are in time order, so the last one reached is the newest.
    held = Math.max(held, newest);
    newest = level;
  }
  return Math.min(1, held + (1 - held) * newest);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export interface GradientIconOptions {
  colors: string[];
  style: IconGradientStyle;
  /** Resting opacity, 0–1. */
  opacity: number;
  /** Current pulse, 0–1, already scaled by the user's strength setting. */
  pulse: number;
  lineWidth: number;
  /**
   * Multiplier for the glow radius. Canvas shadows ignore the transform, so
   * this carries the layout scale and device pixel ratio to keep the glow the
   * same size at every resolution.
   */
  blurScale: number;
}

/**
 * Draws an icon in a gradient, glowing and swelling slightly with its pulse.
 * The glow pass fades in with the pulse rather than switching on, so there is
 * no pop as a hit dies away.
 */
export function drawGradientIcon(
  ctx: CanvasRenderingContext2D,
  icon: IconName,
  x: number,
  y: number,
  size: number,
  options: GradientIconOptions,
): void {
  const p = Math.max(0, Math.min(options.pulse, 1));
  const grown = size * (1 + 0.1 * p);
  const gx = x - (grown - size) / 2;
  const gy = y - (grown - size) / 2;

  ctx.save();
  const base = ctx.globalAlpha;
  ctx.strokeStyle = makeIconGradient(ctx, options.style, options.colors, gx, gy, grown);
  ctx.lineWidth = options.lineWidth * (1 + 0.15 * p);

  if (p > 0.005) {
    // A soft bloom of light behind the icon. Shadows round thin strokes stay
    // faint, so this is what makes the pulse read as a glow in a video.
    const glow = glowColor(options.colors);
    const cx = x + size / 2;
    const cy = y + size / 2;
    const radius = size * (0.7 + 0.25 * p);
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    halo.addColorStop(0, withAlpha(glow, 0.3 * p));
    halo.addColorStop(0.55, withAlpha(glow, 0.12 * p));
    halo.addColorStop(1, withAlpha(glow, 0));
    ctx.globalAlpha = base;
    ctx.fillStyle = halo;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    ctx.globalAlpha = base * Math.min(1, options.opacity + 0.4) * p;
    ctx.shadowColor = glow;
    ctx.shadowBlur = (3 + 22 * p) * options.blurScale;
    drawIcon(ctx, icon, gx, gy, grown);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  ctx.globalAlpha = base * Math.min(1, options.opacity + (1 - options.opacity) * p * 0.7);
  drawIcon(ctx, icon, gx, gy, grown);
  ctx.restore();
}
