import type { MidiProject } from '../models/MidiProject';
import type { NoteRect } from '../renderer/NoteRenderer';
import { beatsToBarBeat } from '../midi/MidiAnalyzer';
import { formatSeconds, pitchToName } from '../utils/formatting';

interface Props {
  project: MidiProject;
  selection: NoteRect | null;
  onClose: () => void;
}

export function NoteInspector({ project, selection, onClose }: Props) {
  if (!selection) return null;
  const { note } = selection;
  const position = beatsToBarBeat(project, note.startBeats);

  return (
    <div className="overlay-card inspector">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span className="tooltip-title">{pitchToName(note.pitch)}</span>
        <span style={{ flex: 1 }} />
        <button className="mini-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <dl>
        <dt>MIDI</dt>
        <dd>{note.pitch}</dd>
        <dt>Velocity</dt>
        <dd>{Math.round(note.velocity * 127)}</dd>
        <dt>Start</dt>
        <dd>
          {position.bar}.{position.beat}
        </dd>
        <dt>Time</dt>
        <dd>{formatSeconds(note.startSeconds)}</dd>
        <dt>Duration</dt>
        <dd>{note.durationBeats.toFixed(2)} beats</dd>
        <dt>Channel</dt>
        <dd>{note.channel + 1}</dd>
        <dt>Track</dt>
        <dd style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selection.trackName || '—'}
        </dd>
      </dl>
    </div>
  );
}
