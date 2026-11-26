import { CLASSICS, rankClassics, type ClassicId } from './classic/ClassicStyles';
import { createRandom, mixSeed, type Random } from './Noise';
import type { GroundTone } from './Palette';
import type { SongMood } from './SongMood';

/**
 * A thumbnail is built from layers, each chosen for the song:
 *
 *   tone × background × main shape × second shape × details × composition
 *
 * Every choice is a weighted draw — the song's energy, tension, air and
 * instrumentation set the weights, its seed sets the dice — so songs with a
 * similar reading lean the same way without landing on the same picture, and
 * the combinations run to tens of thousands before the continuous parameters
 * (positions, sizes, angles, raggedness) are even counted.
 */

export type GroundId = 'plain' | 'clouds' | 'gradient' | 'split' | 'strata' | 'pixel';
export type SubjectId =
  | 'none'
  | 'bloom'
  | 'tear'
  | 'mass'
  | 'islands'
  | 'moon'
  | 'sun'
  | 'pillar'
  | 'crackle'
  | 'shards'
  | 'frame'
  | 'glyphs'
  | 'contour'
  | 'skyline'
  | 'ring';
/**
 * A layered design, a layered preset (Moon & Ring), or one of the classic
 * compositions and their variations.
 */
export type StyleId = 'layered' | 'moonring' | ClassicId;

export const STYLES: Array<{ id: StyleId; name: string }> = [
  { id: 'layered', name: 'Layered' },
  { id: 'moonring', name: 'Moon & Ring' },
  ...CLASSICS.map(({ id, name }) => ({ id, name })),
];

export type DetailId = 'arcs' | 'frameLine' | 'specks' | 'glitch' | 'grain' | 'scanlines';
export type Anchor = 'left' | 'right' | 'centre' | 'corner' | 'low';

export const TONES: Array<{ id: GroundTone; name: string }> = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'colour', name: 'Colour' },
];

export const GROUNDS: Array<{ id: GroundId; name: string }> = [
  { id: 'plain', name: 'Plain' },
  { id: 'clouds', name: 'Clouds' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'split', name: 'Split' },
  { id: 'strata', name: 'Strata' },
  { id: 'pixel', name: 'Pixel' },
];

export const SUBJECTS: Array<{ id: SubjectId; name: string; needs?: 'melody' | 'bars' }> = [
  { id: 'none', name: 'None' },
  { id: 'bloom', name: 'Bloom' },
  { id: 'tear', name: 'Tear' },
  { id: 'mass', name: 'Mass' },
  { id: 'islands', name: 'Islands' },
  { id: 'moon', name: 'Moon' },
  { id: 'sun', name: 'Sun' },
  { id: 'pillar', name: 'Pillar' },
  { id: 'crackle', name: 'Crackle' },
  { id: 'shards', name: 'Shards' },
  { id: 'frame', name: 'Frame' },
  { id: 'glyphs', name: 'Glyphs', needs: 'melody' },
  { id: 'contour', name: 'Contour', needs: 'melody' },
  { id: 'skyline', name: 'Skyline', needs: 'bars' },
  { id: 'ring', name: 'Ring' },
];

export const DETAILS: Array<{ id: DetailId; name: string }> = [
  { id: 'arcs', name: 'Arcs' },
  { id: 'frameLine', name: 'Border' },
  { id: 'specks', name: 'Specks' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'grain', name: 'Grain' },
  { id: 'scanlines', name: 'Scanlines' },
];

/** Which second shapes sit well with each main one. */
const PAIRS: Record<SubjectId, SubjectId[]> = {
  none: ['contour', 'ring', 'skyline', 'islands'],
  bloom: ['islands', 'ring', 'contour'],
  tear: ['islands', 'ring'],
  mass: ['moon', 'sun', 'ring'],
  islands: ['moon', 'ring'],
  moon: ['ring', 'ring', 'ring', 'islands'],
  sun: ['ring', 'skyline', 'contour', 'islands'],
  pillar: ['ring', 'islands'],
  crackle: ['ring', 'moon'],
  shards: ['ring'],
  frame: ['contour', 'skyline', 'glyphs'],
  glyphs: [],
  contour: ['moon', 'sun', 'ring'],
  skyline: ['moon', 'sun'],
  ring: ['islands', 'moon'],
};

