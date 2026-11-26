import type { InstrumentFamily, MidiProject } from '../models/MidiProject';
import { clamp } from '../utils/math';
import { hashString } from './Noise';

/**
 * Reads the tone, colour and energy of a song from its MIDI (and, when one is
 * loaded, its recording), as a handful of 0–1 dials the thumbnail generator
 * designs from. Everything is measured; nothing is guessed from the file name
 * except an explicit colour word in the title ("chartreuse", "obsidian").
 */

/** Measured from the recording — present only when a mixdown is loaded. */
export interface AudioMood {
  /** Average loudness, 0 (quiet) – 1 (mastered loud). */
  loudness: number;
  /** Spectral centroid, 0 (dark, bass-heavy) – 1 (bright, airy). */
  brightness: number;
  /** How much of the sound is attack rather than sustain. */
  punch: number;
}

export type KeyMode = 'major' | 'minor';

/** A colour the title itself names. */
export interface ColorHint {
  word: string;
  hue: number | null;
  /** Multiplier on the derived chroma (grey words pull it down). */
  chroma: number;
  ground: 'light' | 'dark' | null;
}

export interface SongMood {
  /** Display title, cleaned from the file name. */
  title: string;
  /** Stable per song: the same file always opens on the same artwork. */
  seed: number;
  keyRoot: number;
  mode: KeyMode;
  keyLabel: string;
  /** How clearly the music sits in one key, 0–1. */
  keyClarity: number;
  bpm: number;
  notesPerSecond: number;
  durationSeconds: number;

  /** Tempo, note rate, dynamics and drums together. */
  energy: number;
  /** Major/minor, register and pace: dark (0) to bright and warm (1). */
  valence: number;
  /** Chromatic, dissonant or dynamically restless material. */
  tension: number;
  /** How many voices sound at once. */
  density: number;
  /** Pads, choirs and long held notes: the "air" in the mix. */
  ambience: number;
  /** Register (and the recording's spectral centroid when there is one). */
  brightness: number;
  percussive: number;
  /** Share of the notes played on keys — favours the cleaner, graphic styles. */
  keysShare: number;
  /** Share of the notes on synth leads and arpeggios — favours pixel and scanline looks. */
  synthShare: number;

  colorHint: ColorHint | null;
  audio: AudioMood | null;
  /** Plain-language reading for the panel, e.g. ["dark", "driving", "tense"]. */
  words: string[];
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Krumhansl–Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
// Natural plus harmonic minor: the raised seventh is not "outside" the key.
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11];

/** How much each family contributes sustained "air" to the mix. */
const AMBIENT_WEIGHT: Partial<Record<InstrumentFamily, number>> = {
  pad: 1,
  choir: 1,
  voice: 0.6,
  strings: 0.85,
  violin: 0.6,
  viola: 0.6,
  cello: 0.6,
  organ: 0.6,
  woodwinds: 0.45,
  piano: 0.3,
  synth: 0.3,
  arpeggio: 0.15,
  guitar: 0.2,
  brass: 0.25,
};

/**
 * Colour words a title can carry. Checked in order, so the specific words
 * ("chartreuse") win over the general ones ("green").
 */
const COLOR_WORDS: Array<{ pattern: RegExp } & Omit<ColorHint, 'word'>> = [
  { pattern: /\b(chartreuse|lime|absinthe)\b/i, hue: 122, chroma: 1.15, ground: null },
  { pattern: /\b(obsidian|onyx|abyss|void|shadow|midnight)\b/i, hue: null, chroma: 1, ground: 'dark' },
  { pattern: /\b(crimson|scarlet|blood|ruby|red)\b/i, hue: 22, chroma: 1.15, ground: null },
  { pattern: /\b(rose|roseate|pink|sakura|cherry|blossom|bloom|sugar|candy)\b/i, hue: 2, chroma: 1, ground: null },
  { pattern: /\b(orange|sunset|ember|fire|flame|autumn|amber)\b/i, hue: 50, chroma: 1.1, ground: null },
  { pattern: /\b(gold|golden|yuzu|lemon|honey|sun|sunny|yellow)\b/i, hue: 88, chroma: 1, ground: null },
  { pattern: /\b(mint|jade|emerald)\b/i, hue: 165, chroma: 1, ground: null },
  { pattern: /\b(green|forest|leaf|moss|garden|grass)\b/i, hue: 145, chroma: 0.95, ground: null },
  { pattern: /\b(teal|ocean|sea|wave|waves|tide|rain|lagoon)\b/i, hue: 200, chroma: 0.85, ground: null },
  { pattern: /\b(cyan|aqua|turquoise)\b/i, hue: 195, chroma: 1.1, ground: null },
  { pattern: /\b(blue|sky|azure|cobalt|sapphire|ice|frost|frozen|winter)\b/i, hue: 250, chroma: 1, ground: null },
  { pattern: /\b(purple|violet|lavender|amethyst|space|spaceship|galaxy|cosmos|nebula)\b/i, hue: 300, chroma: 1.05, ground: null },
  { pattern: /\b(magenta|fuchsia)\b/i, hue: 335, chroma: 1.15, ground: null },
  { pattern: /\b(storm|grey|gray|ash|fog|mist|smoke|stone|iron|steel)\b/i, hue: null, chroma: 0.35, ground: null },
  { pattern: /\b(black|night|dark|darkness|nocturne)\b/i, hue: null, chroma: 1, ground: 'dark' },
  { pattern: /\b(white|snow|clarity|paper|light|cloud|clouds|heaven|angel)\b/i, hue: null, chroma: 0.9, ground: 'light' },
];

