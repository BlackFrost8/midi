import { TITLE_FONTS } from '../thumbnail/Fonts';
import { memo, useMemo, type ReactNode } from 'react';
import { lchCss, lchHex } from '../thumbnail/Oklch';
import {
  DEFAULT_COLOUR_OPTIONS,
  GRADIENT_TARGETS,
  PALETTE_PRESETS,
  buildPalette,
  type ColourOptions,
  type GradientDirection,
  type GradientTarget,
  type GroundTone,
  type TextColour,
} from '../thumbnail/Palette';
import {
  DETAILS,
  GROUNDS,
  STYLES,
  SUBJECTS,
  nameOf,
  type DetailId,
  type GroundId,
  type StyleId,
  type SubjectId,
} from '../thumbnail/Recipe';
import { CLASSICS } from '../thumbnail/classic/ClassicStyles';
import { DEFAULT_TITLE_EFFECTS, type TextCase, type ThumbnailDesign, type ThumbnailOptions, type TitleEffects } from '../thumbnail/ThumbnailDesign';
import { ColorField, Section, Select, Slider, Toggle } from './controls';
import { ThumbnailView } from './ThumbnailView';
import { BRUSHES, STAMPS, TEXTURES, isStampBrush, type EditTool, type TextureId, type ThumbEdits, type ThumbElement } from '../thumbnail/Editor';
import { BrushIcon, TextureIcon } from './BrushIcon';
import type { ToolSettings } from './ThumbnailEditor';

export type ThumbnailExportSize = 'youtube' | 'hd' | 'uhd' | 'square';

interface Props {
  design: ThumbnailDesign;
  options: ThumbnailOptions;
  onOptions: (patch: Partial<ThumbnailOptions>) => void;
  preview: HTMLCanvasElement | null;
  previewVersion: number;
  durationSeconds: number;
  analyzingAudio: boolean;
  /** The Colour tab's accent: the thumbnail's starting colour. */
  accent: string;
  edits: ThumbEdits;
  onEdits: (edits: ThumbEdits, commit: boolean, mergeKey?: string) => void;
  tools: ToolSettings;
  onTools: (tools: ToolSettings) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  history: { undo: number; redo: number };
  /** The Filter section, shown after the title settings. */
  filter?: ReactNode;
}

const CASES: Array<{ value: TextCase; label: string }> = [
  { value: 'asis', label: 'As typed' },
  { value: 'lower', label: 'lower' },
  { value: 'upper', label: 'UPPER' },
];

const TONE_OPTIONS: Array<{ value: GroundTone | 'auto'; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'colour', label: 'Colour' },
];

const TEXT_OPTIONS: Array<{ value: TextColour; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'white', label: 'White' },
  { value: 'dark', label: 'Dark' },
  { value: 'accent', label: 'Accent' },
  { value: 'custom', label: 'Custom' },
];