/** How well each main shape sits on each tone. */
const TONE_FIT: Record<SubjectId, Record<GroundTone, number>> = {
  none: { light: 0.7, dark: 0.6, colour: 1.4 },
  bloom: { light: 1.3, dark: 0.6, colour: 1 },
  tear: { light: 1, dark: 1.3, colour: 0.8 },
  mass: { light: 0.8, dark: 1.2, colour: 1 },
  islands: { light: 1, dark: 1, colour: 1 },
  moon: { light: 1.1, dark: 1.2, colour: 0.9 },
  sun: { light: 1, dark: 0.9, colour: 1.3 },
  pillar: { light: 0.6, dark: 1.3, colour: 1 },
  crackle: { light: 0.7, dark: 1.4, colour: 0.8 },
  shards: { light: 0.45, dark: 1.4, colour: 0.6 },
  frame: { light: 0.6, dark: 1.5, colour: 0.6 },
  glyphs: { light: 1, dark: 1.2, colour: 0.8 },
  contour: { light: 1, dark: 1, colour: 1 },
  skyline: { light: 1, dark: 1, colour: 1 },
  ring: { light: 1, dark: 1.2, colour: 1 },
};

export interface RecipeChoices {
  style: StyleId;
  tone: GroundTone;
  ground: GroundId;
  subject: SubjectId;
  secondary: SubjectId;
  details: DetailId[];
}

export interface Recipe extends RecipeChoices {
  anchor: Anchor;
  mirror: boolean;
  /** Size of the main shape, around 1. */
  scale: number;
  /** What the song would pick at each slot, shown as "Auto · …" in the panel. */
  auto: RecipeChoices;
}

export interface RecipeOverrides {
  style: StyleId | 'auto';
  ground: GroundId | 'auto';
  subject: SubjectId | 'auto';
  secondary: SubjectId | 'auto';
  /** null follows the song; a list is the user's own selection. */
  details: DetailId[] | null;
}

export interface SongData {
  melodyNotes: number;
  bars: number;
}

/** Each slot draws from its own stream, so overriding one never reshuffles the others. */
const SLOT = { tone: 1, ground: 2, subject: 3, secondary: 4, details: 5, layout: 6, style: 7 };

/** Share of songs (and shuffles) whose own design is a classic rather than a layered one. */
const CLASSIC_SHARE = 0.55;

/** Classics that lead when the song's own design is picked: the favourites. */
const CLASSIC_PREFERENCE: Partial<Record<ClassicId, number>> = { rift: 3, stain: 2.4, shatter: 2, orbit: 1 };

