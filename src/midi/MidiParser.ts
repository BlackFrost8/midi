import { Midi } from '@tonejs/midi';
import type {
  MidiMarker,
  MidiProject,
  NoteRegion,
  TempoEvent,
  TimeSignatureEvent,
  TrackGroup,
  VisualNote,
  VisualTrack,
} from '../models/MidiProject';
import { classifyTrack, groupForFamily } from './InstrumentClassifier';
import { instrumentLabel, isRhythmChannel } from './GeneralMidi';
import { createTrackResolver, repairMetaText, scanMidiMeta } from './MidiMeta';
import { TimeMapper } from './TimeMapper';
import { toRoman } from '../utils/formatting';

export interface ParseOptions {
  /**
   * Type-0 files cram every instrument onto one track distinguished only by
   * channel. When enabled, such tracks are split so each channel becomes its
   * own visual lane.
   */
  splitByChannel: boolean;
  /** Rest length (in bars) that ends a clip and starts a new one. */
  regionGapBars: number;
  /** Drop tracks that contain no notes at all. */
  dropEmptyTracks: boolean;
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  splitByChannel: true,
  regionGapBars: 2,
  dropEmptyTracks: true,
};

export class MidiParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'MidiParseError';
  }
}

interface RawNote {
  midi: number;
  velocity: number;
  ticks: number;
  durationTicks: number;
  channel: number;
}

/** Intermediate bundle before pitch/region analysis runs. */
interface RawTrack {
  /** The track's own name from the file, when it has one. */
  name: string;
  rawName?: string;
  /** FF 04 instrument name from the file. */
  instrumentName?: string;
  /** Program actually set on the channel by the file; undefined if never set. */
  program?: number;
  /** Bank select MSB on the channel, which can turn it into a drum kit. */
  bankMsb?: number;
  channel?: number;
  isPercussion: boolean;
  notes: RawNote[];
}

export function parseMidi(
  data: ArrayBuffer,
  fileName: string,
  options: ParseOptions = DEFAULT_PARSE_OPTIONS,
): MidiProject {
  let midi: Midi;
  try {
    midi = new Midi(data);
  } catch (error) {
    throw new MidiParseError(
      'This file could not be read as a MIDI file. It may be corrupt or in an unsupported format.',
      error,
    );
  }

  const ppq = midi.header.ppq > 0 ? midi.header.ppq : 480;
  const tempos = buildTempoMap(midi, ppq);
  const timeSignatures = buildTimeSignatureMap(midi, ppq, tempos);
  const mapper = new TimeMapper(ppq, tempos, timeSignatures);

  // Names come from our own pass over the bytes, not the library. See MidiMeta.
  const rawTracks = collectRawTracks(midi, options, scanMidiMeta(data));
  const tracks = rawTracks
    .map((raw, index) => buildVisualTrack(raw, index, mapper, options))
    .filter((track) => !options.dropEmptyTracks || track.noteCount > 0);

  // Re-index after filtering so ids and lane order stay contiguous.
  tracks.forEach((track, index) => {
    track.index = index;
  });
  numberDuplicateLabels(tracks);

  // The song ends when the last note stops sounding — not when the last note
  // starts. Notes are sorted by start, so the final one can be a short note
  // inside a chord whose other notes are held longer.
  const durationTicks = tracks.reduce((max, track) => {
    let end = max;
    for (const note of track.notes) end = Math.max(end, note.startTicks + note.durationTicks);
    return end;
  }, 0);
  const durationBeats = Math.max(mapper.ticksToBeats(durationTicks), 1);
  const durationSeconds = mapper.beatsToSeconds(durationBeats);

  const totalNotes = tracks.reduce((sum, t) => sum + t.noteCount, 0);
  const pitched = tracks.filter((t) => t.noteCount > 0);

  return {
    title: deriveTitle(midi, fileName),
    ppq,
    durationTicks,
    durationBeats,
    durationSeconds,
    tempos,
    timeSignatures,
    markers: buildMarkers(midi, mapper),
    tracks,
    groups: buildGroups(tracks),
    bars: mapper.buildBarGrid(durationBeats),
    totalNotes,
    minPitch: pitched.length ? Math.min(...pitched.map((t) => t.minPitch)) : 36,
    maxPitch: pitched.length ? Math.max(...pitched.map((t) => t.maxPitch)) : 84,
  };
}

