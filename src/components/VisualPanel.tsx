import { memo } from 'react';
import { INTRO_MOTIONS } from '../models/RenderSettings';
import type {
  IntroMotion,
  FollowMode,
  PanelStyle,
  PitchMode,
  RenderSettings,
  TimelineMode,
  TrackHeightPreset,
} from '../models/RenderSettings';
import { LOOK_PRESETS } from '../models/LookPresets';
import { ICON_SETS } from '../renderer/iconLibrary';
import { CameraKeys } from './CameraKeys';
import { Field, Section, Select, Slider, Toggle } from './controls';
import { FillColors } from './FillColors';
import { PositionPad } from './PositionPad';
import { SavedLooks } from './SavedLooks';

interface Props {
  settings: RenderSettings;
  onSettings: (patch: Partial<RenderSettings>) => void;
  onApplyLook: (id: string) => void;
  /** Bars currently across the frame, and a setter that rescales the view. */
  barsOnScreen: number;
  onBarsOnScreen: (bars: number) => void;
  /** Tempo as written in the file, before any edit. */
  originalTempo: number;
  tempoScale: number;
  onTempoScale: (scale: number) => void;
  /** The song's tracks, for camera keyframes. */
  tracks: Array<{ id: string; name: string }>;
  getPosition: () => number;
  onSeek: (seconds: number) => void;
  duration: number;
  onApplySavedLook: (look: Partial<RenderSettings>) => void;
  /** Width ÷ height of the video, for the end card's position pad. */
  frameAspect: number;
  /** Jumps to where the end card is fully shown, to see it while placing it. */
  onPreviewOutro: () => void;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const px = (value: number) => `${value}px`;

export const VisualPanel = memo(function VisualPanel({
  settings,
  onSettings,
  onApplyLook,
  barsOnScreen,
  onBarsOnScreen,
  originalTempo,
  tempoScale,
  onTempoScale,
  tracks,
  getPosition,
  onSeek,
  duration,
  onApplySavedLook,
  frameAspect,
  onPreviewOutro,
}: Props) {
  const advanced = settings.showAdvancedLook;
  const effectiveTempo = originalTempo * tempoScale;

  return (
    <div className="panel">
      <Section
        title="Look"
        action={
          <div className="segmented">
            <button
              className={advanced ? '' : 'on'}
              onClick={() => onSettings({ showAdvancedLook: false })}
            >
              simple
            </button>
            <button
              className={advanced ? 'on' : ''}
              onClick={() => onSettings({ showAdvancedLook: true })}
            >
              advanced
            </button>
          </div>
        }
      >
        <div className="preset-grid look-grid">
          {LOOK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`preset${settings.lookId === preset.id ? ' active' : ''}`}
              onClick={() => onApplyLook(preset.id)}
              title={preset.description}
            >
              <span className="preset-name">{preset.name}</span>
            </button>
          ))}
        </div>
        <SavedLooks settings={settings} onApply={onApplySavedLook} />
      </Section>