export const ThumbnailPanel = memo(function ThumbnailPanel(props: Props) {
  const { design, options, onOptions } = props;
  const { mood, palette, recipe } = design;
  const colour = options.colour;
  const setColour = (patch: Partial<ColourOptions>) => onOptions({ colour: { ...colour, ...patch } });

  const subjects = SUBJECTS.filter((entry) =>
    entry.needs === 'melody'
      ? design.material.melody.length >= 10
      : entry.needs === 'bars'
        ? design.material.activity.length >= 8
        : true,
  );

  const presets = useMemo(
    () =>
      PALETTE_PRESETS.map((preset) => {
        const options = { ...DEFAULT_COLOUR_OPTIONS, ...preset.options };
        return { ...preset, options, palette: buildPalette(mood, design.seed, { ...options, defaultMain: props.accent }) };
      }),
    [design.seed, mood, props.accent],
  );
  const activePreset = presets.find((preset) =>
    (['scheme', 'main', 'accent', 'ground', 'hueShift', 'vividness', 'lightness'] as Array<keyof ColourOptions>).every(
      (key) => JSON.stringify(preset.options[key] ?? null) === JSON.stringify(colour[key] ?? null),
    ),
  );
  const effects = { ...DEFAULT_TITLE_EFFECTS, ...options.titleEffects };
  const setEffects = (patch: Partial<TitleEffects>) => onOptions({ titleEffects: { ...effects, ...patch } });
  // What "auto" picks: the opposite of a light or dark title.
  const lightTitle = colour.text === 'white' || (colour.text === 'custom' ? isLightHex(effects.customColor) : colour.text !== 'dark');
  const autoOutline = lightTitle ? '#080a0e' : '#ffffff';
  const autoShadow = lightTitle ? '#000000' : '#ffffff';
  const gradient = colour.gradient ?? [];
  const setGradient = (next: string[]) => setColour({ gradient: next });
  const targets = colour.gradientTargets ?? ['background'];
  const toggleTarget = (id: GradientTarget) =>
    setColour({ gradientTargets: targets.includes(id) ? targets.filter((t) => t !== id) : [...targets, id] });

  const toggleDetail = (id: DetailId) => {
    const current = recipe.details;
    onOptions({ details: current.includes(id) ? current.filter((d) => d !== id) : [...current, id] });
  };

  return (
    <div className="panel">
      <div className="thumb-feed">
        <ThumbnailView
          source={props.preview}
          version={props.previewVersion}
          durationSeconds={props.durationSeconds}
          rounded
        />
      </div>

      <EditSection {...props} />
      <LayersSection {...props} />

      <Section title="Song">
        <div className="thumb-reading">
          <span>{mood.keyLabel}</span>
          <span>{Math.round(mood.bpm)} BPM</span>
          <span className="thumb-colour">
            <span className="thumb-chip" style={{ background: lchCss(palette.base) }} />
            {palette.hueName}
          </span>
          {props.analyzingAudio && <span className="thumb-dim">Listening…</span>}
        </div>
        <Meter label="Energy" value={mood.energy} />
        <Meter label="Brightness" value={mood.valence} />
        <Meter label="Tension" value={mood.tension} />
        <Meter label="Air" value={mood.ambience} />
        <div className="thumb-words">{mood.words.join(' · ')}</div>
      </Section>

      <Section
        title="Look"
        action={
          <span className="field-row" style={{ gap: 4 }}>
            <button className="mini-btn wide" onClick={() => onOptions({ variation: options.variation + 1 })}>
              Shuffle
            </button>
            {options.variation !== 0 && (
              <button className="mini-btn wide" onClick={() => onOptions({ variation: 0 })}>
                Original
              </button>
            )}
          </span>
        }
      >
        <Select<StyleId | 'auto'>
          label="Style"
          value={options.style}
          options={[
            { value: 'auto', label: `Auto · ${nameOf(STYLES, recipe.auto.style)}` },
            ...STYLES.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          onChange={(style) => onOptions({ style })}
        />
        {recipe.style !== 'layered' && recipe.style !== 'moonring' ? (
          <div className="thumb-words">{CLASSICS.find((entry) => entry.id === recipe.style)?.blurb}</div>
        ) : (
        <>
        <Select<GroundId | 'auto'>
          label="Background"
          value={options.ground}
          options={[
            { value: 'auto', label: `Auto · ${nameOf(GROUNDS, recipe.auto.ground)}` },
            ...GROUNDS.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          onChange={(ground) => onOptions({ ground })}
        />
        <Select<SubjectId | 'auto'>
          label="Main shape"
          value={options.subject}
          options={[
            { value: 'auto', label: `Auto · ${nameOf(SUBJECTS, recipe.auto.subject)}` },
            ...subjects.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          onChange={(subject) => onOptions({ subject })}
        />
        <Select<SubjectId | 'auto'>
          label="Second shape"
          value={options.secondary}
          options={[
            { value: 'auto', label: `Auto · ${nameOf(SUBJECTS, recipe.auto.secondary)}` },
            ...subjects.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          onChange={(secondary) => onOptions({ secondary })}
        />
        <div className="field">
          <label>
            Details
            {options.details !== null && (
              <button className="link-btn" onClick={() => onOptions({ details: null })}>
                auto
              </button>
            )}
          </label>
          <div className="thumb-chips">
            {DETAILS.map((entry) => (
              <button
                key={entry.id}
                className={`chip${recipe.details.includes(entry.id) ? ' on' : ''}`}
                onClick={() => toggleDetail(entry.id)}
              >
                {entry.name}
              </button>
            ))}
          </div>
        </div>
        </>
        )}
      </Section>

      <Section
        title="Colour"
        action={
          <button className="mini-btn wide" onClick={() => onOptions({ colour: { ...DEFAULT_COLOUR_OPTIONS, text: colour.text } })}>
            Reset
          </button>
        }
      >
        <div className="thumb-presets">
          {presets.map((preset) => (
            <button
              key={preset.id}
              className={`thumb-preset${activePreset?.id === preset.id ? ' active' : ''}`}
              onClick={() =>
                onOptions({ colour: { ...DEFAULT_COLOUR_OPTIONS, ...preset.options, gradient: colour.gradient, gradientTargets: colour.gradientTargets, gradientDirection: colour.gradientDirection, text: colour.text } })
              }
            >
              <span className="thumb-preset-swatch" style={{ background: toneSwatch(preset.options.ground, preset.palette.base) }}>
                <span style={{ background: lchCss(preset.palette.base) }} />
                <span style={{ background: lchCss(preset.palette.accent) }} />
                <span style={{ background: lchCss(preset.palette.third) }} />
              </span>
              <span>{preset.name}</span>
            </button>
          ))}
        </div>

        <Segmented label="Background" value={colour.ground} options={TONE_OPTIONS} onChange={(ground) => setColour({ ground })} />
        <OverridableColour
          label="Main"
          value={colour.main}
          derived={lchHex(palette.base)}
          onChange={(main) => setColour({ main })}
        />
        <OverridableColour
          label="Accent"
          value={colour.accent}
          derived={lchHex(palette.accent)}
          onChange={(accent) => setColour({ accent })}
        />
        <div className="field">
          <label>Gradient</label>
          <div className="thumb-gradient">
            {gradient.length >= 2 && (
              <span className="thumb-gradient-bar" style={{ background: `linear-gradient(90deg, ${gradient.join(', ')})` }} />
            )}
            <div className="thumb-gradient-stops">
              {gradient.map((hex, index) => (
                <span key={index} className="thumb-stop">
                  <span className="swatch" style={{ background: hex }}>
                    <input
                      type="color"
                      value={hex}
                      aria-label={`Gradient colour ${index + 1}`}
                      onChange={(event) => setGradient(gradient.map((c, i) => (i === index ? event.target.value : c)))}
                    />
                  </span>
                  <button className="mini-btn" title="Remove" onClick={() => setGradient(gradient.filter((_, i) => i !== index))}>
                    ✕
                  </button>
                </span>
              ))}
              {gradient.length < 5 && (
                <button
                  className="chip"
                  onClick={() =>
                    setGradient(gradient.length ? [...gradient, lchHex(palette.third)] : [lchHex(palette.base), lchHex(palette.accent)])
                  }
                >
                  + colour
                </button>
              )}
            </div>
          </div>
        </div>
        {gradient.length >= 2 && (
          <>
            <div className="field">
              <label>Gradient on</label>
              <div className="thumb-chips">
                {GRADIENT_TARGETS.map((entry) => (
                  <button
                    key={entry.id}
                    className={`chip${targets.includes(entry.id) ? ' on' : ''}`}
                    onClick={() => toggleTarget(entry.id)}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
              <p className="hint">Shapes apply to layered designs; classic styles take background and title.</p>
            </div>
            <Segmented<GradientDirection>
              label="Direction"
              value={colour.gradientDirection ?? 'diagonal'}
              options={[
                { value: 'horizontal', label: '→' },
                { value: 'vertical', label: '↓' },
                { value: 'diagonal', label: '↘' },
              ]}
              onChange={(gradientDirection) => setColour({ gradientDirection })}
            />
          </>
        )}
        <Slider
          label="Vividness"
          value={colour.vividness}
          min={0.2}
          max={1.8}
          step={0.05}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(vividness) => setColour({ vividness })}
        />
        <Slider
          label="Lightness"
          value={colour.lightness}
          min={-0.3}
          max={0.3}
          step={0.01}
          format={(value) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
          onChange={(lightness) => setColour({ lightness })}
        />
      </Section>

      <Section title="Title">
        <Toggle label="Show title" checked={options.showTitle} onChange={(showTitle) => onOptions({ showTitle })} />
        <div className="field-wide">
          <label>Title</label>
          <input
            className="text-input"
            value={options.title ?? mood.title}
            spellCheck={false}
            onChange={(event) => onOptions({ title: event.target.value })}
          />
        </div>
        <div className="field-wide">
          <label>Second line</label>
          <input
            className="text-input"
            value={options.subtitle}
            spellCheck={false}
            onChange={(event) => onOptions({ subtitle: event.target.value })}
          />
        </div>
        <div className="field-wide">
          <label>Font</label>
          <div className="thumb-fonts">
            {TITLE_FONTS.map((font) => (
              <button
                key={font.id}
                className={`thumb-font${options.font === font.id ? ' on' : ''}`}
                style={{ fontFamily: font.stack, fontWeight: font.weight }}
                onClick={() => onOptions({ font: font.id })}
              >
                {font.name}
              </button>
            ))}
          </div>
        </div>
        <Segmented label="Case" value={options.textCase} options={CASES} onChange={(textCase) => onOptions({ textCase })} />
        <Segmented label="Colour" value={colour.text} options={TEXT_OPTIONS} onChange={(text) => setColour({ text })} />
        {colour.text === 'custom' && (
          <ColorField label="Title colour" value={effects.customColor} onChange={(customColor) => setEffects({ customColor })} />
        )}
        <Slider
          label="Outline"
          value={effects.outline}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(outline) => setEffects({ outline })}
        />
        {effects.outline > 0 && (
          <OverridableColour label="Outline colour" value={effects.outlineColor} derived={autoOutline} onChange={(outlineColor) => setEffects({ outlineColor })} />
        )}
        <Slider
          label="Shadow"
          value={effects.shadow}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(shadow) => setEffects({ shadow })}
        />
        {effects.shadow > 0 && (
          <OverridableColour label="Shadow colour" value={effects.shadowColor} derived={autoShadow} onChange={(shadowColor) => setEffects({ shadowColor })} />
        )}
        <Slider
          label="Glow"
          value={effects.glow}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(glow) => setEffects({ glow })}
        />
        {effects.glow > 0 && (
          <OverridableColour label="Glow colour" value={effects.glowColor} derived={lchHex(palette.accent)} onChange={(glowColor) => setEffects({ glowColor })} />
        )}
        <p className="hint">Outline, shadow and glow keep the title readable at the small size YouTube shows thumbnails.</p>
      </Section>

      {props.filter}

      <p className="hint" style={{ padding: '0 14px 14px' }}>Save the thumbnail from the Export tab.</p>
    </div>
  );
});

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="thumb-meter">
      <span>{label}</span>
      <span className="thumb-meter-track">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="slider-value">{Math.round(value * 100)}%</span>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="segmented case-picker" style={{ display: 'flex' }}>
        {options.map((option) => (
          <button
            key={option.value}
            className={value === option.value ? 'on' : ''}
            style={{ flex: 1 }}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A colour that follows the song until it is set, with a way back. */
function OverridableColour({
  label,
  value,
  derived,
  onChange,
}: {
  label: string;
  value: string | null;
  derived: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="thumb-colour-row">
      <ColorField label={value ? label : `${label} · auto`} value={value ?? derived} onChange={onChange} />
      <button className="mini-btn" title="Back to auto" disabled={!value} onClick={() => onChange(null)}>
        ↺
      </button>
    </div>
  );
}

function toneSwatch(tone: ColourOptions['ground'] | undefined, base: { l: number; c: number; h: number }): string {
  if (tone === 'light') return '#f4f2ee';
  if (tone === 'colour') return lchCss(base);
  return '#121517';
}

const TOOLS: Array<{ id: EditTool; name: string }> = [
  { id: 'select', name: 'Select' },
  { id: 'paint', name: 'Paint' },
];

/** Tools for painting, stamping and arranging on the picture. */
function EditSection(props: Props) {
  const { tools, onTools, design } = props;
  const set = (patch: Partial<ToolSettings>) => onTools({ ...tools, ...patch });
  const palette = design.palette;
  const swatches = [
    lchHex(palette.base),
    lchHex(palette.accent),
    lchHex(palette.third),
    ...(props.options.colour.gradient ?? []),
    '#ffffff',
    '#0a0a0a',
  ].filter((hex, i, all) => all.indexOf(hex) === i);

  return (
    <Section
      title="Edit"
      action={
        <span className="field-row" style={{ gap: 4 }}>
          <button className="mini-btn wide" disabled={!props.history.undo} onClick={props.onUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="mini-btn wide" disabled={!props.history.redo} onClick={props.onRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </span>
      }
    >
      <div className="segmented thumb-tools">
        {TOOLS.map((tool) => (
          <button key={tool.id} className={tools.tool === tool.id ? 'on' : ''} onClick={() => set({ tool: tool.id })}>
            {tool.name}
          </button>
        ))}
      </div>
      {tools.tool === 'paint' && (
        <>
          <div className="field-wide">
            <label>Brushes · drag to paint</label>
            <div className="brush-grid">
              {BRUSHES.map((brush) => (
                <button
                  key={brush.id}
                  className={`brush-btn${tools.brush === brush.id ? ' on' : ''}`}
                  title={brush.name}
                  onClick={() => set({ brush: brush.id })}
                >
                  <BrushIcon id={brush.id} />
                  <span>{brush.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field-wide">
            <label>Shapes · click to place</label>
            <div className="brush-grid">
              {STAMPS.map((stamp) => (
                <button
                  key={stamp.id}
                  className={`brush-btn${tools.brush === stamp.id ? ' on' : ''}`}
                  title={stamp.name}
                  onClick={() => set({ brush: stamp.id })}
                >
                  <BrushIcon id={stamp.id} />
                  <span>{stamp.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field-wide">
            <label>Texture</label>
            <div className="brush-grid">
              {TEXTURES.map((texture) => (
                <button
                  key={texture.id}
                  className={`brush-btn${tools.texture === texture.id ? ' on' : ''}`}
                  title={texture.name}
                  onClick={() => set({ texture: texture.id })}
                >
                  <TextureIcon id={texture.id} />
                  <span>{texture.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {tools.tool !== 'select' && (
        <>
          <div className="field">
            <label>Colour</label>
            <div className="thumb-swatches">
              {swatches.map((hex) => (
                <button
                  key={hex}
                  className={`thumb-swatch${tools.color.toLowerCase() === hex.toLowerCase() ? ' on' : ''}`}
                  style={{ background: hex }}
                  title={hex}
                  onClick={() => set({ color: hex })}
                />
              ))}
              <span className="swatch thumb-swatch-custom" style={{ background: tools.color }}>
                <input type="color" value={tools.color} aria-label="Custom colour" onChange={(event) => set({ color: event.target.value })} />
              </span>
            </div>
          </div>
          <Slider
            label="Size"
            min={0.004}
            max={0.15}
            step={0.002}
            value={tools.size}
            format={(value) => `${Math.round(value * 1000) / 10}%`}
            onChange={(size) => set({ size })}
          />
          {tools.tool === 'paint' && !isStampBrush(tools.brush) && (
            <Slider
              label="Opacity"
              min={0.05}
              max={1}
              step={0.05}
              value={tools.opacity}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(opacity) => set({ opacity })}
            />
          )}
        </>
      )}
    </Section>
  );
}

/** Every layer, top first: select, hide, reorder, delete or reset. */
function LayersSection(props: Props) {
  const { edits, onEdits, selectedId, onSelect } = props;
  const list = [...edits.elements].reverse();
  const update = (id: string, patch: (element: ThumbElement) => ThumbElement | null, mergeKey?: string) =>
    onEdits(
      { elements: edits.elements.map((e) => (e.id === id ? patch(e) : e)).filter((e): e is ThumbElement => e !== null) },
      true,
      mergeKey,
    );
  const move = (id: string, direction: 1 | -1) => {
    const index = edits.elements.findIndex((e) => e.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= edits.elements.length) return;
    const next = [...edits.elements];
    [next[index], next[target]] = [next[target], next[index]];
    onEdits({ elements: next }, true);
  };
  const selected = edits.elements.find((e) => e.id === selectedId);
  const changed = (e: ThumbElement) => !e.visible || e.t.x !== 0 || e.t.y !== 0 || e.t.scale !== 1;

  return (
    <Section title="Layers">
      <div className="thumb-layers">
        {list.map((element) => (
          <div key={element.id} className={`thumb-layer${element.id === selectedId ? ' on' : ''}${element.visible ? '' : ' hidden'}`}>
            <button className="thumb-layer-name" onClick={() => onSelect(element.id)}>
              {element.name}
            </button>
            <button
              className={`mini-btn${element.visible ? ' on' : ''}`}
              title={element.visible ? 'Hide' : 'Show'}
              onClick={() => update(element.id, (e) => ({ ...e, visible: !e.visible }))}
            >
              ●
            </button>
            <button className="mini-btn" title="Bring forward" onClick={() => move(element.id, 1)}>
              ▲
            </button>
            <button className="mini-btn" title="Send back" onClick={() => move(element.id, -1)}>
              ▼
            </button>
            {element.kind === 'paint' || element.kind === 'stamp' ? (
              <button className="mini-btn" title="Delete" onClick={() => update(element.id, () => null)}>
                ✕
              </button>
            ) : (
              <button
                className="mini-btn"
                title="Back to where the design put it"
                disabled={!changed(element)}
                onClick={() => update(element.id, (e) => ({ ...e, visible: true, t: { x: 0, y: 0, scale: 1 } }))}
              >
                ↺
              </button>
            )}
          </div>
        ))}
      </div>
      {selected?.kind === 'stamp' && selected.stamp && (
        <>
          <div className="field">
            <label>Stamp colour</label>
            <span className="swatch thumb-swatch-custom" style={{ background: selected.stamp.color }}>
              <input
                type="color"
                value={selected.stamp.color}
                aria-label="Stamp colour"
                onChange={(event) =>
                  update(selected.id, (e) => ({ ...e, stamp: { ...e.stamp!, color: event.target.value } }), `colour:${selected.id}`)
                }
              />
            </span>
          </div>
          <Slider
            label="Rotation"
            min={-3.14}
            max={3.14}
            step={0.02}
            value={selected.stamp.rotation}
            format={(value) => `${Math.round((value * 180) / Math.PI)}°`}
            onChange={(rotation) => update(selected.id, (e) => ({ ...e, stamp: { ...e.stamp!, rotation } }), `rotate:${selected.id}`)}
          />
          <Select<TextureId>
            label="Texture"
            value={selected.stamp.texture ?? 'none'}
            options={TEXTURES.map((texture) => ({ value: texture.id, label: texture.name }))}
            onChange={(texture) => update(selected.id, (e) => ({ ...e, stamp: { ...e.stamp!, texture } }))}
          />
          <button
            className="btn"
            onClick={() => update(selected.id, (e) => ({ ...e, stamp: { ...e.stamp!, seed: Math.floor(Math.random() * 1e9) } }))}
          >
            New shape
          </button>
        </>
      )}
    </Section>
  );
}

function isLightHex(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 140;
}
