import { memo, useMemo } from 'react';
import {
  COLOR_SLOTS,
  NOTE_COLOR_MODES,
  type ColorSlot,
  type ColorTheme,
  type InstrumentPalette,
  type NoteColorMode,
} from '../models/ColorTheme';
import { INSTRUMENT_PALETTES, THEME_PRESETS } from '../models/Palettes';
import type { ColorSeed } from '../models/ThemeBuilder';
import type { InstrumentFamily, MidiProject, TrackState } from '../models/MidiProject';
import {
  DEFAULT_SETTINGS,
  type ColorEditMode,
  type IconGradientStyle,
  type RenderSettings,
} from '../models/RenderSettings';
import { familyLabel } from '../midi/InstrumentClassifier';
import { resolveIcon, type IconName } from '../renderer/iconLibrary';
import { accentGradient, MAX_GRADIENT_COLORS } from '../renderer/IconPaint';
import { hueRing, rotateHue } from '../utils/colors';
import { ColorField, Section, Select, Slider, Toggle } from './controls';
import { IconGradientPreview } from './IconGradientPreview';

interface Props {
  settings: RenderSettings;
  project: MidiProject | null;
  trackStates: Map<string, TrackState>;
  onSettings: (patch: Partial<RenderSettings>) => void;
  onTheme: (patch: Partial<ColorTheme>) => void;
  onSeed: (patch: Partial<ColorSeed> & { gradientSpread?: number }) => void;
  onInstrumentColor: (family: InstrumentFamily, color: string) => void;
  onApplyThemePreset: (id: string) => void;
  onApplyInstrumentPalette: (id: string) => void;
  onAutoAssignTrackColors: () => void;
  onClearTrackColors: () => void;
}

const SLOT_GROUPS = ['Canvas', 'Track panel', 'Grid', 'Clips', 'Notes', 'Playhead', 'Timeline'] as const;

