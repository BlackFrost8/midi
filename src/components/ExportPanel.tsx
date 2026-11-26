import { memo, useMemo } from 'react';
import type { Timeline } from '../playback/Timeline';
import { EXPORT_PRESETS, type ExportSettings } from '../models/RenderSettings';
import type { MidiProject } from '../models/MidiProject';
import { formatSeconds } from '../utils/formatting';
import { ffmpegCommand, supportedVideoMimeType, supportsFrameSequence } from '../export/VideoExporter';
import { evenDimensions, supportsMp4 } from '../export/Mp4Exporter';
import { SVG_NOTE_WARNING_THRESHOLD } from '../export/SvgExporter';
import { Field, Section, Toggle } from './controls';
import type { ThumbnailExportSize } from './ThumbnailPanel';

interface Props {
  project: MidiProject;
  /** True when a recording is loaded, so it can be offered as the sound track. */
  hasAudio: boolean;
  /** The session span: the MIDI, plus a recording's intro and tail. The default range. */
  timeline: Timeline;
  exportSettings: ExportSettings;
  onExportSettings: (patch: Partial<ExportSettings>) => void;
  busy: boolean;
  onExportPng: () => void;
  onExportSvg: () => void;
  onExportVideo: () => void;
  onExportMp4: () => void;
  onExportFrames: () => void;
  /** Saves the thumbnail from the Thumbnail tab; absent until it is ready. */
  onExportThumbnail?: (size: ThumbnailExportSize) => void;
  onCancel: () => void;
}

