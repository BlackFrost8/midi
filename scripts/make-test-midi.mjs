/**
 * Generates the test MIDI files used to check the renderer.
 *
 * Writes standard MIDI files (format 1) by hand so the project has fixtures
 * without pulling in a writer dependency. Run with: npm run make-test-midi
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PPQ = 480;
const OUT_DIR = join(process.cwd(), 'test-midi');

// ---------- Binary helpers ----------

function varInt(value) {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function u32(value) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function u16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function text(str) {
  return [...Buffer.from(str, 'ascii')];
}

/** Builds an MTrk chunk from absolute-time events. */
function trackChunk(events) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || (a.order ?? 0) - (b.order ?? 0));
  const bytes = [];
  let last = 0;
  for (const event of sorted) {
    bytes.push(...varInt(Math.max(0, Math.round(event.tick - last))));
    bytes.push(...event.data);
    last = event.tick;
  }
  bytes.push(...varInt(0), 0xff, 0x2f, 0x00); // end of track
  return [...text('MTrk'), ...u32(bytes.length), ...bytes];
}

function headerChunk(trackCount) {
  return [...text('MThd'), ...u32(6), ...u16(1), ...u16(trackCount), ...u16(PPQ)];
}

const meta = {
  trackName: (name) => [0xff, 0x03, ...varInt(name.length), ...text(name)],
  marker: (name) => [0xff, 0x06, ...varInt(name.length), ...text(name)],
  tempo: (bpm) => {
    const usPerQuarter = Math.round(60_000_000 / bpm);
    return [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff];
  },
  timeSignature: (numerator, denominator) => [
    0xff,
    0x58,
    0x04,
    numerator,
    Math.log2(denominator),
    24,
    8,
  ],
  program: (channel, program) => [0xc0 | channel, program],
};

function noteEvents(tick, durationTicks, pitch, velocity, channel) {
  return [
    { tick, data: [0x90 | channel, pitch, velocity], order: 1 },
    { tick: tick + durationTicks, data: [0x80 | channel, pitch, 0], order: 0 },
  ];
}

function writeMidi(name, tracks) {
  const bytes = [...headerChunk(tracks.length)];
  for (const events of tracks) bytes.push(...trackChunk(events));
  const file = join(OUT_DIR, name);
  writeFileSync(file, Buffer.from(bytes));
  console.log(`${name.padEnd(30)} ${(bytes.length / 1024).toFixed(1)} KB`);
}

// ---------- Musical helpers ----------

const B = PPQ; // one quarter note
const BAR = PPQ * 4;

