import type { InstrumentFamily } from '../models/MidiProject';

/**
 * Classification order follows the spec: an explicit track name wins, then the
 * General MIDI program number, then the percussion channel, then the note range.
 * When nothing is conclusive we return 'unknown' rather than guessing.
 */

interface NameRule {
  family: InstrumentFamily;
  patterns: RegExp;
}

// Ordered most-specific first: "double bass" must not match the "bass" rule.
const NAME_RULES: NameRule[] = [
  { family: 'cello', patterns: /\b(cello|violoncello|vc\b|vlc)\b/i },
  { family: 'viola', patterns: /\b(viola|vla)\b/i },
  { family: 'violin', patterns: /\b(violin|vln|vl\s?[i1]{1,2}|fiddle)\b/i },
  { family: 'bass', patterns: /\b(contrabass|double\s?bass|upright\s?bass|bass\s?guitar|sub\s?bass|808|bass)\b/i },
  { family: 'drums', patterns: /\b(drum|kick|snare|hat|hi-?hat|tom|cymbal|kit|beat|perc\s?kit)\b/i },
  { family: 'percussion', patterns: /\b(perc|timpani|timp|glocken|marimba|xylo|vibra|taiko|shaker|tambourine|triangle|gong|chimes|bells)\b/i },
  { family: 'choir', patterns: /\b(choir|chorus|aah|ooh|voices|vox\s?pad|gregorian)\b/i },
  { family: 'voice', patterns: /\b(vocal|voice|vox|lead\s?vox|soprano|alto|tenor|baritone)\b/i },
  { family: 'brass', patterns: /\b(brass|horn|trumpet|trombone|tuba|cornet|flugel)\b/i },
  { family: 'woodwinds', patterns: /\b(flute|clarinet|oboe|bassoon|piccolo|sax|saxophone|recorder|woodwind|english\s?horn|pan\s?flute|whistle)\b/i },
  { family: 'strings', patterns: /\b(strings|string\s?ens|orchestra|ensemble|harp|pizz|tremolo|arco|spiccato|ostinato)\b/i },
  { family: 'organ', patterns: /\b(organ|hammond|rhodes\s?organ|church\s?organ)\b/i },
  { family: 'guitar', patterns: /\b(guitar|gtr|acoustic\s?gt|electric\s?gt|nylon|steel\s?string)\b/i },
  { family: 'piano', patterns: /\b(piano|pno|keys|keyboard|rhodes|wurli|clav|celesta|harpsichord|epiano|e\.?\s?piano|grand)\b/i },
  { family: 'pad', patterns: /\b(pad|atmos|ambient|texture|drone|swell|warmth)\b/i },
  { family: 'arpeggio', patterns: /\b(arp|arpeggio|sequence|seq\b|pluck\s?seq)\b/i },
  { family: 'synth', patterns: /\b(synth|saw|square|lead|pluck|wobble|fm\b|analog|moog|bell\s?synth)\b/i },
];

/** GM program ranges → family. Ranges are inclusive on both ends. */
const PROGRAM_RANGES: Array<[number, number, InstrumentFamily]> = [
  [0, 7, 'piano'],
  [8, 15, 'percussion'], // chromatic percussion
  [16, 23, 'organ'],
  [24, 31, 'guitar'],
  [32, 39, 'bass'],
  [40, 40, 'violin'],
  [41, 41, 'viola'],
  [42, 42, 'cello'],
  [43, 43, 'bass'], // contrabass
  [44, 47, 'strings'],
  [48, 51, 'strings'], // string / synth-string ensembles
  [52, 54, 'choir'],
  [55, 55, 'brass'], // orchestra hit
  [56, 63, 'brass'],
  [64, 79, 'woodwinds'],
  [80, 87, 'synth'], // synth lead
  [88, 95, 'pad'], // synth pad
  [96, 103, 'synth'], // synth effects
  [104, 111, 'synth'], // ethnic
  [112, 119, 'percussion'],
  [120, 127, 'synth'], // sound effects
];

export function familyFromName(name: string | undefined): InstrumentFamily | null {
  if (!name) return null;
  const cleaned = name.trim();
  if (!cleaned) return null;
  for (const rule of NAME_RULES) {
    if (rule.patterns.test(cleaned)) return rule.family;
  }
  return null;
}

export function familyFromProgram(program: number | undefined): InstrumentFamily | null {
  if (program == null || !Number.isFinite(program)) return null;
  for (const [lo, hi, family] of PROGRAM_RANGES) {
    if (program >= lo && program <= hi) return family;
  }
  return null;
}

/**
 * Last resort: infer from tessitura. Only used when the name and program number
 * both fail, and only to separate obvious bass parts from obvious lead parts.
 */
function familyFromRange(minPitch: number, maxPitch: number, noteCount: number): InstrumentFamily {
  if (noteCount === 0) return 'unknown';
  const span = maxPitch - minPitch;
  if (maxPitch <= 52) return 'bass'; // nothing above E3
  if (span > 48) return 'piano'; // four-octave-plus span is keyboard-like
  return 'unknown';
}

export interface ClassifyInput {
  name?: string;
  instrumentName?: string;
  program?: number;
  channel?: number;
  isPercussionChannel: boolean;
  minPitch: number;
  maxPitch: number;
  noteCount: number;
}

export function classifyTrack(input: ClassifyInput): InstrumentFamily {
  if (input.isPercussionChannel) return 'drums';

  const byName = familyFromName(input.name) ?? familyFromName(input.instrumentName);
  if (byName) return byName;

  const byProgram = familyFromProgram(input.program);
  if (byProgram) return byProgram;

  return familyFromRange(input.minPitch, input.maxPitch, input.noteCount);
}

const FAMILY_LABELS: Record<InstrumentFamily, string> = {
  piano: 'Piano',
  strings: 'Strings',
  cello: 'Cello',
  violin: 'Violin',
  viola: 'Viola',
  bass: 'Bass',
  choir: 'Choir',
  voice: 'Voice',
  brass: 'Brass',
  woodwinds: 'Woodwinds',
  percussion: 'Percussion',
  drums: 'Drums',
  synth: 'Synth',
  pad: 'Pad',
  arpeggio: 'Arpeggio',
  guitar: 'Guitar',
  organ: 'Organ',
  unknown: 'Unknown',
};

export function familyLabel(family: InstrumentFamily): string {
  return FAMILY_LABELS[family];
}

/** Which group a family belongs to, for the collapsible track grouping. */
const FAMILY_GROUPS: Record<InstrumentFamily, string> = {
  violin: 'Strings',
  viola: 'Strings',
  cello: 'Strings',
  strings: 'Strings',
  bass: 'Strings',
  piano: 'Keys',
  organ: 'Keys',
  guitar: 'Guitar',
  choir: 'Voices',
  voice: 'Voices',
  brass: 'Brass',
  woodwinds: 'Woodwinds',
  drums: 'Percussion',
  percussion: 'Percussion',
  synth: 'Synth',
  pad: 'Synth',
  arpeggio: 'Synth',
  unknown: 'Other',
};

export function groupForFamily(family: InstrumentFamily): string {
  return FAMILY_GROUPS[family];
}
