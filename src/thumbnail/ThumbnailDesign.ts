import type { FontId } from './Fonts';
import type { FilterId } from './Filters';
import type { MidiProject } from '../models/MidiProject';
import { TimeMapper } from '../midi/TimeMapper';
import { clamp } from '../utils/math';
import { mixSeed } from './Noise';
import { DEFAULT_COLOUR_OPTIONS, buildPalette, type ColourOptions, type GradientDirection, type GradientTarget, type TextColour, type ThumbPalette } from './Palette';
import { generateRecipe, type Recipe, type RecipeOverrides } from './Recipe';
import type { SongMood } from './SongMood';

/**
 * Turns a song into a thumbnail design: its colours (Palette), its layers
 * (Recipe), the real musical material some layers draw (melody, activity per
 * bar), and the title.
 */

export type TextCase = 'asis' | 'lower' | 'upper';

/** Outline, drop shadow and glow on the title; each 0 (off) to 1, with a colour (null picks one that suits). */
export interface TitleEffects {
  outline: number;
  outlineColor: string | null;
  shadow: number;
  shadowColor: string | null;
  glow: number;
  glowColor: string | null;
  /** The title's own colour when the text colour is Custom. */
  customColor: string;
}

export const DEFAULT_TITLE_EFFECTS: TitleEffects = {
  outline: 0,
  outlineColor: null,
  shadow: 0,
  shadowColor: null,
  glow: 0,
  glowColor: null,
  customColor: '#ffffff',
};

export interface ThumbnailOptions extends RecipeOverrides {
  /** 0 is the song's own design; each shuffle moves to another. */
  variation: number;
  showTitle: boolean;
  /** null follows the file name. */
  title: string | null;
  subtitle: string;
  textCase: TextCase;
  font: FontId;
  titleEffects: TitleEffects;
  colour: ColourOptions;
  /** A whole-picture filter (Thumb tab, Filter section). */
  filter: FilterId;
  /** 0–1. */
  filterStrength: number;
  /** 0–1: how much of the filter shows over the original picture. */
  filterMix: number;
  /** Filter the title too, instead of keeping it clean on top. */
  filterTitle: boolean;
}

export const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions = {
  variation: 0,
  style: 'auto',
  ground: 'auto',
  subject: 'auto',
  secondary: 'auto',
  details: null,
  showTitle: true,
  title: null,
  subtitle: '',
  textCase: 'asis',
  font: 'clean',
  titleEffects: DEFAULT_TITLE_EFFECTS,
  colour: DEFAULT_COLOUR_OPTIONS,
  filter: 'none',
  filterStrength: 0.5,
  filterMix: 1,
  filterTitle: false,
};

/** One note of the melody, reduced to what the drawings need. */
export interface MelodyNote {
  pitch: number;
  velocity: number;
  /** Start within the phrase, 0–1. */
  time: number;
  /** Length within the phrase, 0–1. */
  span: number;
  /** 0–1 relative to the longest note of the phrase. */
  length: number;
  downbeat: boolean;
}

/** The song's own material, measured once per file. */
export interface SongMaterial {
  melody: MelodyNote[];
  /** Notes per bar across the whole song, 0–1. */
  activity: number[];
}

export interface ThumbnailDesign {
  recipe: Recipe;
  seed: number;
  palette: ThumbPalette;
  mood: SongMood;
  material: SongMaterial;
  title: string;
  subtitle: string;
  showTitle: boolean;
  textColour: TextColour;
  font: FontId;
  titleEffects: TitleEffects;
  filter: FilterId;
  filterStrength: number;
  filterMix: number;
  filterTitle: boolean;
  /** Shapes and title the gradient colours (the background is handled by the palette). */
  gradientTargets: GradientTarget[];
  gradientDirection: GradientDirection;
}

export function designThumbnail(mood: SongMood, material: SongMaterial, options: ThumbnailOptions): ThumbnailDesign {
  const seed = mixSeed(mood.seed, options.variation);
  const palette = buildPalette(mood, seed, options.colour);
  const recipe = generateRecipe(
    mood,
    seed,
    palette.tone,
    { melodyNotes: material.melody.length, bars: material.activity.length },
    // A gradient you set is the background, unless you picked one by hand.
    palette.gradient.length >= 2 && options.ground === 'auto' ? { ...options, ground: 'gradient' } : options,
  );
  const title = applyCase((options.title ?? mood.title).trim(), options.textCase);

  return {
    recipe,
    seed,
    palette,
    mood,
    material,
    title,
    subtitle: options.subtitle.trim().toUpperCase(),
    showTitle: options.showTitle && title.length > 0,
    textColour: options.colour.text,
    font: options.font ?? 'clean',
    titleEffects: { ...DEFAULT_TITLE_EFFECTS, ...options.titleEffects },
    filter: options.filter === 'mspaint' ? 'pixel' : (options.filter ?? 'none'),
    filterStrength: options.filterStrength ?? 0.5,
    filterMix: options.filterMix ?? 1,
    filterTitle: options.filterTitle ?? false,
    gradientTargets: palette.gradientStops.length >= 2 ? (options.colour.gradientTargets ?? ['background']).filter((t) => t !== 'background') : [],
    gradientDirection: options.colour.gradientDirection ?? 'diagonal',
  };
}

