/**
 * General MIDI instrument names.
 *
 * A MIDI file says which instrument plays a track with a program number
 * (0–127) on the track's channel. These are the standard GM names for those
 * numbers, written the way you would label a track — "Sawtooth Lead" rather
 * than "Lead 2 (sawtooth)" — so they read cleanly in a video.
 */
const PROGRAM_NAMES: readonly string[] = [
  // Piano
  'Grand Piano', 'Bright Piano', 'Electric Grand', 'Honky-tonk Piano',
  'Electric Piano', 'FM Electric Piano', 'Harpsichord', 'Clavinet',
  // Chromatic percussion
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  // Organ
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
  'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  // Guitar
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar',
  'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  // Bass
  'Acoustic Bass', 'Fingered Bass', 'Picked Bass', 'Fretless Bass',
  'Slap Bass', 'Slap Bass 2', 'Synth Bass', 'Synth Bass 2',
  // Strings
  'Violin', 'Viola', 'Cello', 'Contrabass',
  'Tremolo Strings', 'Pizzicato Strings', 'Harp', 'Timpani',
  // Ensemble
  'Strings', 'Slow Strings', 'Synth Strings', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  // Brass
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
  'French Horn', 'Brass Section', 'Synth Brass', 'Synth Brass 2',
  // Reed
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
  'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  // Pipe
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
  'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  // Synth lead
  'Square Lead', 'Sawtooth Lead', 'Calliope Lead', 'Chiff Lead',
  'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass + Lead',
  // Synth pad
  'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad',
  'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  // Synth effects
  'Rain FX', 'Soundtrack FX', 'Crystal FX', 'Atmosphere FX',
  'Brightness FX', 'Goblins FX', 'Echoes FX', 'Sci-Fi FX',
  // Ethnic
  'Sitar', 'Banjo', 'Shamisen', 'Koto',
  'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  // Percussive
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
  'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  // Sound effects
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
  'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

/** GM2 / GS drum kits, selected by program number on a rhythm channel. */
const DRUM_KITS: Readonly<Record<number, string>> = {
  0: 'Drums',
  8: 'Room Drums',
  16: 'Power Drums',
  24: 'Electronic Drums',
  25: 'Analog Drums',
  32: 'Jazz Drums',
  40: 'Brush Drums',
  48: 'Orchestral Percussion',
  56: 'SFX Kit',
};

/** Bank select MSB values that turn a channel into a drum kit. */
const GM2_RHYTHM_BANK = 120;
const GM2_MELODIC_BANK = 121;
const XG_DRUM_BANKS = new Set([126, 127]);

/**
 * Whether a channel is playing a drum kit. Channel 10 is the GM drum channel;
 * GM2 and XG files can also put a kit on any channel by bank select, which is
 * what the bank argument catches.
 */
export function isRhythmChannel(channel: number | undefined, bankMsb: number | undefined): boolean {
  if (bankMsb === GM2_RHYTHM_BANK || (bankMsb !== undefined && XG_DRUM_BANKS.has(bankMsb))) return true;
  // GM2 lets bank 121 turn channel 10 melodic.
  return channel === 9 && bankMsb !== GM2_MELODIC_BANK;
}

/** Display name for a melodic GM program. */
export function programName(program: number): string {
  return PROGRAM_NAMES[Math.max(0, Math.min(127, Math.round(program)))] ?? 'Instrument';
}

/** Display name for a drum kit program. Unlisted kits are still drums. */
export function drumKitName(program: number | undefined): string {
  return DRUM_KITS[program ?? 0] ?? 'Drums';
}

/** The instrument a channel plays, as the file specifies it. */
export function instrumentLabel(program: number | undefined, rhythm: boolean): string {
  if (rhythm) return drumKitName(program);
  return programName(program ?? 0);
}