/**
 * Names a conductor or tempo-map track carries. In a format-1 file the first
 * track's name doubles as the sequence name, so a housekeeping track called
 * "Conductor" would otherwise become the title of the piece.
 */
const GENERIC_FIRST_TRACK = /^(conductor|tempo(\s*map)?|master|control|meta|markers?|song|untitled)$/i;

function deriveTitle(midi: Midi, fileName: string): string {
  const headerName = repairMetaText(midi.header.name?.trim() ?? '');
  // A placeholder such as "_ _ _ _" or "---" carries no title.
  const meaningful = /[\p{L}\p{N}]/u.test(headerName);
  if (headerName && meaningful && !GENERIC_FIRST_TRACK.test(headerName)) return headerName;
  return fileName.replace(/\.(mid|midi|rmi)$/i, '');
}

/**
 * Converts the tempo list into events carrying cumulative seconds, so any later
 * beats→seconds lookup is a single subtraction instead of a walk.
 */
function buildTempoMap(midi: Midi, ppq: number): TempoEvent[] {
  const source = [...midi.header.tempos]
    .filter((t) => Number.isFinite(t.bpm) && t.bpm > 0)
    .sort((a, b) => a.ticks - b.ticks);

  if (!source.length || source[0].ticks > 0) {
    source.unshift({ ticks: 0, bpm: source[0]?.bpm ?? 120, time: 0 } as (typeof source)[number]);
  }

  const events: TempoEvent[] = [];
  let seconds = 0;
  for (let i = 0; i < source.length; i++) {
    const beats = source[i].ticks / ppq;
    if (i > 0) {
      const prev = events[i - 1];
      seconds = prev.seconds + ((beats - prev.beats) * 60) / prev.bpm;
    }
    events.push({ ticks: source[i].ticks, beats, seconds, bpm: source[i].bpm });
  }
  return events;
}

function buildTimeSignatureMap(midi: Midi, ppq: number, tempos: TempoEvent[]): TimeSignatureEvent[] {
  const mapper = new TimeMapper(ppq, tempos, [
    { ticks: 0, beats: 0, seconds: 0, numerator: 4, denominator: 4, barStart: 1 },
  ]);

  const source = [...midi.header.timeSignatures]
    .filter((s) => Array.isArray(s.timeSignature) && s.timeSignature.length === 2)
    .sort((a, b) => a.ticks - b.ticks);

  if (!source.length || source[0].ticks > 0) {
    source.unshift({ ticks: 0, timeSignature: [4, 4] } as (typeof source)[number]);
  }

  const events: TimeSignatureEvent[] = [];
  for (let i = 0; i < source.length; i++) {
    const [numerator, denominator] = source[i].timeSignature;
    if (numerator <= 0 || denominator <= 0) continue;
    const beats = source[i].ticks / ppq;
    let barStart = 1;
    if (i > 0 && events.length) {
      const prev = events[events.length - 1];
      const barsElapsed = Math.round((beats - prev.beats) / TimeMapper.beatsPerBar(prev));
      barStart = prev.barStart + Math.max(barsElapsed, 0);
    }
    events.push({
      ticks: source[i].ticks,
      beats,
      seconds: mapper.beatsToSeconds(beats),
      numerator,
      denominator,
      barStart,
    });
  }
  return events;
}

function buildMarkers(midi: Midi, mapper: TimeMapper): MidiMarker[] {
  const meta = (midi.header as unknown as { meta?: Array<{ ticks: number; type: string; text?: string }> })
    .meta;
  if (!Array.isArray(meta)) return [];

  return meta
    .filter((event) => event.type === 'marker' || event.type === 'cuePoint')
    .map((event) => {
      const beats = mapper.ticksToBeats(event.ticks);
      return {
        ticks: event.ticks,
        beats,
        seconds: mapper.beatsToSeconds(beats),
        // Marker text reaches us latin-1 decoded, same as track names.
        text: repairMetaText((event.text ?? '').trim()),
      };
    })
    .filter((marker) => marker.text.length > 0)
    .sort((a, b) => a.beats - b.beats);
}