export function analyzeSongMood(project: MidiProject, fileName: string, audio: AudioMood | null): SongMood {
  const title = cleanTitle(fileName, project.title);
  const duration = Math.max(project.durationSeconds, 1e-3);

  // ---- Gather note statistics in one pass ----
  const pitchClass = new Float64Array(12);
  let tonalNotes = 0;
  let percussionNotes = 0;
  let velocitySum = 0;
  let velocitySquares = 0;
  let pitchWeighted = 0;
  let pitchWeight = 0;
  let soundingSeconds = 0;
  let ambientSeconds = 0;
  let keysNotes = 0;
  let synthNotes = 0;
  const durations: number[] = [];

  for (const track of project.tracks) {
    const percussive = track.isPercussion || track.family === 'drums';
    const ambientWeight = AMBIENT_WEIGHT[track.family] ?? 0.1;
    const keys = track.family === 'piano' || track.family === 'organ';
    const synth = track.family === 'synth' || track.family === 'arpeggio';
    for (const note of track.notes) {
      velocitySum += note.velocity;
      velocitySquares += note.velocity * note.velocity;
      if (percussive) {
        percussionNotes++;
        continue;
      }
      tonalNotes++;
      if (keys) keysNotes++;
      if (synth) synthNotes++;
      // Long pads would otherwise swamp the key estimate; cap their say.
      const held = Math.min(note.durationSeconds, 4);
      const weight = held * (0.5 + note.velocity);
      pitchClass[((note.pitch % 12) + 12) % 12] += weight;
      pitchWeighted += note.pitch * weight;
      pitchWeight += weight;
      soundingSeconds += note.durationSeconds;
      ambientSeconds += note.durationSeconds * ambientWeight;
      if (durations.length < 20000) durations.push(note.durationSeconds);
    }
  }

  const totalNotes = tonalNotes + percussionNotes;
  const key = estimateKey(pitchClass);
  const scale = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  let inKey = 0;
  let allWeight = 0;
  for (let pc = 0; pc < 12; pc++) {
    allWeight += pitchClass[pc];
    if (scale.includes((pc - key.root + 12) % 12)) inKey += pitchClass[pc];
  }
  const chromaticism = allWeight > 0 ? 1 - inKey / allWeight : 0;

  const bpm = averageTempo(project);
  const notesPerSecond = totalNotes / duration;
  const meanVelocity = totalNotes ? velocitySum / totalNotes : 0.6;
  const velocitySpread = totalNotes
    ? Math.sqrt(Math.max(velocitySquares / totalNotes - meanVelocity * meanVelocity, 0))
    : 0;
  const meanPitch = pitchWeight > 0 ? pitchWeighted / pitchWeight : 60;
  const polyphony = soundingSeconds / duration;
  durations.sort((a, b) => a - b);
  const medianDuration = durations.length ? durations[Math.floor(durations.length / 2)] : 0.3;

  // ---- Normalised measurements ----
  const tempoN = clamp((bpm - 60) / 120, 0, 1);
  const rateN = clamp(Math.log2(Math.max(notesPerSecond, 0.25)) / Math.log2(28), 0, 1);
  const velocityN = clamp((meanVelocity - 0.3) / 0.55, 0, 1);
  const percussive = totalNotes ? clamp((percussionNotes / totalNotes) * 2.2, 0, 1) : 0;
  const registerN = clamp((meanPitch - 42) / 38, 0, 1);
  const sustainN = clamp((medianDuration - 0.12) / 1.1, 0, 1);
  const ambientShare = soundingSeconds > 0 ? ambientSeconds / soundingSeconds : 0;

  let energy = clamp(0.3 * tempoN + 0.3 * rateN + 0.2 * velocityN + 0.2 * percussive, 0, 1);
  let brightness = registerN;
  if (audio) {
    energy = clamp(energy * 0.6 + (audio.loudness * 0.45 + audio.punch * 0.55) * 0.4, 0, 1);
    brightness = clamp(registerN * 0.5 + audio.brightness * 0.5, 0, 1);
  }

  const modeLean = key.mode === 'major' ? 0.5 + 0.35 * key.clarity : 0.5 - 0.35 * key.clarity;
  const valence = clamp(
    0.5 * modeLean + 0.22 * brightness + 0.13 * tempoN + 0.15 * (1 - clamp(chromaticism * 3, 0, 1)),
    0,
    1,
  );
  const tension = clamp(
    0.5 * clamp(chromaticism * 3.2, 0, 1) +
      0.18 * clamp(velocitySpread * 4, 0, 1) +
      0.17 * (key.mode === 'minor' ? 1 : 0) * energy +
      0.15 * (1 - key.clarity),
    0,
    1,
  );
  const density = clamp(Math.log2(polyphony + 1) / Math.log2(9) * 0.7 + rateN * 0.3, 0, 1);
  const ambience = clamp(ambientShare * 0.6 + sustainN * 0.4, 0, 1) * (1 - percussive * 0.35);
  const keysShare = tonalNotes ? keysNotes / tonalNotes : 0;
  const synthShare = tonalNotes ? synthNotes / tonalNotes : 0;

  const colorHint = findColorHint(title);

  const mood: SongMood = {
    title,
    seed: songSeed(project, fileName),
    keyRoot: key.root,
    mode: key.mode,
    keyLabel: `${NOTE_NAMES[key.root]} ${key.mode}`,
    keyClarity: key.clarity,
    bpm,
    notesPerSecond,
    durationSeconds: duration,
    energy,
    valence,
    tension,
    density,
    ambience,
    brightness,
    percussive,
    keysShare,
    synthShare,
    colorHint,
    audio,
    words: [],
  };
  mood.words = describe(mood);
  return mood;
}

