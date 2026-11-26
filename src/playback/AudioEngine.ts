/**
 * Plays a loaded audio file and exposes its clock.
 *
 * When a track is loaded and enabled, this becomes the timebase for the whole
 * app: the playhead reads the audio clock every frame rather than integrating
 * its own, so the picture cannot drift away from the music no matter how long
 * it runs or how many frames are dropped.
 */

export interface LoadedAudio {
  name: string;
  buffer: AudioBuffer;
}

/** One track's own audio (a stem), played in step with the recording. */
interface Stem {
  name: string;
  buffer: AudioBuffer;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

/**
 * How loud the full recording and each stem should be. `focus` narrows the
 * recording to a frequency band, an approximate way of bringing forward a
 * soloed part that has no stem of its own.
 */
export interface AudioMix {
  mix: number;
  stems: Map<string, number>;
  focus: { low: number; high: number } | null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  /** The recording's own level and its focus filters, ahead of the master gain. */
  private mixGain: GainNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private stems = new Map<string, Stem>();
  private mix: AudioMix = { mix: 1, stems: new Map(), focus: null };

  /** Audio-clock time at which the current playback started. */
  private startedAt = 0;
  /** Last audio-clock reading, and when (wall clock) it last moved. */
  private lastClock = -1;
  private lastClockMoved = 0;
  /** Position within the audio buffer that playback started from. */
  private startedFrom = 0;
  private playing = false;

  audio: LoadedAudio | null = null;
  volume = 0.9;

  /**
   * Seconds to add to a visual position to reach the matching audio position.
   * Positive means the recording has a lead-in before the first MIDI note.
   */
  offset = 0;

  get available(): boolean {
    return typeof window !== 'undefined' && 'AudioContext' in window;
  }

  get loaded(): boolean {
    return this.audio !== null;
  }

  get duration(): number {
    return this.audio?.buffer.duration ?? 0;
  }

  private ensureContext(): AudioContext | null {
    if (!this.available) return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      // recording → its gain → high-pass → low-pass → master. The filters sit
      // wide open unless a soloed part is being brought forward.
      this.mixGain = this.ctx.createGain();
      this.highpass = this.ctx.createBiquadFilter();
      this.highpass.type = 'highpass';
      this.highpass.frequency.value = 10;
      this.lowpass = this.ctx.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      this.lowpass.frequency.value = 22000;
      this.mixGain.connect(this.highpass);
      this.highpass.connect(this.lowpass);
      this.lowpass.connect(this.gain);
    }
    return this.ctx;
  }

  /** Decodes a file. Rejects with a readable message on an unsupported format. */
  async load(file: File): Promise<LoadedAudio> {
    const ctx = this.ensureContext();
    if (!ctx) throw new Error('This browser has no Web Audio support.');

    const bytes = await file.arrayBuffer();
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(bytes);
    } catch {
      throw new Error(
        `Could not decode "${file.name}". Try a WAV, MP3, M4A, OGG or FLAC file.`,
      );
    }

