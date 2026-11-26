/**
 * A musical clock decoupled from React state.
 *
 * The render loop advances and reads this every frame; React only subscribes at
 * a low rate for the on-screen readout. Driving position through component
 * state instead would re-render the whole tree 60 times a second.
 */
export class PlaybackController {
  /** Current position in seconds. */
  position = 0;
  playing = false;
  /**
   * Where the session begins. Zero unless a recording has an intro before the
   * first MIDI note, in which case it is negative so the intro is not skipped.
   */
  start = 0;
  /** Where the session ends: the last note, or the end of a recording's tail. */
  duration = 0;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  rate = 1;

  private lastTimestamp = 0;
  private listeners = new Set<(position: number, playing: boolean) => void>();

  /**
   * Optional authoritative timebase. When a loaded audio track is driving
   * playback this returns its position, and the controller follows it instead
   * of integrating frame deltas — so the picture cannot drift from the music.
   * Returning null hands control back to the internal clock.
   */
  clock: (() => number | null) | null = null;

  subscribe(listener: (position: number, playing: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.position, this.playing);
  }

  play(): void {
    if (this.playing) return;
    if (this.position >= this.duration - 1e-4) this.position = this.loop ? this.loopStart : this.start;
    this.playing = true;
    this.lastTimestamp = 0;
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  stop(): void {
    this.playing = false;
    this.position = this.loop ? this.loopStart : this.start;
    this.emit();
  }

  seek(seconds: number): void {
    this.position = Math.max(this.start, Math.min(seconds, this.duration));
    this.emit();
  }

  /**
   * Advances by real elapsed time. Returns true when the position moved, so the
   * caller knows whether a redraw is needed.
   */
  tick(timestamp: number): boolean {
    if (!this.playing) {
      this.lastTimestamp = timestamp;
      return false;
    }
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
      return false;
    }

    // Real elapsed time, so the music keeps its speed even when frames arrive
    // slowly. Only a gap long enough to mean the tab was in the background is
    // capped, so returning to it does not leap the playhead forward.
    const delta = Math.min((timestamp - this.lastTimestamp) / 1000, 1) * this.rate;
    this.lastTimestamp = timestamp;

    const external = this.clock?.() ?? null;
    if (external !== null) {
      // Follow the audio. It is the reference, so nothing is accumulated here.
      this.position = Math.max(this.start, external);
    } else {
      this.position += delta;
    }

    if (this.loop && this.loopEnd > this.loopStart && this.position >= this.loopEnd) {
      this.position = this.loopStart;
    } else if (this.position >= this.duration) {
      this.position = this.duration;
      this.playing = false;
      this.emit();
    }
    return true;
  }
}