function applyCase(text: string, textCase: TextCase): string {
  if (textCase === 'lower') return text.toLowerCase();
  if (textCase === 'upper') return text.toUpperCase();
  return text;
}

export function extractMaterial(project: MidiProject): SongMaterial {
  return { melody: extractMelody(project), activity: extractActivity(project) };
}

/**
 * The lead line's most melodic stretch.
 *
 * The lead is the highest-sounding tonal track with a real share of the notes.
 * Chords are thinned to their top voice, then the window with the most
 * distinct pitches wins — a repeated note is less a melody than a run is.
 */
export function extractMelody(project: MidiProject, maxNotes = 36): MelodyNote[] {
  const tonal = project.tracks.filter((track) => !track.isPercussion && track.family !== 'drums' && track.notes.length);
  if (!tonal.length) return [];
  const most = Math.max(...tonal.map((track) => track.notes.length));
  const candidates = tonal.filter((track) => track.notes.length >= Math.max(8, most * 0.12));
  const pool = candidates.length ? candidates : tonal;
  const meanPitch = (notes: { pitch: number }[]) => notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length;
  const lead = pool.reduce((best, track) => (meanPitch(track.notes) > meanPitch(best.notes) ? track : best));

  const sorted = [...lead.notes].sort((a, b) => a.startBeats - b.startBeats || b.pitch - a.pitch);
  const line: typeof sorted = [];
  for (const note of sorted) {
    const previous = line[line.length - 1];
    if (previous && Math.abs(previous.startBeats - note.startBeats) < 1e-3) continue;
    line.push(note);
  }
  if (!line.length) return [];

  const size = Math.min(maxNotes, line.length);
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start + size <= line.length; start += Math.max(1, Math.floor(size / 6))) {
    const distinct = new Set(line.slice(start, start + size).map((note) => note.pitch)).size;
    if (distinct > bestScore) {
      bestScore = distinct;
      bestStart = start;
    }
  }

  const phrase = line.slice(bestStart, bestStart + size);
  const from = phrase[0].startBeats;
  const to = Math.max(...phrase.map((note) => note.startBeats + note.durationBeats));
  const span = Math.max(to - from, 1e-6);
  const longest = Math.max(...phrase.map((note) => note.durationBeats), 1e-6);
  return phrase.map((note) => {
    const sig = project.timeSignatures.filter((s) => s.beats <= note.startBeats + 1e-6).pop() ?? project.timeSignatures[0];
    const barLength = sig ? TimeMapper.beatsPerBar(sig) : 4;
    const into = sig ? (note.startBeats - sig.beats) % barLength : note.startBeats % 4;
    return {
      pitch: note.pitch,
      velocity: note.velocity,
      time: (note.startBeats - from) / span,
      span: note.durationBeats / span,
      length: clamp(Math.sqrt(note.durationBeats / longest), 0, 1),
      downbeat: Math.min(into, barLength - into) < 0.02,
    };
  });
}

/**
 * How busy each bar is, across the whole song: the shape of the arrangement,
 * from intro to outro. Long songs are averaged down to at most `maxBars`.
 */
export function extractActivity(project: MidiProject, maxBars = 48): number[] {
  const downbeats = project.bars.filter((bar) => bar.isDownbeat);
  if (downbeats.length < 2) return [];
  const starts = downbeats.map((bar) => bar.beats);
  const counts = new Float64Array(starts.length);
  for (const track of project.tracks) {
    for (const note of track.notes) {
      // Binary search for the bar this note starts in.
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= note.startBeats) lo = mid;
        else hi = mid - 1;
      }
      counts[lo] += 0.4 + note.velocity;
    }
  }
  // Drop trailing empty bars (a long release, a tail of silence).
  let length = counts.length;
  while (length > 1 && counts[length - 1] === 0) length--;
  const bars = Array.from(counts.slice(0, length));

  const groups = Math.min(maxBars, bars.length);
  const grouped: number[] = [];
  for (let g = 0; g < groups; g++) {
    const from = Math.floor((g / groups) * bars.length);
    const to = Math.max(from + 1, Math.floor(((g + 1) / groups) * bars.length));
    let sum = 0;
    for (let i = from; i < to; i++) sum += bars[i];
    grouped.push(sum / (to - from));
  }
  const peak = Math.max(...grouped, 1e-6);
  return grouped.map((value) => value / peak);
}