    this.stop();
    this.audio = { name: file.name, buffer };
    return this.audio;
  }

  unload(): void {
    this.stop();
    this.audio = null;
    for (const id of [...this.stems.keys()]) this.removeStem(id);
  }

  /** Decodes a track's stem. It plays from the same start as the recording. */
  async loadStem(trackId: string, file: File): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx || !this.gain) throw new Error('This browser has no Web Audio support.');
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error(`Could not decode "${file.name}".`);
    }
    this.removeStem(trackId);
    const gain = ctx.createGain();
    gain.gain.value = this.mix.stems.get(trackId) ?? 0;
    gain.connect(this.gain);
    const stem: Stem = { name: file.name, buffer, gain, source: null };
    this.stems.set(trackId, stem);
    // Joining mid-playback: start it in step with the recording.
    if (this.playing && this.source) this.startStem(stem, this.currentAudioPosition());
  }

  removeStem(trackId: string): void {
    const stem = this.stems.get(trackId);
    if (!stem) return;
    this.stopStem(stem);
    stem.gain.disconnect();
    this.stems.delete(trackId);
  }

  hasStem(trackId: string): boolean {
    return this.stems.has(trackId);
  }

  /** Sets the levels of the recording and the stems, with a short glide so nothing clicks. */
  setMix(mix: AudioMix): void {
    this.mix = mix;
    const ctx = this.ctx;
    if (!ctx) return;
    const at = ctx.currentTime;
    this.mixGain?.gain.setTargetAtTime(mix.mix, at, 0.02);
    for (const [id, stem] of this.stems) stem.gain.gain.setTargetAtTime(mix.stems.get(id) ?? 0, at, 0.02);
    this.highpass?.frequency.setTargetAtTime(mix.focus ? mix.focus.low : 10, at, 0.05);
    this.lowpass?.frequency.setTargetAtTime(mix.focus ? mix.focus.high : 22000, at, 0.05);
  }

  /** Where in the files playback is now (ignoring output latency). */
  private currentAudioPosition(): number {
    if (!this.ctx) return 0;
    return this.startedFrom + Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  private startStem(stem: Stem, from: number, when = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopStem(stem);
    if (from >= stem.buffer.duration) return;
    const source = ctx.createBufferSource();
    source.buffer = stem.buffer;
    source.connect(stem.gain);
    source.start(when, Math.max(0, from));
    stem.source = source;
  }

  private stopStem(stem: Stem): void {
    if (!stem.source) return;
    try {
      stem.source.stop();
    } catch {
      // Already stopped.
    }
    stem.source.disconnect();
    stem.source = null;
  }

  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') await ctx.resume();
  }

  setVolume(value: number): void {
    this.volume = value;
    if (this.gain) this.gain.gain.value = value;
  }

  /**
   * Starts (or restarts) playback so that the given visual position is heard.
   * A visual position before the audible region simply waits in silence.
   */
  play(visualSeconds: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.audio) return;

    // Browsers keep audio suspended until a real click, and can suspend it
    // again later (idle, a headphone reconnect). This runs inside the click
    // that pressed Play, which is the moment a resume is allowed.
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    this.lastClock = -1;

    this.stopSource();

    const target = visualSeconds + this.offset;
    const source = ctx.createBufferSource();
    source.buffer = this.audio.buffer;
    source.connect(this.mixGain ?? this.gain!);

    if (target >= 0) {
      // Already inside the file: start part-way through.
      const from = Math.min(target, this.audio.buffer.duration);
      // Everything starts on the same clock tick, so stems stay locked to the recording.
      const when = ctx.currentTime + 0.01;
      source.start(when, from);
      for (const stem of this.stems.values()) this.startStem(stem, from, when);
      this.startedFrom = from;
      this.startedAt = when;
    } else {
      // The visuals lead the audio, so schedule the file to begin later.
      const delay = -target;
      source.start(ctx.currentTime + delay, 0);
      for (const stem of this.stems.values()) this.startStem(stem, 0, ctx.currentTime + delay);
      this.startedFrom = 0;
      this.startedAt = ctx.currentTime + delay;
    }

    this.source = source;
    this.playing = true;
  }

  pause(): void {
    this.stopSource();
    this.playing = false;
  }

  stop(): void {
    this.stopSource();
    this.playing = false;
    this.startedFrom = 0;
    this.startedAt = 0;
  }

  private stopSource(): void {
    for (const stem of this.stems.values()) this.stopStem(stem);
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    this.source.disconnect();
    this.source = null;
  }

  /**
   * Current visual position implied by the audio clock, or null when nothing
   * is playing. The caller uses null to mean "fall back to the internal clock".
   */
  visualPosition(): number | null {
    if (!this.playing || !this.ctx || !this.audio) return null;
    // A suspended or stalled clock must never hold the picture still. Returning
    // null hands timing back to the wall clock until the audio is moving again.
    if (this.ctx.state !== 'running' || this.clockStalled()) return null;
    const audioPosition = this.startedFrom + (this.ctx.currentTime - this.startedAt) - this.outputLatency();
    return audioPosition - this.offset;
  }

  /**
   * True when the audio clock has not advanced for a while even though the
   * context says it is running — an output device that went away, or a
   * system audio hiccup. It normally ticks every few milliseconds.
   */
  private clockStalled(): boolean {
    const now = performance.now();
    const time = this.ctx?.currentTime ?? 0;
    if (time !== this.lastClock) {
      this.lastClock = time;
      this.lastClockMoved = now;
      return false;
    }
    return now - this.lastClockMoved > 300;
  }

  /**
   * Seconds between the audio clock and the sound reaching the listener. The
   * clock reports what is being rendered now, which is heard this much later —
   * a few milliseconds on wired output, a quarter of a second on Bluetooth.
   * Without allowing for it the picture runs visibly ahead of the music.
   */
  private outputLatency(): number {
    const ctx = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (!ctx) return 0;
    const latency = Number.isFinite(ctx.outputLatency) && ctx.outputLatency! > 0 ? ctx.outputLatency! : ctx.baseLatency;
    return Number.isFinite(latency) ? Math.min(Math.max(latency, 0), 0.5) : 0;
  }

  dispose(): void {
    this.stop();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.gain = null;
    this.mixGain = null;
    this.highpass = null;
    this.lowpass = null;
    this.stems.clear();
  }
}
