/**
 * Reads track names straight out of the MIDI bytes.
 *
 * The parsing library is not a reliable source for these, for two reasons:
 *
 *  1. It splits one MTrk into several tracks whenever the chunk uses more than
 *     one program or channel, and channel-less meta events — which is what a
 *     track name is — are routed only to the first of those splits. Every other
 *     split comes back nameless.
 *  2. Its text decoder is `String.fromCharCode` over the raw bytes, i.e.
 *     latin-1. Any name written as UTF-8, which is what modern DAWs emit,
 *     arrives mangled.
 *
 * So we walk the chunks ourselves, decode properly, and record which
 * [program, channel] pairs each chunk covers so the names can be matched back
 * onto the parsed tracks.
 */

export interface MidiTrackMeta {
  /** FF 03 Sequence/Track Name. */
  name?: string;
  /** FF 04 Instrument Name. */
  instrumentName?: string;
  /** Whether the chunk contains any notes, as opposed to tempo/setup data only. */
  hasNotes: boolean;
  /** Channels the chunk plays notes on. */
  channels: Set<number>;
}

/** A program or bank change. Channels are shared by every chunk in a file. */
export interface ChannelEvent {
  tick: number;
  channel: number;
  kind: 'program' | 'bankMsb';
  value: number;
}

export interface MidiFileMeta {
  format: number;
  tracks: MidiTrackMeta[];
  /** Program and bank changes from every chunk, in tick order. */
  channelEvents: ChannelEvent[];
  /** `${tick}:${channel}:${pitch}` of each note-on → index of the chunk holding it. */
  noteOwners: Map<string, number>;
}

/**
 * Decodes a meta-event text payload.
 *
 * The spec predates Unicode and says nothing useful, so files carry whatever
 * their DAW wrote. UTF-8 is tried strictly first; anything that is not valid
 * UTF-8 is treated as Windows-1252, which covers the older files and is a
 * superset of latin-1 for the printable range.
 */
export function decodeMetaText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/, '').trim();
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes).replace(/\0+$/, '').trim();
    } catch {
      let out = '';
      for (const byte of bytes) out += String.fromCharCode(byte);
      return out.replace(/\0+$/, '').trim();
    }
  }
}

/**
 * Repairs a string that was already decoded byte-wise from UTF-8 bytes.
 *
 * Used for values that only reach us through the library. Re-interpreting the
 * code points as bytes and decoding as UTF-8 recovers the original; if the
 * result is not valid UTF-8 the text was genuinely latin-1 and is left alone.
 */
