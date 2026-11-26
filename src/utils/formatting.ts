const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI 60 → "C4" (scientific pitch notation, middle C = C4). */
export function pitchToName(pitch: number): string {
  const p = Math.round(pitch);
  const octave = Math.floor(p / 12) - 1;
  return `${NOTE_NAMES[((p % 12) + 12) % 12]}${octave}`;
}

const ROMAN: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRoman(n: number): string {
  if (n <= 0) return String(n);
  let value = Math.floor(n);
  let out = '';
  for (const [amount, numeral] of ROMAN) {
    while (value >= amount) {
      out += numeral;
      value -= amount;
    }
  }
  return out;
}

/** 154.2 → "2:34". Used for durations and the seconds timeline. */
export function formatSeconds(seconds: number): string {
  // Times before zero occur in a recording's intro; show them as a countdown.
  const sign = seconds <= -1 ? '-' : '';
  const s = Math.abs(seconds) < 1 && seconds < 0 ? 0 : Math.abs(seconds);
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${sign}${m}:${String(rem).padStart(2, '0')}`;
}

/** 154.24 → "00:02:34:07" at the given frame rate. */
export function formatTimecode(seconds: number, fps = 30): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const frames = Math.floor((s % 1) * fps);
  return [h, m, sec, frames].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Bar 5, beat 3 → "5.3" (1-based, as musicians count). */
export function formatBarBeat(bar: number, beatInBar: number): string {
  return `${bar}.${beatInBar + 1}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
