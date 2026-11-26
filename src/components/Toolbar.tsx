import type { MidiProject } from '../models/MidiProject';
import { formatSeconds } from '../utils/formatting';

interface Props {
  project: MidiProject | null;
  playing: boolean;
  position: number;
  /** End of the session: the last note, or a recording's tail. */
  duration: number;
  zoomPercent: number;
  sidebarOpen: boolean;
  audioEnabled: boolean;
  audioAvailable: boolean;
  volume: number;
  onOpen: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onReturnToStart: () => void;
  onZoom: (factor: number) => void;
  onZoomFit: () => void;
  onToggleSidebar: () => void;
  infoOpen: boolean;
  onToggleInfo: () => void;
  onToggleAudio: () => void;
  onVolume: (value: number) => void;
}

export function Toolbar(props: Props) {
  const disabled = !props.project;

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="brand-mark">Arrangement</span>
        <span className="brand-title">{props.project?.title ?? 'No file loaded'}</span>
      </div>

      <div className="toolbar-group">
        <button className="btn primary" onClick={props.onOpen}>
          Open MIDI
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className="btn icon"
          disabled={disabled}
          onClick={props.onReturnToStart}
          title="Back to start (Enter or Shift+B)"
        >
          |◀
        </button>
        <button className="btn icon" disabled={disabled} onClick={props.onPlayPause} title="Play / pause (Space)">
          {props.playing ? '❚❚' : '▶'}
        </button>
        <button className="btn icon" disabled={disabled} onClick={props.onStop} title="Stop">
          ■
        </button>
        <span className="readout">
          {formatSeconds(props.position)} / {formatSeconds(props.project ? props.duration : 0)}
        </span>
      </div>

      <div className="toolbar-group">
        <button className="btn icon" disabled={disabled} onClick={() => props.onZoom(1 / 1.3)} title="Zoom out">
          −
        </button>
        <span className="readout">{Math.round(props.zoomPercent)}%</span>
        <button className="btn icon" disabled={disabled} onClick={() => props.onZoom(1.3)} title="Zoom in">
          +
        </button>
        <button className="btn" disabled={disabled} onClick={props.onZoomFit} title="Fit whole song (F)">
          Fit
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className={`btn${props.audioEnabled ? ' active' : ''}`}
          disabled={disabled || !props.audioAvailable}
          onClick={props.onToggleAudio}
          title={
            props.audioAvailable
              ? 'Simple synth preview so you can check sync'
              : 'Bypassed while your loaded audio track is playing'
          }
        >
          {props.audioEnabled ? '🔊 Preview' : '🔈 Preview'}
        </button>
        {props.audioEnabled && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={props.volume}
            style={{ width: 70 }}
            onChange={(event) => props.onVolume(Number(event.target.value))}
            title="Preview volume"
          />
        )}
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <button className={`btn${props.infoOpen ? ' active' : ''}`} onClick={props.onToggleInfo} title="How it works and shortcuts (?)">
          Info
        </button>
        <button className={`btn${props.sidebarOpen ? ' active' : ''}`} onClick={props.onToggleSidebar}>
          {props.sidebarOpen ? 'Hide panel' : 'Show panel'}
        </button>
      </div>
    </div>
  );
}