export const ColorPanel = memo(function ColorPanel(props: Props) {
  const { settings, project, trackStates } = props;
  const simple = settings.colorEditMode === 'simple';

  // Only show instrument rows for families actually present in the file, so the
  // list stays about the arrangement rather than about General MIDI.
  const families = useMemo(() => {
    if (!project) return Object.keys(settings.instrumentColors) as InstrumentFamily[];
    const present = new Set<InstrumentFamily>();
    for (const track of project.tracks) present.add(track.family);
    return [...present].sort((a, b) => familyLabel(a).localeCompare(familyLabel(b)));
  }, [project, settings.instrumentColors]);

  const overriddenCount = useMemo(
    () => [...trackStates.values()].filter((state) => state.color).length,
    [trackStates],
  );

  return (
    <div className="panel">
      <Section
        title="Colour"
        action={
          <div className="segmented">
            {(['simple', 'advanced'] as ColorEditMode[]).map((mode) => (
              <button
                key={mode}
                className={settings.colorEditMode === mode ? 'on' : ''}
                onClick={() => props.onSettings({ colorEditMode: mode })}
              >
                {mode}
              </button>
            ))}
          </div>
        }
      >
        {simple ? (
          <>
            <ColorField
              label="Primary"
              value={settings.primaryColor}
              onChange={(primary) => props.onSeed({ primary })}
            />
            <ColorField
              label="Accent"
              value={settings.accentColor}
              onChange={(accent) => props.onSeed({ accent })}
            />
            <ColorField
              label="Background"
              value={settings.backgroundColor}
              onChange={(background) => props.onSeed({ background })}
            />
            <Slider
              label="Gradient spread"
              min={0}
              max={1}
              step={0.01}
              value={settings.gradientSpread}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(gradientSpread) => props.onSeed({ gradientSpread })}
            />
            <GradientStrip colors={settings.instrumentColors} />
            {overriddenCount > 0 && (
              <div className="field-row" style={{ gap: 6, alignItems: 'center' }}>
                <p className="hint" style={{ flex: 1, margin: 0 }}>
                  {overriddenCount} track{overriddenCount === 1 ? ' has its' : 's have their'} own colour, which the gradient does not change.
                </p>
                <button className="btn" onClick={props.onClearTrackColors}>
                  Clear
                </button>
              </div>
            )}
          </>
        ) : null}
      </Section>

      <IconSection settings={settings} project={project} trackStates={trackStates} onSettings={props.onSettings} />

      <Section title="Presets">
        <div className="preset-grid">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`preset${settings.themeId === preset.id ? ' active' : ''}`}
              onClick={() => props.onApplyThemePreset(preset.id)}
              title={preset.description}
            >
              <span className="preset-name">{preset.name}</span>
              <span className="preset-swatches">
                <span style={{ background: preset.theme.background }} />
                <span style={{ background: preset.theme.note }} />
                <span style={{ background: preset.theme.clipHeader }} />
                <span style={{ background: preset.theme.playheadGlow }} />
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Note colour source">
        <Select
          label="Mode"
          value={settings.noteColorMode}
          options={NOTE_COLOR_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
          onChange={(value: NoteColorMode) => props.onSettings({ noteColorMode: value })}
        />
      </Section>

      <Section title="Per-track overrides">
        <div className="field-row" style={{ gap: 6 }}>
          <button className="btn" onClick={props.onAutoAssignTrackColors}>
            Auto-assign
          </button>
          <button className="btn" onClick={props.onClearTrackColors} disabled={overriddenCount === 0}>
            Clear ({overriddenCount})
          </button>
        </div>
      </Section>

      {!simple && (
        <>
          <Section
            title="Instrument colours"
            action={
              <button
                className="mini-btn"
                title="Reset to palette"
                onClick={() => props.onApplyInstrumentPalette(settings.instrumentPaletteId)}
              >
                ↺
              </button>
            }
          >
            <div className="preset-grid" style={{ marginBottom: 10 }}>
              {INSTRUMENT_PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  className={`preset${settings.instrumentPaletteId === palette.id ? ' active' : ''}`}
                  onClick={() => props.onApplyInstrumentPalette(palette.id)}
                  title={palette.description}
                >
                  <span className="preset-name">{palette.name}</span>
                  <span className="preset-swatches">{swatchPreview(palette.colors)}</span>
                </button>
              ))}
            </div>

            {families.map((family) => (
              <ColorField
                key={family}
                label={familyLabel(family)}
                value={settings.instrumentColors[family]}
                onChange={(color) => props.onInstrumentColor(family, color)}
              />
            ))}
          </Section>

          {SLOT_GROUPS.map((group) => (
            <Section key={group} title={group}>
              {COLOR_SLOTS.filter((slot) => slot.group === group).map((slot) => (
                <ColorField
                  key={slot.slot}
                  label={slot.label}
                  value={settings.theme[slot.slot as ColorSlot]}
                  onChange={(color) => props.onTheme({ [slot.slot]: color } as Partial<ColorTheme>)}
                />
              ))}
            </Section>
          ))}
        </>
      )}
    </div>
  );
});

const GRADIENT_STYLES: Array<{ value: IconGradientStyle; label: string }> = [
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'radial', label: 'Radial' },
  { value: 'sweep', label: 'Sweep' },
];

const FALLBACK_PREVIEW: IconName[] = ['piano', 'violin', 'drums', 'sax', 'cloud'];

/**
 * Gradient icons: on/off, where the colours come from (the accent, or up to
 * four of your own), how they run across the icon, and how strongly icons
 * show and pulse.
 */
