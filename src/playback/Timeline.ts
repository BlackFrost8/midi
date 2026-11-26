/**
 * The span a session plays and exports.
 *
 * Without a recording that is simply the MIDI: from zero to the end of the
 * last note. With one it has to cover the recording too, because the music
 * does not stop when the MIDI does — a reverb or delay tail rings on after
 * the last note-off, and a riser, a vocal or a sample can come in before the
 * first note. Cutting at the MIDI's ends silences both, in the preview and
 * in the exported video.
 *
 * All times here are on the visual (MIDI) clock; a recording's own time maps
 * onto it as `visual = audio − offset`.
 */

/** Where sound actually is in a recording, in the recording's own seconds. */
export interface AudibleExtent {
  /** First moment with real content: an intro, not a pre-roll click or hiss. */
  firstSound: number;
  /** Last moment still audible, including the very end of a decaying tail. */
  lastSound: number;
  duration: number;
}

export interface Timeline {
  start: number;
  end: number;
}

/**
 * A fading tail is meant to be heard all the way to silence, so the end is
 * found with a sensitive threshold. The start uses a firmer one: low-level
 * noise or a stray click ahead of the downbeat is not an intro, and should
 * not put dead air at the front of a video.
 */
const TAIL_THRESHOLD_DB = -60;
const INTRO_THRESHOLD_DB = -40;
/** Level is measured in blocks this long. */
const BLOCK_SECONDS = 0.01;
/** Breathing room kept beyond the first and last sound. */
const EDGE = 0.1;
/** Sound this little ahead of the first note is the note itself, not an intro. */
const MIN_INTRO = 0.25;

export function audibleExtent(buffer: AudioBuffer): AudibleExtent {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const block = Math.max(Math.round(buffer.sampleRate * BLOCK_SECONDS), 1);
  const blocks = Math.ceil(buffer.length / block);
  const peaks = new Float32Array(blocks);
  let peak = 0;

  for (let b = 0; b < blocks; b++) {
    const from = b * block;
    const to = Math.min(from + block, buffer.length);
    let level = 0;
    for (const data of channels) {
      for (let i = from; i < to; i++) {
        const value = Math.abs(data[i]);
        if (value > level) level = value;
      }
    }
    peaks[b] = level;
    if (level > peak) peak = level;
  }

  if (peak <= 0) return { firstSound: 0, lastSound: 0, duration: buffer.duration };

  // Relative to the file's own peak, so a quiet master and a loud one are
  // judged the same way.
  const introLevel = peak * 10 ** (INTRO_THRESHOLD_DB / 20);
  const tailLevel = peak * 10 ** (TAIL_THRESHOLD_DB / 20);

  let first = 0;
  while (first < blocks && peaks[first] < introLevel) first++;
  let last = blocks - 1;
  while (last > 0 && peaks[last] < tailLevel) last--;

  return {
    firstSound: Math.min(first * BLOCK_SECONDS, buffer.duration),
    lastSound: Math.min((last + 1) * BLOCK_SECONDS, buffer.duration),
    duration: buffer.duration,
  };
}

/**
 * The session's span: the MIDI, widened to take in any sound the recording
 * has before the first note or after the last.
 */
export function sessionTimeline(
  midiDuration: number,
  audio: (AudibleExtent & { offset: number }) | null,
): Timeline {
  const end = Math.max(midiDuration, 0);
  if (!audio) return { start: 0, end };

  const fileStart = -audio.offset;
  const fileEnd = audio.duration - audio.offset;
  const soundStart = audio.firstSound - audio.offset;
  const soundEnd = audio.lastSound - audio.offset;

  return {
    start: soundStart < -MIN_INTRO ? Math.max(soundStart - EDGE, fileStart) : 0,
    end: Math.max(end, Math.min(soundEnd + EDGE, fileEnd)),
  };
}
