import { memo, useMemo, useState } from 'react';
import type { MidiProject, TrackState, VisualTrack } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import { familyLabel } from '../midi/InstrumentClassifier';
import { resolveTrackColor } from '../layout/ColorResolver';
import { formatCount } from '../utils/formatting';
import { ICON_GROUPS, resolveIcon, type IconName } from '../renderer/iconLibrary';
import { iconGradientColors } from '../renderer/IconPaint';
import { IconGlyph } from './IconGlyph';
import { TrackNameInput } from './TrackNameInput';
import { Section } from './controls';
import { hasDistinctFileNames, type TrackNaming } from '../midi/TrackNaming';

interface Props {
  project: MidiProject;
  settings: RenderSettings;
  trackStates: Map<string, TrackState>;
  onTrackState: (trackId: string, patch: Partial<TrackState>) => void;
  onAllVisible: (visible: boolean) => void;
  onClearSolo: () => void;
  naming: TrackNaming;
  onNaming: (naming: TrackNaming) => void;
}

/**
 * Memoised: during playback the view scrolls every frame, and without this the
 * whole track list would re-render 60 times a second for no visible change.
 */
export const TrackPanel = memo(function TrackPanel(props: Props) {
  const { project, settings, trackStates } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState(true);
  /** Track id whose icon picker is open, or null. */
  const [iconPicker, setIconPicker] = useState<string | null>(null);
  // The rows show icons in the same gradient as the arrangement.
  const gradientColors = settings.iconGradient ? iconGradientColors(settings).join(',') : '';
  const gradient = useMemo(
    () => (gradientColors ? { colors: gradientColors.split(','), style: settings.iconGradientStyle } : null),
    [gradientColors, settings.iconGradientStyle],
  );

  const groups = useMemo(() => {
    if (!grouped) {
      return [{ id: 'all', name: 'All tracks', tracks: project.tracks }];
    }
    return project.groups.map((group) => ({
      id: group.id,
      name: group.name,
      tracks: group.trackIds
        .map((id) => project.tracks.find((track) => track.id === id))
        .filter((track): track is VisualTrack => Boolean(track)),
    }));
  }, [grouped, project]);

  const toggleGroup = (id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroupVisible = (tracks: VisualTrack[], visible: boolean) => {
    for (const track of tracks) props.onTrackState(track.id, { visible });
  };

  return (
    <div className="panel">
      <Section title={`Tracks — ${project.tracks.length}`}>
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => props.onAllVisible(true)}>
            Show all
          </button>
          <button className="btn" onClick={() => props.onAllVisible(false)}>
            Hide all
          </button>
          <button className="btn" onClick={props.onClearSolo}>
            Clear solo
          </button>
          <button className={`btn${grouped ? ' active' : ''}`} onClick={() => setGrouped((v) => !v)}>
            Group
          </button>
        </div>
        {hasDistinctFileNames(project) && (
          <div className="field-row naming-row">
            <span className="hint">Names</span>
            <div className="segmented">
              <button
                className={props.naming === 'instrument' ? 'on' : ''}
                onClick={() => props.onNaming('instrument')}
              >
                Instrument
              </button>
              <button
                className={props.naming === 'file' ? 'on' : ''}
                onClick={() => props.onNaming('file')}
              >
                Track name
              </button>
            </div>
          </div>
        )}
      </Section>

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        const visibleCount = group.tracks.filter((track) => trackStates.get(track.id)?.visible).length;
        return (
          <div key={group.id}>
            {grouped && (
              <div className="group-header" onClick={() => toggleGroup(group.id)}>
                <span>{isCollapsed ? '▸' : '▾'}</span>
                <span>{group.name}</span>
                <span style={{ opacity: 0.6 }}>
                  {visibleCount}/{group.tracks.length}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  className="mini-btn"
                  title="Toggle whole group"
                  onClick={(event) => {
                    event.stopPropagation();
                    setGroupVisible(group.tracks, visibleCount < group.tracks.length);
                  }}
                >
                  ◐
                </button>
              </div>
            )}
            {!isCollapsed &&
              group.tracks.map((track) => {
                const state = trackStates.get(track.id);
                if (!state) return null;
                const color = resolveTrackColor(track, state, settings);
                return (
                  <div
                    key={track.id}
                    className={`track-row${state.visible ? '' : ' hidden-track'}`}
                  >
                    <span className="track-swatch" style={{ background: color }} title="Track colour">
                      <input
                        type="color"
                        value={toPickerHex(color)}
                        onChange={(event) => props.onTrackState(track.id, { color: event.target.value })}
                      />
                    </span>

                    <button
                      className={`track-icon-btn${iconPicker === track.id ? ' open' : ''}${state.icon ? ' custom' : ''}`}
                      title="Icon"
                      onClick={() => setIconPicker((current) => (current === track.id ? null : track.id))}
                    >
                      <IconGlyph
                        name={resolveIcon(track, state.icon as IconName | null, settings.iconSetId)}
                        size={15}
                        gradient={gradient}
                      />
                    </button>

                    <div className="track-name">
                      <TrackNameInput
                        key={track.id}
                        fileName={track.name}
                        label={state.label}
                        onChange={(label) => props.onTrackState(track.id, { label })}
                      />
                      <div className="track-name-sub">
                        {familyLabel(track.family)} · {formatCount(track.noteCount)} notes
                        {track.channel != null ? ` · ch ${track.channel + 1}` : ''}
                      </div>
                    </div>

                    <div className="track-actions">
                      {(state.color || state.label || state.icon) && (
                        <button
                          className="mini-btn"
                          title="Reset"
                          onClick={() =>
                            props.onTrackState(track.id, { color: null, label: null, icon: null })
                          }
                        >
                          ↺
                        </button>
                      )}
                      {settings.iconGradient && (
                        <button
                          className={`mini-btn pulse-btn${state.pulse ? ' on' : ''}`}
                          title="Glow sync: the icon glows with this track's notes"
                          onClick={() => props.onTrackState(track.id, { pulse: !state.pulse })}
                        >
                          ◉
                        </button>
                      )}
                      <button
                        className={`mini-btn${state.visible ? ' on' : ''}`}
                        title="Visible"
                        onClick={() => props.onTrackState(track.id, { visible: !state.visible })}
                      >
                        ●
                      </button>
                      <button
                        className={`mini-btn warn${state.muted ? ' on' : ''}`}
                        title="Mute"
                        onClick={() => props.onTrackState(track.id, { muted: !state.muted })}
                      >
                        M
                      </button>
                      <button
                        className={`mini-btn${state.solo ? ' on' : ''}`}
                        title="Solo"
                        onClick={() => props.onTrackState(track.id, { solo: !state.solo })}
                      >
                        S
                      </button>
                    </div>

                    {iconPicker === track.id && (
                      <div className="icon-picker">
                        <div className="icon-picker-head">
                          <span>Icon for {state.label ?? track.name}</span>
                          <button
                            className="mini-btn"
                            title="Default icon"
                            onClick={() => props.onTrackState(track.id, { icon: null })}
                          >
                            ↺
                          </button>
                        </div>
                        {ICON_GROUPS.map((group) => (
                          <div key={group.label}>
                            <div className="icon-picker-label">{group.label}</div>
                            <div className="icon-grid">
                              {group.icons.map((name) => (
                                <button
                                  key={name}
                                  className={`icon-cell${state.icon === name ? ' on' : ''}`}
                                  title={name}
                                  onClick={() => {
                                    props.onTrackState(track.id, { icon: name });
                                    setIconPicker(null);
                                  }}
                                >
                                  <IconGlyph name={name} size={16} />
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
});

function toPickerHex(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
}