function collectRawTracks(
  midi: Midi,
  options: ParseOptions,
  fileMeta: ReturnType<typeof scanMidiMeta>,
): RawTrack[] {
  const out: RawTrack[] = [];
  const resolve = createTrackResolver(fileMeta);

  /** Everything the file says about the part playing `notes` on `channel`. */
  const describe = (notes: RawNote[], channel: number | undefined, libraryName: string): RawTrack => {
    const first = notes.reduce<RawNote | undefined>(
      (earliest, note) => (!earliest || note.ticks < earliest.ticks ? note : earliest),
      undefined,
    );
    const info = resolve(first ? { ticks: first.ticks, channel: first.channel, midi: first.midi } : undefined);
    // The library's own name is only a fallback for tracks the byte scan could
    // not attribute, and never in a format-0 file, where it is the song title.
    const name = info.attributed ? (info.trackName ?? '') : fileMeta.format === 0 ? '' : libraryName;

    return {
      name,
      rawName: name || undefined,
      instrumentName: info.instrumentName,
      program: info.program,
      bankMsb: info.bankMsb,
      channel,
      isPercussion: isRhythmChannel(channel, info.bankMsb),
      notes,
    };
  };

  for (const track of midi.tracks) {
    const notes: RawNote[] = track.notes.map((note) => ({
      midi: note.midi,
      velocity: note.velocity,
      ticks: note.ticks,
      durationTicks: Math.max(note.durationTicks, 1),
      channel: track.channel,
    }));
    const libraryName = repairMetaText(track.name?.trim() ?? '');

    // @tonejs/midi already separates channels for most files; this handles the
    // stragglers where a single track object carries several channels.
    const channels = new Set(notes.map((n) => n.channel));
    if (!options.splitByChannel || channels.size <= 1) {
      out.push(describe(notes, track.channel, libraryName));
      continue;
    }

    for (const channel of [...channels].sort((a, b) => a - b)) {
      out.push(describe(notes.filter((n) => n.channel === channel), channel, libraryName));
    }
  }

  return out;
}

function buildVisualTrack(
  raw: RawTrack,
  index: number,
  mapper: TimeMapper,
  options: ParseOptions,
): VisualTrack {
  const sorted = [...raw.notes].sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  const id = `track-${index}`;

  let minPitch = 127;
  let maxPitch = 0;
  let maxDurationBeats = 0;
  let maxDurationSeconds = 0;
  const pitches = new Set<number>();

  const notes: VisualNote[] = sorted.map((note, i) => {
    const startBeats = mapper.ticksToBeats(note.ticks);
    const endBeats = mapper.ticksToBeats(note.ticks + note.durationTicks);
    const startSeconds = mapper.beatsToSeconds(startBeats);
    const endSeconds = mapper.beatsToSeconds(endBeats);
    const durationBeats = Math.max(endBeats - startBeats, 1e-4);
    const durationSeconds = Math.max(endSeconds - startSeconds, 1e-4);

    if (note.midi < minPitch) minPitch = note.midi;
    if (note.midi > maxPitch) maxPitch = note.midi;
    pitches.add(note.midi);
    if (durationBeats > maxDurationBeats) maxDurationBeats = durationBeats;
    if (durationSeconds > maxDurationSeconds) maxDurationSeconds = durationSeconds;

    return {
      id: `${id}-n${i}`,
      pitch: note.midi,
      velocity: note.velocity,
      startTicks: note.ticks,
      durationTicks: note.durationTicks,
      startBeats,
      durationBeats,
      startSeconds,
      durationSeconds,
      channel: note.channel,
    };
  });

  if (!notes.length) {
    minPitch = 60;
    maxPitch = 60;
  }

  const family = classifyTrack({
    name: raw.name,
    instrumentName: raw.instrumentName,
    program: raw.program,
    channel: raw.channel,
    isPercussionChannel: raw.isPercussion,
    minPitch,
    maxPitch,
    noteCount: notes.length,
  });

  // Name the track after the instrument the file specifies: its FF 04
  // instrument name, else the program on its channel, else the drum kit. A
  // channel with no program change has not specified an instrument — GM would
  // play a piano, but calling it "Grand Piano" would be a guess — so then the
  // track's own name is used, and only failing that a generic label.
  const specified =
    raw.instrumentName ||
    (raw.program !== undefined || raw.isPercussion ? instrumentLabel(raw.program, raw.isPercussion) : '');
  const label = specified || raw.name || fallbackName(family, index);
  const name = label;
  const span = notes.length
    ? notes[notes.length - 1].startBeats + notes[notes.length - 1].durationBeats - notes[0].startBeats
    : 0;

  return {
    id,
    index,
    name,
    rawName: raw.rawName,
    instrument: specified || undefined,
    instrumentLabel: label,
    family,
    programNumber: raw.program,
    channel: raw.channel,
    isPercussion: raw.isPercussion,
    notes,
    regions: buildRegions(id, name, notes, mapper, options.regionGapBars),
    minPitch,
    maxPitch,
    distinctPitches: [...pitches].sort((a, b) => a - b),
    maxDurationBeats,
    maxDurationSeconds,
    noteCount: notes.length,
    density: span > 0 ? notes.length / span : 0,
  };
}

