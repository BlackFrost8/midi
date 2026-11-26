import { memo, useEffect, useRef, useState } from 'react';
import type { AudioAnalysis } from '../audio/AudioAnalyzer';
import { formatSeconds } from '../utils/formatting';
import { Field, Section, Slider, Toggle } from './controls';

/** What the last auto-sync found and applied. */
export interface SyncReport {
  /** 'notes': matched across the song. 'onset': first-note fallback. */
  method: 'notes' | 'onset';
  offset: number;
  tempoScale: number;
  /** Tempo the MIDI file states, before any scaling. */
  originalBpm: number;
  checkpoints?: number;
  totalCheckpoints?: number;
  residualMs?: number;
  confidence: number;
}

export interface AudioState {
  name: string | null;
  duration: number;
  analysis: AudioAnalysis | null;
  report: SyncReport | null;
  /** Null until an analysis has run; 0-1 while one is running. */
  analyzing: number | null;
  error: string | null;
}

interface Props {
  audio: AudioState;
  enabled: boolean;
  offset: number;
  volume: number;
  /** Current playhead position, for the waveform cursor. */
  position: number;
  /** Tempo scale currently applied to the project. */
  tempoScale: number;
  onPick: () => void;
  onUnload: () => void;
  onEnabled: (enabled: boolean) => void;
  onOffset: (seconds: number) => void;
  onVolume: (value: number) => void;
  onAutoSync: () => void;
  /** The song's tracks, for attaching stems. */
  tracks: Array<{ id: string; name: string }>;
  stems: Array<{ trackId: string; name: string }>;
  onAddStem: (trackId: string, file: File) => void;
  onRemoveStem: (trackId: string) => void;
  /** Matches several files to tracks by name; resolves to the ones that matched nothing. */
  onMatchStems: (files: File[]) => Promise<string[]>;
  soloFocus: boolean;
  onSoloFocus: (on: boolean) => void;
}

export const AudioPanel = memo(function AudioPanel(props: Props) {
  const { audio, offset } = props;
  const report = audio.report;

  return (
    <div className="panel">
      <Section title="Audio track">
        {audio.name ? (
          <>
            <div className="audio-file">
              <span title={audio.name}>{audio.name}</span>
              <button className="mini-btn" title="Remove" onClick={props.onUnload}>
                ✕
              </button>
            </div>
            <Waveform
              peaks={audio.analysis?.peaks ?? null}
              duration={audio.duration}
              position={props.position + offset}
            />
            <p className="hint">{formatSeconds(audio.duration)}</p>
          </>
        ) : (
          <button className="btn primary" onClick={props.onPick}>
            Load audio
          </button>
        )}
        {audio.error && <p className="hint error-text">{audio.error}</p>}
      </Section>

      {audio.name && (
        <>
          <Section title="Playback">
            <Toggle
              label="Play the audio with the visuals"
              checked={props.enabled}
              onChange={props.onEnabled}
            />
            <Slider
              label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={props.volume}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={props.onVolume}
            />
          </Section>

          <Section title="Sync">
            <button
              className="btn primary"
              disabled={audio.analyzing !== null}
              onClick={props.onAutoSync}
            >
              {audio.analyzing !== null ? 'Analysing…' : 'Auto-sync'}
            </button>

            {audio.analyzing !== null && (
              <div className="progress-track" style={{ width: '100%', marginTop: 8 }}>
                <div className="progress-fill" style={{ width: `${Math.round(audio.analyzing * 100)}%` }} />
              </div>
            )}

            <Field label="Offset (s)">
              <div className="field-row">
                <button className="mini-btn" title="-10 ms" onClick={() => props.onOffset(offset - 0.01)}>
                  −
                </button>
                <input
                  className="number-input"
                  type="number"
                  step={0.01}
                  value={Number(offset.toFixed(3))}
                  onChange={(event) => props.onOffset(Number(event.target.value))}
                />
                <button className="mini-btn" title="+10 ms" onClick={() => props.onOffset(offset + 0.01)}>
                  +
                </button>
              </div>
            </Field>

            {report && <SyncSummary report={report} />}
          </Section>
          <StemsSection {...props} />
        </>
      )}
    </div>
  );
});

const AUDIO_ACCEPT = 'audio/*,.wav,.aif,.aiff,.mp3,.m4a,.ogg,.flac,.aac';

function pickFiles(multiple: boolean, onFiles: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = AUDIO_ACCEPT;
  input.multiple = multiple;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length) onFiles(files);
  };
  input.click();
}

/**
 * Stems: one audio file per track, exported from the DAW with the same start
 * as the mix (in Logic: File → Export → All Tracks as Audio Files). With them,
 * soloing or muting a track does the same to its sound.
 */