export function repairMetaText(text: string): string {
  if (!text || !/[\u0080-ÿ]/.test(text)) return text;

  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // A code point above 0xFF means this did not come from a byte-wise decode.
    if (code > 0xff) return text;
    bytes[i] = code;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

class ByteReader {
  offset = 0;
  constructor(readonly view: DataView) {}

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  ascii(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(this.view.getUint8(this.offset + i));
    this.offset += length;
    return out;
  }

  /** Standard MIDI variable-length quantity. */
  varInt(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value;
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    // Copy, so the slice does not pin the whole file buffer.
    return new Uint8Array(out);
  }
}

/**
 * Walks the chunk structure far enough to collect names and channel usage.
 * Anything unparseable returns what was gathered so far rather than throwing —
 * this is an enrichment pass, and the main parser owns error reporting.
 */
export function scanMidiMeta(data: ArrayBuffer): MidiFileMeta {
  const result: MidiFileMeta = { format: 1, tracks: [], channelEvents: [], noteOwners: new Map() };

  try {
    const reader = new ByteReader(new DataView(data));
    if (reader.remaining < 14 || reader.ascii(4) !== 'MThd') return result;

    const headerLength = reader.u32();
    const headerEnd = reader.offset + headerLength;
    result.format = reader.u16();
    reader.u16(); // track count, which we do not trust over the actual chunks
    reader.offset = headerEnd;

    while (reader.remaining >= 8) {
      const id = reader.ascii(4);
      const length = reader.u32();
      if (length < 0 || length > reader.remaining) break;

      const end = reader.offset + length;
      if (id === 'MTrk') {
        result.tracks.push(scanTrack(reader, end, result.tracks.length, result));
      }
      reader.offset = end;
    }
  } catch {
    // Truncated or malformed: keep whatever was read.
  }

  result.channelEvents.sort((a, b) => a.tick - b.tick);
  return result;
}

function scanTrack(
  reader: ByteReader,
  end: number,
  chunkIndex: number,
  file: MidiFileMeta,
): MidiTrackMeta {
  const meta: MidiTrackMeta = { hasNotes: false, channels: new Set() };
  let runningStatus = 0;
  let tick = 0;

  while (reader.offset < end) {
    tick += reader.varInt();

    let status = reader.u8();
    if (status < 0x80) {
      // Running status: this byte is already the first data byte.
      if (runningStatus === 0) break;
      reader.offset--;
      status = runningStatus;
    } else if (status < 0xf0) {
      runningStatus = status;
    }

    if (status === 0xff) {
      const type = reader.u8();
      const length = reader.varInt();
      if (reader.offset + length > end) break;
      const payload = reader.bytes(length);

      if (type === 0x03 && meta.name === undefined) {
        const text = decodeMetaText(payload);
        if (text) meta.name = text;
      } else if (type === 0x04 && meta.instrumentName === undefined) {
        const text = decodeMetaText(payload);
        if (text) meta.instrumentName = text;
      }
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const length = reader.varInt();
      reader.offset += length;
      continue;
    }

    const kind = status & 0xf0;
    const channel = status & 0x0f;

    if (kind === 0xc0) {
      file.channelEvents.push({ tick, channel, kind: 'program', value: reader.u8() });
      continue;
    }
    if (kind === 0xd0) {
      reader.u8();
      continue;
    }

    // Everything else in 0x80..0xEF carries two data bytes.
    const first = reader.u8();
    const second = reader.u8();

    if (kind === 0xb0 && first === 0) {
      file.channelEvents.push({ tick, channel, kind: 'bankMsb', value: second });
    } else if (kind === 0x90 && second > 0) {
      meta.hasNotes = true;
      meta.channels.add(channel);
      const key = `${tick}:${channel}:${first}`;
      if (!file.noteOwners.has(key)) file.noteOwners.set(key, chunkIndex);
    }
  }

  return meta;
}

export interface ResolvedTrackInfo {
  /** Whether the track was matched to the chunk it came from. */
  attributed: boolean;
  /** The track's own name, when the file gives it one that belongs to it. */
  trackName?: string;
  /** FF 04 instrument name, when attributable to this track. */
  instrumentName?: string;
  /** Program in effect on the channel when the track starts playing. */
  program?: number;
  /** Bank select MSB in effect at the same moment. */
  bankMsb?: number;
}

/**
 * Works out, for a parsed track, which chunk it came from and which
 * instrument its channel is set to.
 *
 * The chunk is found by the track's first note, which is exact however the
 * parser split or reordered chunks. Instruments are looked up across the
 * whole file rather than within the chunk, because channels are global: many
 * exporters put every program change on the first track.
 *
 * Names are only used when they belong to the track. In a format-0 file the
 * single chunk's name is the song title, and the same goes for a format-1
 * file's first chunk when it holds no notes — giving that name to every track
 * labels them all with the song title.
 */
export function createTrackResolver(meta: MidiFileMeta) {
  return (firstNote: { ticks: number; channel: number; midi: number } | undefined): ResolvedTrackInfo => {
    if (!firstNote) return { attributed: false };
    const { ticks, channel } = firstNote;
    const owner = meta.noteOwners.get(`${ticks}:${channel}:${firstNote.midi}`);
    const info: ResolvedTrackInfo = { attributed: owner !== undefined };

    const chunk = owner !== undefined ? meta.tracks[owner] : undefined;
    const isSequenceName = meta.format === 0 || (owner === 0 && !chunk?.hasNotes);
    if (chunk && !isSequenceName) {
      info.trackName = chunk.name;
      info.instrumentName = chunk.instrumentName;
    }

    // The program and bank in force when the track first sounds. If the file
    // only sets them after the first note, take the first setting instead.
    let program: number | undefined;
    let bank: number | undefined;
    let firstProgram: number | undefined;
    let firstBank: number | undefined;
    for (const event of meta.channelEvents) {
      if (event.channel !== channel) continue;
      if (event.kind === 'program') {
        if (firstProgram === undefined) firstProgram = event.value;
        if (event.tick <= ticks) program = event.value;
      } else {
        if (firstBank === undefined) firstBank = event.value;
        if (event.tick <= ticks) bank = event.value;
      }
      if (event.tick > ticks && firstProgram !== undefined && firstBank !== undefined) break;
    }
    info.program = program ?? firstProgram;
    info.bankMsb = bank ?? firstBank;
    return info;
  };
}