/**
 * Two tracks playing the same instrument would otherwise be indistinguishable,
 * so each repeated label is numbered in lane order: "Grand Piano 1", "Grand
 * Piano 2". Unique labels are left alone.
 */
function numberDuplicateLabels(tracks: VisualTrack[]): void {
  const counts = new Map<string, number>();
  for (const track of tracks) counts.set(track.instrumentLabel, (counts.get(track.instrumentLabel) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const track of tracks) {
    const label = track.instrumentLabel;
    if ((counts.get(label) ?? 0) < 2) continue;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    track.instrumentLabel = `${label} ${n}`;
    track.name = track.instrumentLabel;
  }
}

/**
 * The spec is explicit that we should not invent names when the file has none —
 * so an unclassified track becomes "Track 03", not a guess.
 */
function fallbackName(family: string, index: number): string {
  if (family === 'unknown') return `Track ${String(index + 1).padStart(2, '0')}`;
  return family.charAt(0).toUpperCase() + family.slice(1);
}

/**
 * Splits a track's notes into clips wherever the gap between the end of all
 * sounding notes and the next note start exceeds `gapBars` bars.
 */
function buildRegions(
  trackId: string,
  trackName: string,
  notes: VisualNote[],
  mapper: TimeMapper,
  gapBars: number,
): NoteRegion[] {
  if (!notes.length) return [];

  const spans: Array<{ start: number; end: number; from: number; to: number }> = [];
  let start = notes[0].startBeats;
  let end = notes[0].startBeats + notes[0].durationBeats;
  let from = 0;

  for (let i = 1; i < notes.length; i++) {
    const note = notes[i];
    const sig = mapper.timeSignatureAtBeats(note.startBeats);
    const gapThreshold = TimeMapper.beatsPerBar(sig) * gapBars;

    if (note.startBeats - end > gapThreshold) {
      spans.push({ start, end, from, to: i });
      start = note.startBeats;
      end = note.startBeats + note.durationBeats;
      from = i;
    } else {
      end = Math.max(end, note.startBeats + note.durationBeats);
    }
  }
  spans.push({ start, end, from, to: notes.length });

  const multiple = spans.length > 1;
  return spans.map((span, i) => ({
    id: `${trackId}-r${i}`,
    name: multiple ? `${trackName} ${toRoman(i + 1)}` : trackName,
    ordinal: multiple ? toRoman(i + 1) : null,
    startBeats: span.start,
    endBeats: span.end,
    startSeconds: mapper.beatsToSeconds(span.start),
    endSeconds: mapper.beatsToSeconds(span.end),
    noteStart: span.from,
    noteEnd: span.to,
  }));
}

function buildGroups(tracks: VisualTrack[]): TrackGroup[] {
  const byName = new Map<string, TrackGroup>();
  for (const track of tracks) {
    const groupName = groupForFamily(track.family);
    let group = byName.get(groupName);
    if (!group) {
      group = { id: `group-${groupName.toLowerCase()}`, name: groupName, trackIds: [], collapsed: false };
      byName.set(groupName, group);
    }
    group.trackIds.push(track.id);
    track.groupId = group.id;
  }
  return [...byName.values()];
}