export function generateRecipe(
  mood: SongMood,
  seed: number,
  forcedTone: GroundTone | null,
  data: SongData,
  overrides: RecipeOverrides,
): Recipe {
  const stream = (slot: number) => createRandom(mixSeed(seed, 0x7ec1 + slot * 977));
  const e = mood.energy;
  const v = mood.valence;
  const t = mood.tension;
  const d = mood.density;
  const a = mood.ambience;
  const p = mood.percussive;
  const k = mood.keysShare;
  const s = mood.synthShare;

  // ---- Style ----
  // Most songs get a layered design; about one in four lands on a classic,
  // chosen by how well each suits the song.
  const styleRandom = stream(SLOT.style);
  const fits = rankClassics(mood, data.melodyNotes).filter((entry) => entry.fit > 0);
  const autoStyle: StyleId =
    fits.length && styleRandom.next() < CLASSIC_SHARE
      ? weightedPick(
          styleRandom,
          fits.map((entry) => [entry.id, (entry.fit / 100 + 0.05) * (CLASSIC_PREFERENCE[entry.id] ?? 0.3)] as [StyleId, number]),
        )
      : 'layered';
  const style = overrides.style && overrides.style !== 'auto' ? overrides.style : autoStyle;

  // ---- Tone ----
  const autoTone = weightedPick(stream(SLOT.tone), [
    ['dark', 0.3 + 0.8 * e + 0.6 * (1 - v) + 0.3 * t],
    ['light', 0.3 + 0.6 * (1 - e) + 0.4 * a + 0.2 * v],
    ['colour', 0.75 + 0.3 * a + 0.3 * v - 0.3 * t],
  ] as Array<[GroundTone, number]>);
  const tone = forcedTone ?? autoTone;

  // ---- Background ----
  const autoGround = weightedPick(stream(SLOT.ground), [
    ['plain', 0.55 + 0.35 * (1 - d)],
    ['clouds', 0.85 + 0.4 * a - 0.3 * t],
    ['gradient', 0.6 + 0.4 * a + 0.2 * v],
    ['split', 0.2 + 0.6 * t + 0.2 * e],
    ['strata', 0.3 + 0.55 * a + 0.3 * (1 - e)],
    ['pixel', 0.04 + 0.9 * s + 0.25 * s * e],
  ] as Array<[GroundId, number]>);
  // Moon & Ring is a layered preset: a moon with its ring on a soft ground.
  const moonring = style === 'moonring';
  const moonGround = weightedPick(stream(SLOT.ground + 20), [
    ['clouds', 1.4],
    ['plain', 0.8],
    ['gradient', 0.8],
    ['strata', 0.5],
  ] as Array<[GroundId, number]>);
  const ground = overrides.ground !== 'auto' ? overrides.ground : moonring ? moonGround : autoGround;

  // ---- Main shape ----
  const available = (id: SubjectId) => {
    const needs = SUBJECTS.find((entry) => entry.id === id)?.needs;
    if (needs === 'melody') return data.melodyNotes >= 10;
    if (needs === 'bars') return data.bars >= 8;
    return true;
  };
  const subjectScore: Record<SubjectId, number> = {
    // A bare field is the most characteristic look of all — but needs a textured ground.
    none: ground === 'plain' ? 0 : 0.5 + 0.4 * (1 - d) + 0.2 * a,
    bloom: 0.35 + 0.45 * (1 - e) + 0.35 * (1 - v),
    tear: 0.2 + 0.6 * e + 0.35 * (1 - v),
    mass: 0.2 + 0.45 * e + 0.25 * t,
    islands: 0.25 + 0.35 * d + 0.2 * a,
    moon: (0.3 + 0.6 * a + 0.3 * (1 - e)) * 1.6,
    sun: 0.15 + 0.55 * v + 0.35 * a - 0.3 * t,
    pillar: 0.15 + 0.45 * a + 0.3 * t,
    crackle: -0.1 + 1.0 * t + 0.25 * (1 - v),
    shards: -0.25 + 1.0 * e + 0.45 * d,
    frame: -0.05 + 0.65 * e + 0.6 * p,
    glyphs: 0.05 + 0.5 * k + 0.35 * (1 - d) + 0.2 * mood.keyClarity,
    contour: 0.2 + 0.35 * k + 0.25 * s + 0.15 * e,
    skyline: 0.1 + 0.45 * e + 0.35 * p,
    ring: 0.1 + 0.45 * a,
  };
  // A busy background wants a calm, solid shape on it, not another busy one.
  const busyGround = ground === 'pixel' || ground === 'split';
  const busyShape = (id: SubjectId) => ['shards', 'crackle', 'skyline'].includes(id);
  // Weighted by the song's own tone, not a forced one: changing the colours
  // recolours the picture rather than swapping its shapes.
  const autoSubject = weightedPick(
    stream(SLOT.subject),
    (Object.keys(subjectScore) as SubjectId[])
      .filter(available)
      .map((id) => [id, subjectScore[id] * TONE_FIT[id][autoTone] * (busyGround && busyShape(id) ? 0.3 : 1)] as [SubjectId, number]),
  );
  const subject = moonring ? 'moon' : overrides.subject === 'auto' ? autoSubject : overrides.subject;

  // ---- Second shape ----
  const secondaryRandom = stream(SLOT.secondary);
  const partners = PAIRS[subject].filter(available);
  const wantsSecond = secondaryRandom.next() < 0.3 + 0.25 * d + 0.1 * a;
  const autoSecondary: SubjectId =
    wantsSecond && partners.length
      ? weightedPick(
          secondaryRandom,
          partners.map((id) => [id, Math.max(subjectScore[id], 0.15)] as [SubjectId, number]),
        )
      : 'none';
  const secondary = moonring ? 'ring' : overrides.secondary === 'auto' ? autoSecondary : overrides.secondary;

  // ---- Details ----
  const detailRandom = stream(SLOT.details);
  const rasterShape = ['bloom', 'tear', 'mass', 'islands', 'moon', 'pillar', 'sun'].includes(subject);
  const detailChance: Record<DetailId, number> = {
    arcs: rasterShape ? 0.2 + 0.45 * t : 0.06,
    frameLine: subject === 'frame' ? 0 : 0.16 + 0.2 * (1 - d),
    specks: 0.22 + 0.15 * d,
    glitch: 0.04 + 0.5 * t * e,
    grain: 0.2 + 0.3 * a,
    scanlines: 0.03 + 0.4 * s,
  };
  const autoDetails: DetailId[] = [];
  for (const id of shuffled(detailRandom, DETAILS.map((entry) => entry.id))) {
    if (autoDetails.length >= 3) break;
    if (detailRandom.next() < detailChance[id]) autoDetails.push(id);
  }
  const details = overrides.details ?? autoDetails;

  // ---- Composition ----
  const layout = stream(SLOT.layout);
  const centred = ['frame', 'glyphs', 'skyline', 'contour', 'none'].includes(subject);
  const anchor = weightedPick(layout, [
    ['right', 0.45],
    ['left', 0.2],
    ['centre', centred ? 1.2 : 0.15],
    ['corner', ['bloom', 'mass', 'sun', 'moon', 'tear'].includes(subject) ? 0.2 : 0],
    ['low', ['mass', 'sun', 'pillar'].includes(subject) ? 0.25 : 0.03],
  ] as Array<[Anchor, number]>);

  return {
    style,
    tone,
    ground,
    subject,
    secondary: secondary === subject ? 'none' : secondary,
    details,
    anchor,
    mirror: layout.next() < 0.3,
    scale: layout.range(0.85, 1.2),
    auto: {
      style: autoStyle,
      tone: autoTone,
      ground: autoGround,
      subject: autoSubject,
      secondary: autoSecondary,
      details: autoDetails,
    },
  };
}

/**
 * Draws one entry with probability ∝ weight^1.6: the song's preference is
 * clear, but a poor fit is unlikely rather than impossible.
 */
function weightedPick<T>(random: Random, entries: Array<[T, number]>): T {
  const weights = entries.map(([, weight]) => Math.pow(Math.max(weight, 0), 1.6));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return entries[0][0];
  let roll = random.next() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

function shuffled<T>(random: Random, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function nameOf<T extends string>(list: Array<{ id: T; name: string }>, id: T): string {
  return list.find((entry) => entry.id === id)?.name ?? id;
}

/** "Dark gradient · Moon + Ring", for the stage caption. */
export function describeRecipe(recipe: Recipe): string {
  if (recipe.style !== 'layered' && recipe.style !== 'moonring') return nameOf(STYLES, recipe.style);
  const tone = nameOf(TONES, recipe.tone);
  const ground = nameOf(GROUNDS, recipe.ground).toLowerCase();
  const shapes = [recipe.subject, recipe.secondary].filter((id) => id !== 'none').map((id) => nameOf(SUBJECTS, id));
  return [`${tone} ${ground}`, shapes.join(' + ')].filter(Boolean).join(' · ');
}