export const ExportPanel = memo(function ExportPanel(props: Props) {
  const { exportSettings: settings, onExportSettings, project } = props;

  const videoSupported = useMemo(() => supportedVideoMimeType() !== null, []);
  const framesSupported = useMemo(() => supportsFrameSequence(), []);
  const mp4Supported = useMemo(() => supportsMp4(), []);
  const evenSize = evenDimensions(settings.width, settings.height);
  const oddSize = evenSize.width !== settings.width || evenSize.height !== settings.height;

  const rangeStart = settings.rangeStart ?? props.timeline.start;
  const rangeEnd = settings.rangeEnd ?? props.timeline.end;
  const rangeDuration = Math.max(rangeEnd - rangeStart, 0);
  const frameCount = Math.ceil(rangeDuration * settings.fps);
  const digits = String(Math.max(frameCount, 1)).length + 1;
  const estimatedMb = (rangeDuration * settings.bitrateMbps) / 8;

  const activePreset = EXPORT_PRESETS.find(
    (preset) => preset.width === settings.width && preset.height === settings.height,
  );

  return (
    <div className="panel">
      <Section title="Resolution">
        <div className="preset-grid">
          {EXPORT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={`preset${activePreset?.label === preset.label ? ' active' : ''}`}
              onClick={() => onExportSettings({ width: preset.width, height: preset.height })}
            >
              <span className="preset-name">{preset.label}</span>
              <span className="track-name-sub">
                {preset.width} × {preset.height}
              </span>
            </button>
          ))}
        </div>
        <div className="field-row" style={{ marginTop: 10, gap: 6 }}>
          <input
            className="number-input"
            type="number"
            min={16}
            max={16384}
            value={settings.width}
            onChange={(event) => onExportSettings({ width: Math.round(Number(event.target.value)) })}
          />
          <span style={{ color: 'var(--ui-text-faint)' }}>×</span>
          <input
            className="number-input"
            type="number"
            min={16}
            max={16384}
            value={settings.height}
            onChange={(event) => onExportSettings({ height: Math.round(Number(event.target.value)) })}
          />
        </div>
      </Section>

      <Section title="Framing">
        <div className="segmented" style={{ display: 'flex', marginBottom: 8 }}>
          <button
            className={settings.fitWholeArrangement ? '' : 'on'}
            style={{ flex: 1 }}
            onClick={() => onExportSettings({ fitWholeArrangement: false })}
          >
            Match the view
          </button>
          <button
            className={settings.fitWholeArrangement ? 'on' : ''}
            style={{ flex: 1 }}
            onClick={() => onExportSettings({ fitWholeArrangement: true })}
          >
            Whole song
          </button>
        </div>
        <Toggle
          label="Opaque background"
          checked={settings.opaqueBackground}
          onChange={(opaqueBackground) => onExportSettings({ opaqueBackground })}
        />
      </Section>

      <Section title="Still image">
        <div className="field-row" style={{ gap: 6 }}>
          <button className="btn primary" disabled={props.busy} onClick={props.onExportPng}>
            Export PNG
          </button>
          <button className="btn" disabled={props.busy} onClick={props.onExportSvg}>
            Export SVG
          </button>
        </div>
        {project.totalNotes > SVG_NOTE_WARNING_THRESHOLD && (
          <p className="hint">{project.totalNotes.toLocaleString()} notes — the SVG will be very large.</p>
        )}
      </Section>

      <Section title="Video">
        <Field label="Frame rate">
          <select
            className="select"
            value={settings.fps}
            onChange={(event) => onExportSettings({ fps: Number(event.target.value) })}
          >
            {[24, 25, 30, 50, 60].map((fps) => (
              <option key={fps} value={fps}>
                {fps} fps
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bitrate">
          <select
            className="select"
            value={settings.bitrateMbps}
            onChange={(event) => onExportSettings({ bitrateMbps: Number(event.target.value) })}
          >
            {[8, 16, 24, 40, 60, 90].map((rate) => (
              <option key={rate} value={rate}>
                {rate} Mbps
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            className="number-input"
            type="number"
            min={0}
            step={0.5}
            value={Number(rangeStart.toFixed(2))}
            onChange={(event) =>
              onExportSettings({ rangeStart: Math.max(props.timeline.start, Number(event.target.value)) })
            }
          />
        </Field>
        <Field label="To">
          <input
            className="number-input"
            type="number"
            min={0}
            step={0.5}
            value={Number(rangeEnd.toFixed(2))}
            onChange={(event) => onExportSettings({ rangeEnd: Number(event.target.value) })}
          />
        </Field>
        <div className="field-row" style={{ gap: 6, marginBottom: 8 }}>
          <button
            className="btn"
            onClick={() => onExportSettings({ rangeStart: null, rangeEnd: null })}
          >
            Whole song
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {formatSeconds(rangeDuration)} · {frameCount.toLocaleString()} frames · ~{estimatedMb.toFixed(0)} MB
          </span>
        </div>

        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            disabled={props.busy || !mp4Supported}
            onClick={props.onExportMp4}
          >
            Export MP4
          </button>
          <button
            className="btn"
            disabled={props.busy || !videoSupported}
            onClick={props.onExportVideo}
          >
            WebM
          </button>
          <button
            className="btn"
            disabled={props.busy || !framesSupported}
            onClick={props.onExportFrames}
          >
            PNG frames
          </button>
        </div>

        {props.hasAudio && (
          <Toggle
            label="Include audio (MP4)"
            checked={settings.includeAudio}
            onChange={(includeAudio) => onExportSettings({ includeAudio })}
          />
        )}

        {oddSize && (
          <p className="hint">MP4 will encode at {evenSize.width} × {evenSize.height}.</p>
        )}
        {(!mp4Supported || !videoSupported || !framesSupported) && (
          <p className="hint">
            Not available in this browser:{' '}
            {[!mp4Supported && 'MP4', !videoSupported && 'WebM', !framesSupported && 'PNG frames']
              .filter(Boolean)
              .join(', ')}
            .
          </p>
        )}
        <p className="hint" style={{ userSelect: 'text' }}>
          <code>{ffmpegCommand('frame', settings.fps, digits)}</code>
        </p>
      </Section>

      <Section title="Thumbnail">
        {props.onExportThumbnail ? (
          <>
            <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn primary" disabled={props.busy} onClick={() => props.onExportThumbnail?.('youtube')}>
                YouTube 1280×720
              </button>
              <button className="btn" disabled={props.busy} onClick={() => props.onExportThumbnail?.('hd')}>
                1920×1080
              </button>
              <button className="btn" disabled={props.busy} onClick={() => props.onExportThumbnail?.('uhd')}>
                4K
              </button>
              <button className="btn" disabled={props.busy} onClick={() => props.onExportThumbnail?.('square')}>
                1000×1000
              </button>
            </div>
            <p className="hint">The design from the Thumbnail tab, with your edits and filter. YouTube size stays under the 2 MB limit. 1000×1000 lays the design out again for a square (cover art, socials).</p>
          </>
        ) : (
          <p className="hint">The thumbnail is still being prepared.</p>
        )}
      </Section>

      {props.busy && (
        <Section title="Running">
          <button className="btn danger" onClick={props.onCancel}>
            Cancel export
          </button>
        </Section>
      )}
    </div>
  );
});