function StemsSection(props: Props) {
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const byTrack = new Map(props.stems.map((stem) => [stem.trackId, stem.name]));
  const all = props.tracks.length > 0 && props.tracks.every((track) => byTrack.has(track.id));

  return (
    <Section
      title="Stems"
      action={
        <button
          className="chip"
          title="Pick several stems at once; each goes to the track whose name it matches"
          onClick={() => pickFiles(true, (files) => void props.onMatchStems(files).then(setUnmatched))}
        >
          + match by name
        </button>
      }
    >
      <p className="hint">
        Give tracks their own audio (stems exported from your DAW with the same start as the mix; in Logic, File → Export
        → All Tracks as Audio Files). Soloing a track then plays just its stem.
        {all ? ' Every track has a stem, so mute works on the sound too.' : ''}
      </p>
      {unmatched.length > 0 && (
        <p className="hint">No track name matched: {unmatched.join(', ')}. Add those with the + on their track below.</p>
      )}
      <div className="stem-list">
        {props.tracks.map((track) => {
          const stem = byTrack.get(track.id);
          return (
            <div key={track.id} className="stem-row">
              <span className="stem-track" title={track.name}>
                {track.name}
              </span>
              {stem ? (
                <>
                  <span className="stem-file" title={stem}>
                    {stem}
                  </span>
                  <button className="mini-btn" title="Remove this stem" onClick={() => props.onRemoveStem(track.id)}>
                    ✕
                  </button>
                </>
              ) : (
                <button
                  className="mini-btn"
                  title={`Add a stem for ${track.name}`}
                  onClick={() => pickFiles(false, ([file]) => props.onAddStem(track.id, file))}
                >
                  +
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Toggle label="Focus the mix when soloing a track without a stem" checked={props.soloFocus} onChange={props.onSoloFocus} />
      <p className="hint">
        Approximate: a finished mix cannot be taken apart, so this filters the recording to the soloed part's range of
        notes, which brings it forward but keeps anything else playing in that range.
      </p>
    </Section>
  );
}

/** What auto-sync found, in plain terms. */
function SyncSummary({ report }: { report: SyncReport }) {
  const sameTempo = Math.abs(report.tempoScale - 1) < 1e-6;
  const bpm = report.originalBpm * report.tempoScale;
  const weak = report.method === 'onset' || report.confidence < 0.45;

  return (
    <>
      <div className="sync-report">
        <div>
          <span>Offset</span>
          <b>
            {report.offset >= 0 ? '+' : ''}
            {report.offset.toFixed(3)}s
          </b>
        </div>
        <div>
          <span>Recording tempo</span>
          <b>
            {sameTempo
              ? `${formatBpm(bpm)} BPM, as the MIDI`
              : `${formatBpm(bpm)} BPM (MIDI says ${formatBpm(report.originalBpm)})`}
          </b>
        </div>
        {report.method === 'notes' && report.totalCheckpoints !== undefined && (
          <>
            <div>
              <span>Matched</span>
              <b>
                {report.checkpoints} of {report.totalCheckpoints} sections
              </b>
            </div>
            <div>
              <span>Accuracy</span>
              <b>±{Math.max(1, Math.round(report.residualMs ?? 0))} ms</b>
            </div>
          </>
        )}
      </div>
      {weak && (
        <p className="hint">{report.method === 'onset' ? 'Only the first note matched.' : 'Partial match.'}</p>
      )}
    </>
  );
}

function formatBpm(bpm: number): string {
  return Math.abs(bpm - Math.round(bpm)) < 0.05 ? String(Math.round(bpm)) : bpm.toFixed(1);
}

/** Peak-envelope waveform with a position cursor. */
function Waveform({
  peaks,
  duration,
  position,
}: {
  peaks: Float32Array | null;
  duration: number;
  position: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const wave = styles.getPropertyValue('--ui-text-faint').trim() || '#55625f';
    const cursor = styles.getPropertyValue('--ui-accent').trim() || '#67d9d5';

    if (peaks && peaks.length) {
      ctx.fillStyle = wave;
      const mid = height / 2;
      for (let x = 0; x < width; x++) {
        const peak = peaks[Math.floor((x / width) * peaks.length)] ?? 0;
        const h = Math.max(peak * (height - 2), 1);
        ctx.fillRect(x, mid - h / 2, 1, h);
      }
    } else {
      // Analysis has not run yet, so show the strip without content.
      ctx.fillStyle = wave;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(0, height / 2 - 0.5, width, 1);
      ctx.globalAlpha = 1;
    }

    if (duration > 0) {
      const x = Math.max(0, Math.min(position / duration, 1)) * width;
      ctx.fillStyle = cursor;
      ctx.fillRect(x - 0.5, 0, 1.5, height);
    }
  }, [duration, peaks, position]);

  return <canvas className="waveform" ref={ref} />;
}
