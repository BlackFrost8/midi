import type { MidiProject, TrackState, VisualTrack } from '../models/MidiProject';
import { lowerBound } from '../utils/math';

/**
 * A deliberately simple Web Audio preview so you can check that the visuals line
 * up with the music. It is not a sampler and does not try to sound like the
 * instruments — the real audio for a video comes from your DAW.
 *
 * Notes are scheduled ahead of the audio clock in short windows rather than all
 * at once; a 100k-note file would otherwise create 100k oscillator nodes.
 */

const LOOKAHEAD_SECONDS = 0.35;
const MAX_VOICES = 48;

interface TrackCursor {
  track: VisualTrack;
  index: number;
}

export class PreviewSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cursors: TrackCursor[] = [];
  private project: MidiProject | null = null;
  /** Audio-clock time corresponding to song position 0. */
  private originTime = 0;
  private voices = 0;
  private noiseBuffer: AudioBuffer | null = null;

  volume = 0.35;

  get available(): boolean {
    return typeof window !== 'undefined' && 'AudioContext' in window;
  }

  load(project: MidiProject): void {
    this.project = project;
    this.cursors = project.tracks.map((track) => ({ track, index: 0 }));
  }

  /** Must be called from a user gesture — browsers block autoplay otherwise. */
  async resume(): Promise<void> {
    if (!this.available) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setVolume(value: number): void {
    this.volume = value;
    if (this.master) this.master.gain.value = value;
  }

  /** Re-anchors the audio clock after a seek or a play/pause transition. */
  sync(positionSeconds: number): void {
    if (!this.ctx) return;
    this.originTime = this.ctx.currentTime - positionSeconds;
    for (const cursor of this.cursors) {
      cursor.index = lowerBound(cursor.track.notes, positionSeconds, (note) => note.startSeconds);
    }
  }

  stop(): void {
    this.voices = 0;
    if (!this.ctx || !this.master) return;
    // Cut the tail without tearing down the graph, so playback can resume fast.
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(0, this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + 0.08);
  }

  /**
   * Schedules everything starting in the next lookahead window. Call once per
   * animation frame while playing.
   */
  update(positionSeconds: number, trackStates: Map<string, TrackState>): void {
    if (!this.ctx || !this.master || !this.project) return;

    const horizon = positionSeconds + LOOKAHEAD_SECONDS;
    const anySolo = [...trackStates.values()].some((state) => state.solo);

    for (const cursor of this.cursors) {
      const state = trackStates.get(cursor.track.id);
      const audible = state ? !state.muted && (!anySolo || state.solo) : true;
      const notes = cursor.track.notes;

      while (cursor.index < notes.length && notes[cursor.index].startSeconds < horizon) {
        const note = notes[cursor.index];
        cursor.index++;
        if (!audible) continue;
        if (note.startSeconds < positionSeconds - 0.05) continue;
        if (this.voices >= MAX_VOICES) continue;
        this.scheduleNote(
          this.originTime + note.startSeconds,
          Math.min(note.durationSeconds, 4),
          note.pitch,
          note.velocity,
          cursor.track.isPercussion,
        );
      }
    }
  }

  private scheduleNote(
    when: number,
    duration: number,
    pitch: number,
    velocity: number,
    percussive: boolean,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const start = Math.max(when, ctx.currentTime + 0.005);
    const gain = ctx.createGain();
    const peak = Math.max(velocity, 0.05) * (percussive ? 0.5 : 0.32);

    let source: AudioScheduledSourceNode;
    if (percussive && this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = pitch < 45 ? 'lowpass' : 'highpass';
      filter.frequency.value = pitch < 45 ? 220 : 2400;
      noise.connect(filter);
      filter.connect(gain);
      source = noise;
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
      osc.connect(gain);
      source = osc;
    }

    // Short attack, exponential-ish decay: enough shape to hear articulation.
    const release = percussive ? 0.12 : Math.min(0.35, duration * 0.6);
    const hold = percussive ? Math.min(duration, 0.1) : duration;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.006);
    gain.gain.setTargetAtTime(peak * 0.7, start + 0.02, 0.12);
    gain.gain.setTargetAtTime(0.0001, start + hold, release / 3);

    gain.connect(master);
    source.start(start);
    source.stop(start + hold + release + 0.05);

    this.voices++;
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      gain.disconnect();
    };
  }

  dispose(): void {
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // Decaying white noise reads as a drum hit without any sample data.
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  return buffer;
}
