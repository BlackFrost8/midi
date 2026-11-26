import type { BarLine, TempoEvent, TimeSignatureEvent } from '../models/MidiProject';

/**
 * Converts between the three time domains the app cares about:
 *
 *   ticks   — the MIDI file's native resolution
 *   beats   — quarter notes from song start (musical time, tempo-independent)
 *   seconds — wall-clock time, which depends on the tempo map
 *
 * Beats are the canonical horizontal axis for the "Bars" / "Beats" timeline
 * modes; seconds are used for the "Seconds" / "Timecode" modes. Keeping both
 * available means tempo changes render correctly in either.
 */
export class TimeMapper {
  readonly ppq: number;
  readonly tempos: TempoEvent[];
  readonly timeSignatures: TimeSignatureEvent[];

  constructor(ppq: number, tempos: TempoEvent[], timeSignatures: TimeSignatureEvent[]) {
    this.ppq = ppq;
    this.tempos = tempos.length ? tempos : [{ ticks: 0, beats: 0, seconds: 0, bpm: 120 }];
    this.timeSignatures = timeSignatures.length
      ? timeSignatures
      : [{ ticks: 0, beats: 0, seconds: 0, numerator: 4, denominator: 4, barStart: 1 }];
  }

  ticksToBeats(ticks: number): number {
    return ticks / this.ppq;
  }

  beatsToTicks(beats: number): number {
    return beats * this.ppq;
  }

  /**
   * Index of the last entry whose `key` is <= value. Binary search keeps grid
   * building cheap on files with large tempo maps.
   */
  private static lastIndexAtOrBefore<T>(list: T[], value: number, key: (item: T) => number): number {
    let lo = 0;
    let hi = list.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (key(list[mid]) <= value + 1e-9) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /**
   * Each TempoEvent carries the cumulative seconds at its own position, so a
   * lookup is: find the governing tempo, then advance linearly within it.
   */
  beatsToSeconds(beats: number): number {
    const t = this.tempos[TimeMapper.lastIndexAtOrBefore(this.tempos, beats, (x) => x.beats)];
    return t.seconds + ((beats - t.beats) * 60) / t.bpm;
  }

  secondsToBeats(seconds: number): number {
    const t = this.tempos[TimeMapper.lastIndexAtOrBefore(this.tempos, seconds, (x) => x.seconds)];
    return t.beats + ((seconds - t.seconds) * t.bpm) / 60;
  }

  bpmAtBeats(beats: number): number {
    return this.tempos[TimeMapper.lastIndexAtOrBefore(this.tempos, beats, (x) => x.beats)].bpm;
  }

  timeSignatureAtBeats(beats: number): TimeSignatureEvent {
    return this.timeSignatures[
      TimeMapper.lastIndexAtOrBefore(this.timeSignatures, beats, (x) => x.beats)
    ];
  }

  /** Quarter notes per bar for a given time signature. 6/8 => 3 quarter notes. */
  static beatsPerBar(sig: { numerator: number; denominator: number }): number {
    return (sig.numerator * 4) / sig.denominator;
  }

  /** Quarter notes per notated beat. In 6/8 an eighth note is one beat => 0.5. */
  static beatsPerPulse(sig: { numerator: number; denominator: number }): number {
    return 4 / sig.denominator;
  }

  /**
   * Generates every bar and beat line from 0 to durationBeats, honouring time
   * signature changes. The result is sorted and used both for the grid and for
   * bar-number labels in the ruler.
   */
  buildBarGrid(durationBeats: number): BarLine[] {
    const lines: BarLine[] = [];
    const sigs = this.timeSignatures;
    const end = durationBeats + 1e-6;
    let bar = 1;

    for (let i = 0; i < sigs.length; i++) {
      const sig = sigs[i];
      const next = sigs[i + 1];
      const segStart = sig.beats;
      const segEnd = next ? Math.min(next.beats, end) : end;
      const barBeats = TimeMapper.beatsPerBar(sig);
      const pulseBeats = TimeMapper.beatsPerPulse(sig);
      if (barBeats <= 0 || pulseBeats <= 0) continue;

      // Guard against pathological files claiming millions of bars.
      const maxBarsInSegment = Math.ceil((segEnd - segStart) / barBeats) + 1;
      if (maxBarsInSegment > 200000) continue;

      for (let b = segStart; b < segEnd - 1e-9; b += barBeats) {
        const pulses = Math.round(barBeats / pulseBeats);
        for (let p = 0; p < pulses; p++) {
          const beats = b + p * pulseBeats;
          if (beats > segEnd + 1e-9) break;
          lines.push({
            bar,
            beats,
            seconds: this.beatsToSeconds(beats),
            isDownbeat: p === 0,
            beatInBar: p,
          });
        }
        bar++;
      }
      if (next) bar = next.barStart;
    }

    lines.sort((a, b) => a.beats - b.beats);
    return lines;
  }
}