function IconSection({
  settings,
  project,
  trackStates,
  onSettings,
}: {
  settings: RenderSettings;
  project: MidiProject | null;
  trackStates: Map<string, TrackState>;
  onSettings: (patch: Partial<RenderSettings>) => void;
}) {
  const custom = settings.iconGradientSource === 'custom';
  const colors = settings.iconGradientColors;

  // Preview the song's own icons so the choice is made against what will show.
  const previewIcons = useMemo(() => {
    if (!project?.tracks.length) return FALLBACK_PREVIEW;
    const seen: IconName[] = [];
    for (const track of project.tracks) {
      const state = trackStates.get(track.id);
      const icon = resolveIcon(track, (state?.icon as IconName | null) ?? null, settings.iconSetId);
      if (icon !== 'blank' && !seen.includes(icon)) seen.push(icon);
      if (seen.length === 5) break;
    }
    return seen.length ? seen : FALLBACK_PREVIEW;
  }, [project, settings.iconSetId, trackStates]);

  const useCustom = () => {
    // Start from what is on screen: the accent's gradient, unless colours of
    // your own were already set up.
    const untouched = colors.join() === DEFAULT_SETTINGS.iconGradientColors.join();
    onSettings({
      iconGradientSource: 'custom',
      iconGradientColors: untouched ? accentGradient(settings.accentColor) : colors,
    });
  };
  const setColor = (index: number, color: string) =>
    onSettings({ iconGradientColors: colors.map((c, i) => (i === index ? color : c)) });
  const removeColor = (index: number) =>
    onSettings({ iconGradientColors: colors.filter((_, i) => i !== index) });
  const addColor = () =>
    onSettings({ iconGradientColors: [...colors, rotateHue(colors[colors.length - 1] ?? settings.accentColor, 45)] });

  return (
    <Section title="Icons">
      <Toggle
        label="Gradient icons"
        checked={settings.iconGradient}
        onChange={(iconGradient) => onSettings({ iconGradient })}
      />
      {settings.iconGradient ? (
        <>
          <IconGradientPreview settings={settings} icons={previewIcons} />
          <div className="segmented gradient-source">
            <button className={custom ? '' : 'on'} onClick={() => onSettings({ iconGradientSource: 'accent' })}>
              Match accent
            </button>
            <button className={custom ? 'on' : ''} onClick={useCustom}>
              Custom
            </button>
          </div>
          {custom && (
            <div className="gradient-stops">
              {colors.map((color, index) => (
                <div className="gradient-stop" key={index}>
                  <ColorField label={`Colour ${index + 1}`} value={color} onChange={(c) => setColor(index, c)} />
                  <button
                    className="mini-btn"
                    title="Remove this colour"
                    disabled={colors.length <= 2}
                    onClick={() => removeColor(index)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {colors.length < MAX_GRADIENT_COLORS && (
                <button className="btn" onClick={addColor}>
                  + Add colour
                </button>
              )}
            </div>
          )}
          <Select
            label="Style"
            value={settings.iconGradientStyle}
            options={GRADIENT_STYLES}
            onChange={(iconGradientStyle: IconGradientStyle) => onSettings({ iconGradientStyle })}
          />
          <Slider
            label="Strength"
            min={0.2}
            max={1}
            step={0.01}
            value={settings.iconGradientOpacity}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(iconGradientOpacity) => onSettings({ iconGradientOpacity })}
          />
          <Slider
            label="Glow sync"
            min={0}
            max={1}
            step={0.01}
            value={settings.iconPulseStrength}
            format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
            onChange={(iconPulseStrength) => onSettings({ iconPulseStrength })}
          />
          <Toggle
            label="Glow sync on clips"
            checked={settings.glowSyncClips ?? false}
            onChange={(glowSyncClips) => onSettings({ glowSyncClips })}
          />
          <Toggle
            label="Glow sync on lanes"
            checked={settings.glowSyncLanes ?? false}
            onChange={(glowSyncLanes) => onSettings({ glowSyncLanes })}
          />
        </>
      ) : null}
    </Section>
  );
}

/** Live preview of the derived instrument gradient. */
function GradientStrip({ colors }: { colors: InstrumentPalette }) {
  const order: InstrumentFamily[] = [
    'piano',
    'strings',
    'cello',
    'bass',
    'brass',
    'woodwinds',
    'choir',
    'synth',
    'pad',
    'drums',
  ];
  return (
    <div className="gradient-strip" title="Derived instrument gradient">
      {order.map((family) => (
        <span key={family} style={{ background: colors[family] }} />
      ))}
    </div>
  );
}

function swatchPreview(colors: InstrumentPalette) {
  const keys: InstrumentFamily[] = ['piano', 'strings', 'brass', 'drums'];
  return keys.map((key) => <span key={key} style={{ background: colors[key] }} />);
}

/** Distinct hues for every track, used by the auto-assign button. */
export function autoTrackColors(count: number): string[] {
  return hueRing(count, 0.5, 0.68, 195);
}
