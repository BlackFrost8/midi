import { useState } from 'react';
import type { CameraKey } from '../layout/DynamicCamera';
import { formatSeconds } from '../utils/formatting';

interface Props {
  keys: CameraKey[];
  onKeys: (keys: CameraKey[]) => void;
  tracks: Array<{ id: string; name: string }>;
  /** The playhead, read when a button is pressed (not on every frame). */
  getPosition: () => number;
  onSeek: (seconds: number) => void;
  duration: number;
}

const MODES: Array<{ value: CameraKey['mode']; label: string; hint: string }> = [
  { value: 'focus', label: 'Focus', hint: 'Only these tracks are in view' },
  { value: 'include', label: 'Include', hint: 'These tracks stay in view as well as whatever is playing' },
  { value: 'hide', label: 'Hide', hint: 'These tracks stay out of view' },
];

/** Parses "1:23.5", "83.5" or "83" into seconds. */
function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 2 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  return parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
}

function TimeInput({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="camera-key-time"
      value={draft ?? formatSeconds(value)}
      onFocus={() => setDraft(formatSeconds(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const seconds = draft === null ? null : parseTime(draft);
        if (seconds !== null) onChange(Math.max(0, seconds));
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * Camera keyframes for the dynamic camera: stretches of the song where you
 * choose what is in view instead of leaving it to what is playing.
 */
export function CameraKeys({ keys, onKeys, tracks, getPosition, onSeek, duration }: Props) {
  const patch = (id: string, change: Partial<CameraKey>) =>
    onKeys(
      keys
        .map((key) => {
          if (key.id !== id) return key;
          const next = { ...key, ...change };
          // Keep the range the right way round and at least a second long.
          if (next.end < next.start + 1) {
            if ('start' in change) next.end = next.start + 1;
            else next.start = Math.max(0, next.end - 1);
          }
          return next;
        })
        .sort((a, b) => a.start - b.start),
    );

  const add = () => {
    const start = Math.max(0, getPosition());
    const key: CameraKey = {
      id: `key-${Date.now().toString(36)}`,
      start,
      end: Math.min(Math.max(duration, start + 1), start + 8),
      trackIds: tracks.slice(0, 1).map((track) => track.id),
      mode: 'focus',
    };
    onKeys([...keys, key].sort((a, b) => a.start - b.start));
  };

  return (
    <div className="camera-keys">
      <div className="camera-keys-head">
        <span>Camera keyframes</span>
        <button className="chip" onClick={add} title="Add a keyframe starting at the playhead">
          + at playhead
        </button>
      </div>
      {keys.length === 0 && (
        <p className="hint">Choose what the camera shows over a stretch of the song: focus on a solo, keep a track in view, or hide one.</p>
      )}
      {keys.map((key) => (
        <div key={key.id} className="camera-key">
          <div className="camera-key-row">
            <div className="segmented">
              {MODES.map((mode) => (
                <button
                  key={mode.value}
                  className={key.mode === mode.value ? 'on' : ''}
                  title={mode.hint}
                  onClick={() => patch(key.id, { mode: mode.value })}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <button className="mini-btn" title="Jump to this keyframe" onClick={() => onSeek(Math.max(0, key.start - 1))}>
              ▶
            </button>
            <button className="mini-btn" title="Remove this keyframe" onClick={() => onKeys(keys.filter((k) => k.id !== key.id))}>
              ✕
            </button>
          </div>
          <div className="camera-key-row">
            <TimeInput value={key.start} onChange={(start) => patch(key.id, { start })} />
            <button className="mini-btn" title="Start at the playhead" onClick={() => patch(key.id, { start: getPosition() })}>
              ⇤
            </button>
            <span className="camera-key-dash">to</span>
            <TimeInput value={key.end} onChange={(end) => patch(key.id, { end })} />
            <button className="mini-btn" title="End at the playhead" onClick={() => patch(key.id, { end: getPosition() })}>
              ⇥
            </button>
          </div>
          <div className="thumb-chips">
            {tracks.map((track) => {
              const on = key.trackIds.includes(track.id);
              return (
                <button
                  key={track.id}
                  className={`chip${on ? ' on' : ''}`}
                  onClick={() =>
                    patch(key.id, { trackIds: on ? key.trackIds.filter((id) => id !== track.id) : [...key.trackIds, track.id] })
                  }
                >
                  {track.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