/** Correlates the pitch-class histogram against all 24 key profiles. */
function estimateKey(histogram: Float64Array): { root: number; mode: KeyMode; clarity: number } {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { root: 0, mode: 'major', clarity: 0 };

  let best = { root: 0, mode: 'major' as KeyMode, score: -Infinity };
  let runnerUp = -Infinity;
  for (const mode of ['major', 'minor'] as const) {
    const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
    for (let root = 0; root < 12; root++) {
      const rotated = Array.from({ length: 12 }, (_, pc) => profile[(pc - root + 12) % 12]);
      const score = pearson(Array.from(histogram), rotated);
      if (score > best.score) {
        runnerUp = best.score;
        best = { root, mode, score };
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
  }
  // Clear tonal writing correlates around 0.8–0.9; atonal material near 0.3.
  const clarity = clamp((best.score - 0.4) / 0.45, 0, 1) * clamp(0.5 + (best.score - runnerUp) * 6, 0.5, 1);
  return { root: best.root, mode: best.mode, clarity };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Tempo averaged over time, so a short ritardando does not set the mood. */
function averageTempo(project: MidiProject): number {
  const tempos = project.tempos;
  if (!tempos.length) return 120;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < tempos.length; i++) {
    const start = tempos[i].seconds;
    const end = i + 1 < tempos.length ? tempos[i + 1].seconds : project.durationSeconds;
    const span = Math.max(end - start, 0);
    weighted += tempos[i].bpm * span;
    total += span;
  }
  return total > 0 ? weighted / total : tempos[0].bpm;
}

function songSeed(project: MidiProject, fileName: string): number {
  const pitches: number[] = [];
  for (const track of project.tracks) {
    for (const note of track.notes) {
      pitches.push(note.pitch);
      if (pitches.length >= 64) break;
    }
    if (pitches.length >= 64) break;
  }
  return hashString(
    `${fileName}|${project.totalNotes}|${project.durationBeats.toFixed(3)}|${project.tracks.length}|${pitches.join(',')}`,
  );
}

/**
 * "03_mechanical-god.mid" → "mechanical god" — the words, not the clutter.
 * Hyphens only count as separators when the name has no spaces of its own,
 * so a real title such as "lo-fi dreams" keeps its hyphen.
 */
export function cleanTitle(fileName: string, fallback: string): string {
  let stem = fileName.replace(/\.(mid|midi|rmi)$/i, '').replace(/_+/g, ' ');
  if (!/\s/.test(stem.trim())) stem = stem.replace(/-+/g, ' ');
  stem = stem
    .replace(/^\s*\d{1,3}\s*[-.)_ ]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stem || fallback.trim() || 'untitled';
}

function findColorHint(title: string): ColorHint | null {
  const words = title.replace(/[-_]+/g, ' ');
  for (const entry of COLOR_WORDS) {
    const match = entry.pattern.exec(words);
    if (match) return { word: match[0].toLowerCase(), hue: entry.hue, chroma: entry.chroma, ground: entry.ground };
  }
  return null;
}

function describe(mood: SongMood): string[] {
  const words: string[] = [];
  words.push(
    mood.valence < 0.32 ? 'dark' : mood.valence < 0.5 ? 'bittersweet' : mood.valence < 0.68 ? 'warm' : 'bright',
  );
  words.push(
    mood.energy < 0.28 ? 'calm' : mood.energy < 0.5 ? 'flowing' : mood.energy < 0.72 ? 'driving' : 'intense',
  );
  if (mood.tension > 0.55) words.push('tense');
  if (mood.ambience > 0.55) words.push('atmospheric');
  else if (mood.density < 0.25) words.push('sparse');
  if (mood.percussive > 0.45) words.push('rhythmic');
  return words;
}