      <Section title="Essentials">
        <Slider
          label="Tracks in view"
          min={0}
          max={16}
          step={1}
          value={settings.visibleTrackCount}
          format={(v) => (v === 0 ? 'All' : String(v))}
          onChange={(visibleTrackCount) => onSettings({ visibleTrackCount })}
        />
        <Slider
          label="Bars on screen"
          min={2}
          max={64}
          step={1}
          value={barsOnScreen}
          format={(v) => String(Math.round(v))}
          onChange={onBarsOnScreen}
        />
        <Slider
          label="Note size"
          min={2}
          max={24}
          step={0.5}
          value={settings.noteHeight}
          format={px}
          onChange={(noteHeight) => onSettings({ noteHeight })}
        />
        <Slider
          label="Glow"
          min={0}
          max={1.5}
          step={0.01}
          value={settings.noteGlow}
          format={percent}
          onChange={(noteGlow) => onSettings({ noteGlow })}
        />
        <Toggle
          label="Dynamic"
          checked={settings.dynamicCamera}
          onChange={(dynamicCamera) => onSettings({ dynamicCamera })}
        />
        {settings.dynamicCamera && (
          <>
            <Slider
              label="Camera speed"
              min={0}
              max={1}
              step={0.05}
              value={settings.dynamicSpeed}
              format={(value) => (value < 0.34 ? 'Slow' : value < 0.67 ? 'Medium' : 'Fast')}
              onChange={(dynamicSpeed) => onSettings({ dynamicSpeed })}
            />
            <Select
              label="Camera motion"
              value={settings.dynamicMotion}
              options={[
                { value: 'glide', label: 'Glide — eases in and out' },
                { value: 'snap', label: 'Snap — quick, then settles' },
                { value: 'drift', label: 'Drift — slow and even' },
              ]}
              onChange={(dynamicMotion) => onSettings({ dynamicMotion: dynamicMotion as RenderSettings['dynamicMotion'] })}
            />
            <p className="hint">Only the tracks that are playing are in view; others fade out, and fade back in ahead of their entrance. Exports follow it too.</p>
            <CameraKeys
              keys={settings.cameraKeys ?? []}
              onKeys={(cameraKeys) => onSettings({ cameraKeys })}
              tracks={tracks}
              getPosition={getPosition}
              onSeek={onSeek}
              duration={duration}
            />
          </>
        )}
        <Select
          label="Follow"
          value={settings.followMode}
          options={[
            { value: 'continuous', label: 'Scroll' },
            { value: 'page', label: 'Page' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(value: FollowMode) => onSettings({ followMode: value })}
        />
      </Section>

      <Section title="Tempo">
        <Field label="BPM">
          <div className="field-row">
            <input
              className="number-input"
              type="number"
              min={10}
              max={600}
              step={1}
              value={Math.round(effectiveTempo)}
              onChange={(event) => {
                const bpm = Number(event.target.value);
                if (Number.isFinite(bpm) && bpm > 0 && originalTempo > 0) {
                  onTempoScale(Math.min(Math.max(bpm / originalTempo, 0.1), 6));
                }
              }}
            />
            <button className="mini-btn" title={`Back to ${Math.round(originalTempo)} BPM`} onClick={() => onTempoScale(1)}>
              ↺
            </button>
            {Math.abs(tempoScale - 1) > 1e-6 && (
              <span className="slider-value">file {Math.round(originalTempo)}</span>
            )}
          </div>
        </Field>
      </Section>

      {advanced && (
        <>
          <Section title="Layout">
            <Slider
              label="Playhead position"
              min={0.05}
              max={0.8}
              step={0.01}
              value={settings.followAnchor}
              format={percent}
              onChange={(followAnchor) => onSettings({ followAnchor })}
            />
            <Select
              label="Track height"
              value={settings.trackHeightPreset}
              options={[
                { value: 'auto', label: 'Auto (fit)' },
                { value: 'compact', label: 'Compact' },
                { value: 'normal', label: 'Normal' },
                { value: 'large', label: 'Large' },
                { value: 'cinematic', label: 'Cinematic' },
              ]}
              onChange={(value: TrackHeightPreset) => onSettings({ trackHeightPreset: value })}
            />
            <Slider
              label="Height scale"
              min={0.4}
              max={2.5}
              step={0.05}
              value={settings.trackHeightScale}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(trackHeightScale) => onSettings({ trackHeightScale })}
            />
            <Select
              label="Pitch mode"
              value={settings.pitchMode}
              options={[
                { value: 'relative', label: 'Per track' },
                { value: 'global', label: 'Global' },
              ]}
              onChange={(value: PitchMode) => onSettings({ pitchMode: value })}
            />
            <Slider
              label="Pitch padding"
              min={0}
              max={12}
              step={1}
              value={settings.pitchPadding}
              format={(v) => `${v} st`}
              onChange={(pitchPadding) => onSettings({ pitchPadding })}
            />
            <Toggle
              label="Even rows for drum kits"
              checked={settings.compactPercussion}
              onChange={(compactPercussion) => onSettings({ compactPercussion })}
            />
            <Slider
              label="Panel width"
              min={0}
              max={0.24}
              step={0.005}
              value={settings.trackPanelRatio}
              format={percent}
              onChange={(trackPanelRatio) => onSettings({ trackPanelRatio })}
            />
            <Slider
              label="Frame margin"
              min={0}
              max={0.06}
              step={0.002}
              value={settings.marginRatio}
              format={percent}
              onChange={(marginRatio) => onSettings({ marginRatio })}
            />
          </Section>

          <Section title="Notes">
            <Slider
              label="Corner radius"
              min={0}
              max={8}
              step={0.5}
              value={settings.noteRadius}
              format={px}
              onChange={(noteRadius) => onSettings({ noteRadius })}
            />
            <Slider
              label="Min width"
              min={0.5}
              max={12}
              step={0.5}
              value={settings.noteMinWidth}
              format={px}
              onChange={(noteMinWidth) => onSettings({ noteMinWidth })}
            />
            <Slider
              label="Opacity"
              min={0.2}
              max={1}
              step={0.01}
              value={settings.noteOpacity}
              format={percent}
              onChange={(noteOpacity) => onSettings({ noteOpacity })}
            />
            <Slider
              label="Velocity → brightness"
              min={0}
              max={1}
              step={0.01}
              value={settings.velocityBrightness}
              format={percent}
              onChange={(velocityBrightness) => onSettings({ velocityBrightness })}
            />
            <Slider
              label="Density reduction"
              min={0}
              max={1}
              step={0.01}
              value={settings.densityReduction}
              format={percent}
              onChange={(densityReduction) => onSettings({ densityReduction })}
            />
            <Toggle
              label="Light notes as they play"
              checked={settings.highlightActiveNotes}
              onChange={(highlightActiveNotes) => onSettings({ highlightActiveNotes })}
            />
            <Slider
              label="Afterglow"
              min={0}
              max={3}
              step={0.05}
              value={settings.noteAfterglow}
              format={(v) => `${v.toFixed(2)}s`}
              onChange={(noteAfterglow) => onSettings({ noteAfterglow })}
            />
          </Section>

          <Section title="Track panel">
            <Toggle
              label="Show panel"
              checked={settings.showTrackPanel}
              onChange={(v) => onSettings({ showTrackPanel: v })}
            />
            <Select
              label="Panel style"
              value={settings.panelStyle}
              options={[
                { value: 'cinematic', label: 'Cinematic' },
                { value: 'list', label: 'List' },
              ]}
              onChange={(value: PanelStyle) => onSettings({ panelStyle: value })}
            />
            <Toggle
              label="Instrument icons"
              checked={settings.showInstrumentIcons}
              onChange={(v) => onSettings({ showInstrumentIcons: v })}
            />
            <Select
              label="Icon set"
              value={settings.iconSetId}
              options={ICON_SETS.map((set) => ({ value: set.id, label: set.name }))}
              onChange={(iconSetId) => onSettings({ iconSetId })}
            />
            <Toggle
              label="Sub-labels"
              checked={settings.showTrackSublabels}
              onChange={(v) => onSettings({ showTrackSublabels: v })}
            />
          </Section>

          <Section title="Chrome">
            <Toggle label="Clip regions" checked={settings.showClips} onChange={(v) => onSettings({ showClips: v })} />
            <Toggle label="Clip names" checked={settings.showClipNames} onChange={(v) => onSettings({ showClipNames: v })} />
            <Toggle label="Lane separators" checked={settings.showSeparators} onChange={(v) => onSettings({ showSeparators: v })} />
            <Toggle label="Ruler" checked={settings.showRuler} onChange={(v) => onSettings({ showRuler: v })} />
            <Toggle label="Markers" checked={settings.showMarkers} onChange={(v) => onSettings({ showMarkers: v })} />
            <Toggle label="Grid" checked={settings.showGrid} onChange={(v) => onSettings({ showGrid: v })} />
            <Toggle label="Beat lines" checked={settings.showBeatLines} onChange={(v) => onSettings({ showBeatLines: v })} />
            <Slider
              label="Bar opacity"
              min={0}
              max={1}
              step={0.01}
              value={settings.gridBarOpacity}
              format={percent}
              onChange={(gridBarOpacity) => onSettings({ gridBarOpacity })}
            />
            <Slider
              label="Separator"
              min={0}
              max={1}
              step={0.01}
              value={settings.separatorOpacity}
              format={percent}
              onChange={(separatorOpacity) => onSettings({ separatorOpacity })}
            />
            <Select
              label="Timeline"
              value={settings.timelineMode}
              options={[
                { value: 'bars', label: 'Bars' },
                { value: 'beats', label: 'Bars + beats' },
                { value: 'seconds', label: 'Seconds' },
                { value: 'timecode', label: 'Timecode' },
              ]}
              onChange={(value: TimelineMode) => onSettings({ timelineMode: value })}
            />
          </Section>

          <Section title="Atmosphere">
            <Slider
              label="Ambient glow"
              min={0}
              max={1}
              step={0.01}
              value={settings.backgroundGlow}
              format={percent}
              onChange={(backgroundGlow) => onSettings({ backgroundGlow })}
            />
            <Slider
              label="Vignette"
              min={0}
              max={1}
              step={0.01}
              value={settings.vignette}
              format={percent}
              onChange={(vignette) => onSettings({ vignette })}
            />
            <Toggle label="Playhead" checked={settings.showPlayhead} onChange={(v) => onSettings({ showPlayhead: v })} />
            <Slider
              label="Playhead width"
              min={0.5}
              max={6}
              step={0.1}
              value={settings.playheadWidth}
              format={px}
              onChange={(playheadWidth) => onSettings({ playheadWidth })}
            />
            <Slider
              label="Playhead glow"
              min={0}
              max={1.5}
              step={0.01}
              value={settings.playheadGlow}
              format={percent}
              onChange={(playheadGlow) => onSettings({ playheadGlow })}
            />
            <Toggle
              label="Fade out at the end"
              checked={settings.playheadFadeOut ?? true}
              onChange={(v) => onSettings({ playheadFadeOut: v })}
            />
          </Section>

          <Section title="Title">
            <Toggle label="Show title" checked={settings.showTitle} onChange={(v) => onSettings({ showTitle: v })} />
            <Field label="Text">
              <input
                className="text-input"
                value={settings.titleText}
                placeholder="File name"
                onChange={(event) => onSettings({ titleText: event.target.value })}
              />
            </Field>
          </Section>
        </>
      )}

      <Section title="Intro & end card">
        <Toggle label="Intro title card" checked={settings.introCard ?? false} onChange={(introCard) => onSettings({ introCard })} />
        {settings.introCard && (
          <Select
            label="Intro shows"
            value={settings.introStyle ?? 'title'}
            options={[
              { value: 'title', label: 'Title card' },
              { value: 'thumbnail', label: 'Thumbnail' },
              { value: 'both', label: 'Thumbnail + title card' },
            ]}
            onChange={(introStyle) => onSettings({ introStyle: introStyle as RenderSettings['introStyle'] })}
          />
        )}
        {settings.introCard && (settings.introStyle === 'thumbnail' || settings.introStyle === 'both') && (
          <>
            <Slider
              label="Intro length"
              min={2}
              max={15}
              step={0.5}
              value={settings.introSeconds ?? 4}
              format={(value) => `${value}s`}
              onChange={(introSeconds) => onSettings({ introSeconds })}
            />
            <Select
              label="Intro animation"
              value={settings.introMotion ?? 'dissolve'}
              options={INTRO_MOTIONS.map((motion) => ({ value: motion.value, label: motion.label }))}
              onChange={(introMotion) => onSettings({ introMotion: introMotion as IntroMotion })}
            />
            <p className="hint">{INTRO_MOTIONS.find((motion) => motion.value === (settings.introMotion ?? 'dissolve'))?.hint}.</p>
            <p className="hint">Your thumbnail (with its edits and filter) fills the frame from the very start of the video, while a recording's intro plays if it has one, then slowly dissolves into the arrangement.</p>
          </>
        )}
        {settings.introCard && settings.introStyle !== 'thumbnail' && (
          <>
            <Field label="Title">
              <input
                className="text-input"
                value={settings.titleText}
                placeholder="Song title (file name)"
                onChange={(event) => onSettings({ titleText: event.target.value })}
              />
            </Field>
            <Field label="Subtitle">
              <input
                className="text-input"
                value={settings.introSubtitle ?? ''}
                placeholder="Artist, series… (optional)"
                onChange={(event) => onSettings({ introSubtitle: event.target.value })}
              />
            </Field>
            {settings.introStyle === 'both' ? (
              <p className="hint">The title card shows over the thumbnail at the same time, and fades away as the thumbnail dissolves into the arrangement.</p>
            ) : (
            <>
            <Slider
              label="Intro length"
              min={2}
              max={10}
              step={0.5}
              value={settings.introSeconds ?? 4}
              format={(value) => `${value}s`}
              onChange={(introSeconds) => onSettings({ introSeconds })}
            />
            <p className="hint">The title fades in over the opening, then fades away as the music gets going.</p>
            </>
            )}
          </>
        )}
        <Toggle label="End card" checked={settings.outroCard ?? false} onChange={(outroCard) => onSettings({ outroCard })} />
        {settings.outroCard && (
          <>
            <Field label="Text">
              <input
                className="text-input"
                value={settings.outroText ?? ''}
                placeholder="Thanks for listening"
                onChange={(event) => onSettings({ outroText: event.target.value })}
              />
            </Field>
            <FillColors
              label="Text colour"
              colors={settings.outroTextColors ?? ['#f2f5f5']}
              min={1}
              onChange={(outroTextColors) => onSettings({ outroTextColors })}
            />
            <Field label="Sub-text">
              <input
                className="text-input"
                value={settings.outroSubtext ?? ''}
                placeholder="Song title"
                onChange={(event) => onSettings({ outroSubtext: event.target.value })}
              />
            </Field>
            <PositionPad
              label="Text position"
              x={settings.outroX ?? 0.08}
              y={settings.outroY ?? 0.5}
              aspect={frameAspect}
              align={settings.outroAlign ?? 'left'}
              onChange={(outroX, outroY) => onSettings({ outroX, outroY })}
            />
            <div className="field">
              <label>Align</label>
              <div className="segmented" style={{ display: 'flex' }}>
                {(['left', 'center', 'right'] as const).map((align) => (
                  <button
                    key={align}
                    style={{ flex: 1 }}
                    className={(settings.outroAlign ?? 'left') === align ? 'on' : ''}
                    onClick={() => onSettings({ outroAlign: align })}
                  >
                    {align}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-row" style={{ gap: 6 }}>
              <button className="btn" onClick={onPreviewOutro} title="Jump to the end card to see it while you place it">
                Show end card
              </button>
              <button className="btn" onClick={() => onSettings({ outroX: 0.08, outroY: 0.5, outroAlign: 'left' })}>
                Reset position
              </button>
            </div>
            <p className="hint">Drag in the frame to move the text. The striped strip on the right is where YouTube's end-screen elements usually go.</p>
            <FillColors
              label="Sub-text colour"
              colors={settings.outroSubColors ?? []}
              min={0}
              auto="Accent"
              fallback={settings.accentColor}
              onChange={(outroSubColors) => onSettings({ outroSubColors })}
            />
            <Slider
              label="End card length"
              min={2}
              max={15}
              step={0.5}
              value={settings.outroSeconds ?? 5}
              format={(value) => `${value}s`}
              onChange={(outroSeconds) => onSettings({ outroSeconds })}
            />
            <p className="hint">After the last note the picture fades to black and the text fades up. Videos run this much longer; the right-hand side stays clear for YouTube's end screen.</p>
          </>
        )}
      </Section>
    </div>
  );
});