/** Deterministic pseudo-random so fixtures are reproducible. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];

function scalePitch(root, degree) {
  const octave = Math.floor(degree / 7);
  return root + octave * 12 + MINOR[((degree % 7) + 7) % 7];
}

// ---------- Fixtures ----------

mkdirSync(OUT_DIR, { recursive: true });

// 1. Simple piano
{
  const conductor = [
    { tick: 0, data: meta.trackName('Conductor') },
    { tick: 0, data: meta.tempo(84) },
    { tick: 0, data: meta.timeSignature(4, 4) },
  ];
  const piano = [
    { tick: 0, data: meta.trackName('Piano') },
    { tick: 0, data: meta.program(0, 0) },
  ];
  const random = rng(7);
  for (let bar = 0; bar < 16; bar++) {
    for (let step = 0; step < 8; step++) {
      const tick = bar * BAR + step * (B / 2);
      const degree = 7 + Math.floor(random() * 8);
      piano.push(...noteEvents(tick, B / 2 - 20, scalePitch(60, degree), 70 + Math.floor(random() * 40), 0));
    }
    piano.push(...noteEvents(bar * BAR, BAR - 30, scalePitch(36, bar % 4), 64, 0));
  }
  writeMidi('01-simple-piano.mid', [conductor, piano]);
}

// 2. Piano + strings
{
  const conductor = [
    { tick: 0, data: meta.trackName('Conductor') },
    { tick: 0, data: meta.tempo(72) },
    { tick: 0, data: meta.timeSignature(4, 4) },
    { tick: 0, data: meta.marker('INTRO') },
    { tick: BAR * 8, data: meta.marker('BUILD') },
    { tick: BAR * 20, data: meta.marker('CLIMAX') },
    { tick: BAR * 30, data: meta.marker('OUTRO') },
  ];
  const right = [{ tick: 0, data: meta.trackName('Piano Right') }, { tick: 0, data: meta.program(0, 0) }];
  const left = [{ tick: 0, data: meta.trackName('Piano Left') }, { tick: 0, data: meta.program(1, 0) }];
  const cello = [{ tick: 0, data: meta.trackName('Cello') }, { tick: 0, data: meta.program(2, 42) }];
  const violin = [{ tick: 0, data: meta.trackName('Violin I') }, { tick: 0, data: meta.program(3, 40) }];

  const random = rng(11);
  for (let bar = 0; bar < 36; bar++) {
    const tickBase = bar * BAR;
    for (let step = 0; step < 16; step++) {
      right.push(
        ...noteEvents(tickBase + step * (B / 4), B / 4 - 10, scalePitch(67, 7 + (step % 5)), 60 + Math.floor(random() * 45), 0),
      );
    }
    left.push(...noteEvents(tickBase, BAR - 20, scalePitch(43, bar % 4), 70, 1));
    left.push(...noteEvents(tickBase + B * 2, B * 2 - 20, scalePitch(43, (bar % 4) + 2), 62, 1));

    // Cello rests during the intro, so its entrance is visible.
    if (bar >= 8) cello.push(...noteEvents(tickBase, BAR - 40, scalePitch(48, bar % 7), 78, 2));
    if (bar >= 20 && bar < 30) {
      violin.push(...noteEvents(tickBase, B * 3, scalePitch(72, (bar % 5) + 3), 88, 3));
    }
  }
  writeMidi('02-piano-strings.mid', [conductor, right, left, cello, violin]);
}

// 3. Full orchestral
{
  const conductor = [
    { tick: 0, data: meta.trackName('Conductor') },
    { tick: 0, data: meta.tempo(96) },
    { tick: 0, data: meta.timeSignature(4, 4) },
    { tick: 0, data: meta.marker('I. ASCENT') },
    { tick: BAR * 16, data: meta.marker('II. WEIGHT') },
    { tick: BAR * 34, data: meta.marker('III. RELEASE') },
  ];
  const parts = [
    ['Violin I', 40, 0, 76, 2, 0],
    ['Violin II', 40, 1, 71, 2, 4],
    ['Viola', 41, 2, 64, 3, 2],
    ['Cello', 42, 3, 52, 4, 0],
    ['Contrabass', 43, 4, 40, 8, 6],
    ['French Horn', 60, 5, 60, 4, 8],
    ['Trumpet', 56, 6, 72, 4, 12],
    ['Flute', 73, 7, 84, 2, 6],
    ['Clarinet', 71, 8, 67, 3, 10],
    ['Choir Aahs', 52, 10, 60, 8, 16],
    ['Timpani', 47, 11, 36, 4, 4],
    ['Harp', 46, 12, 62, 1, 0],
  ];
  const tracks = [conductor];
  for (const [name, program, channel, root, noteBeats, entryBar] of parts) {
    const events = [
      { tick: 0, data: meta.trackName(name) },
      { tick: 0, data: meta.program(channel, program) },
    ];
    const random = rng(name.length * 977 + channel);
    for (let bar = entryBar; bar < 48; bar++) {
      // Every part drops out for a stretch, so entrances and exits read clearly.
      if (bar >= 26 && bar < 30 && channel % 3 === 0) continue;
      const perBar = Math.max(1, Math.round(4 / noteBeats));
      for (let n = 0; n < perBar; n++) {
        const tick = bar * BAR + n * (BAR / perBar);
        const degree = 4 + Math.floor(random() * 9);
        events.push(
          ...noteEvents(tick, (BAR / perBar) - 25, scalePitch(root, degree), 55 + Math.floor(random() * 55), channel),
        );
      }
    }
    tracks.push(events);
  }
  writeMidi('03-orchestral.mid', tracks);
}

// 4. Drums (channel 10)
{
  const conductor = [
    { tick: 0, data: meta.trackName('Conductor') },
    { tick: 0, data: meta.tempo(128) },
    { tick: 0, data: meta.timeSignature(4, 4) },
  ];
  const drums = [{ tick: 0, data: meta.trackName('Drum Kit') }];
  for (let bar = 0; bar < 32; bar++) {
    const base = bar * BAR;
    for (let step = 0; step < 16; step++) {
      const tick = base + step * (B / 4);
      if (step % 8 === 0) drums.push(...noteEvents(tick, 60, 36, 110, 9)); // kick
      if (step % 8 === 4) drums.push(...noteEvents(tick, 60, 38, 100, 9)); // snare
      drums.push(...noteEvents(tick, 40, 42, step % 2 ? 60 : 84, 9)); // hats
    }
    if (bar % 8 === 7) drums.push(...noteEvents(base + B * 3, 200, 49, 118, 9)); // crash
  }
  writeMidi('04-drums.mid', [conductor, drums]);
}

// 5. Tempo and time-signature changes
{
  const conductor = [
    { tick: 0, data: meta.trackName('Conductor') },
    { tick: 0, data: meta.tempo(60) },
    { tick: 0, data: meta.timeSignature(4, 4) },
    { tick: BAR * 4, data: meta.tempo(90) },
    { tick: BAR * 4, data: meta.timeSignature(3, 4) },
    { tick: BAR * 4 + PPQ * 3 * 4, data: meta.timeSignature(7, 8) },
    { tick: BAR * 4 + PPQ * 3 * 4, data: meta.tempo(140) },
    { tick: BAR * 4 + PPQ * 3 * 4 + PPQ * 3.5 * 4, data: meta.timeSignature(4, 4) },
    { tick: BAR * 4 + PPQ * 3 * 4 + PPQ * 3.5 * 4, data: meta.tempo(72) },
  ];
  const lead = [{ tick: 0, data: meta.trackName('Lead Synth') }, { tick: 0, data: meta.program(0, 81) }];
  const pad = [{ tick: 0, data: meta.trackName('Warm Pad') }, { tick: 0, data: meta.program(1, 89) }];
  for (let i = 0; i < 96; i++) {
    lead.push(...noteEvents(i * (B / 2), B / 2 - 20, scalePitch(64, i % 12), 80, 0));
    if (i % 8 === 0) pad.push(...noteEvents(i * (B / 2), B * 4, scalePitch(48, (i / 8) % 5), 55, 1));
  }
  writeMidi('05-tempo-changes.mid', [conductor, lead, pad]);
}

// 6. Stress test: ~60k notes across 24 tracks
{
  const conductor = [
    { tick: 0, data: meta.trackName('Conductor') },
    { tick: 0, data: meta.tempo(150) },
    { tick: 0, data: meta.timeSignature(4, 4) },
  ];
  const tracks = [conductor];
  for (let t = 0; t < 24; t++) {
    const channel = t % 15 === 9 ? 10 % 16 : t % 15;
    const events = [
      { tick: 0, data: meta.trackName(`Layer ${String(t + 1).padStart(2, '0')}`) },
      { tick: 0, data: meta.program(channel, (t * 7) % 96) },
    ];
    const random = rng(t * 3121 + 5);
    for (let i = 0; i < 2500; i++) {
      const tick = Math.floor(random() * BAR * 200);
      events.push(
        ...noteEvents(tick, Math.floor(B / 8 + random() * B), 36 + Math.floor(random() * 60), 40 + Math.floor(random() * 80), channel),
      );
    }
    tracks.push(events);
  }
  writeMidi('06-stress-60k.mid', tracks);
}

// 7. Edge cases: unnamed tracks, an empty track, extreme note lengths
{
  const conductor = [
    { tick: 0, data: meta.tempo(100) },
    { tick: 0, data: meta.timeSignature(5, 4) },
  ];
  const unnamed = [];
  for (let i = 0; i < 40; i++) unnamed.push(...noteEvents(i * B, B - 10, 60 + (i % 13), 90, 0));

  const empty = [{ tick: 0, data: meta.trackName('Silent Track') }];

  const extremes = [{ tick: 0, data: meta.trackName('Extremes') }, { tick: 0, data: meta.program(1, 48) }];
  extremes.push(...noteEvents(0, BAR * 40, 36, 60, 1)); // one 40-bar pedal note
  for (let i = 0; i < 200; i++) extremes.push(...noteEvents(i * 30, 8, 84 + (i % 5), 100, 1)); // 8-tick stabs

  const duplicateA = [{ tick: 0, data: meta.trackName('Strings') }, { tick: 0, data: meta.program(2, 48) }];
  const duplicateB = [{ tick: 0, data: meta.trackName('Strings') }, { tick: 0, data: meta.program(3, 48) }];
  for (let i = 0; i < 30; i++) {
    duplicateA.push(...noteEvents(i * B * 2, B * 2 - 20, 55 + (i % 7), 70, 2));
    duplicateB.push(...noteEvents(i * B * 2 + B, B * 2 - 20, 62 + (i % 5), 70, 3));
  }

  writeMidi('07-edge-cases.mid', [conductor, unnamed, empty, extremes, duplicateA, duplicateB]);
}

console.log(`\nWrote fixtures to ${OUT_DIR}`);

// ---------------------------------------------------------------------------
// 8. Track-name edge cases
//
// Covers the ways a name can go missing: a chunk carrying two programs (which
// the parser splits, stranding the name on the first split), a UTF-8 name, and
// a chunk that only has an instrument name rather than a track name.
// ---------------------------------------------------------------------------
{
  const utf8 = (type, str) => {
    const bytes = [...Buffer.from(str, 'utf8')];
    return [0xff, type, ...varInt(bytes.length), ...bytes];
  };

  const conductor = [
    { tick: 0, data: meta.trackName('Conductor') },
    { tick: 0, data: meta.tempo(110) },
    { tick: 0, data: meta.timeSignature(4, 4) },
    { tick: 0, data: utf8(0x06, 'Café — Intro') },
  ];

  // One chunk, two programs: the parser splits this into two tracks and only
  // the first keeps the name unless we read it from the file ourselves.
  const shared = [
    { tick: 0, data: meta.trackName('Shared Chunk') },
    { tick: 0, data: meta.program(0, 0) },
    { tick: 0, data: meta.program(1, 48) },
  ];
  for (let i = 0; i < 24; i++) {
    shared.push(...noteEvents(i * B, B - 20, 60 + (i % 7), 90, 0));
    shared.push(...noteEvents(i * B, B - 20, 48 + (i % 5), 80, 1));
  }

  const accented = [
    { tick: 0, data: utf8(0x03, 'Flûte à bec — Solo') },
    { tick: 0, data: meta.program(2, 73) },
  ];
  for (let i = 0; i < 20; i++) accented.push(...noteEvents(i * B, B - 20, 72 + (i % 6), 85, 2));

  // Instrument name only, no track name at all.
  const instrumentOnly = [
    { tick: 0, data: utf8(0x04, 'Hammered Dulcimer') },
    { tick: 0, data: meta.program(3, 15) },
  ];
  for (let i = 0; i < 20; i++) instrumentOnly.push(...noteEvents(i * B, B - 20, 64 + (i % 9), 80, 3));

  writeMidi('08-track-names.mid', [conductor, shared, accented, instrumentOnly]);
}
