import { clipHeaderColor, clipLabel } from '../renderer/ClipRenderer';
import { barDomainValue, calculateGridStride } from '../renderer/GridRenderer';
import { FONT_STACK, type Scene } from '../renderer/Scene';
import { buildNoteColorTable, type NoteColorTable } from '../layout/ColorResolver';
import type { TrackState, VisualTrack } from '../models/MidiProject';
import { noteDuration, noteStart, unitToX } from '../layout/LayoutEngine';
import { laneNoteY } from '../layout/PitchMapper';
import { familyLabel } from '../midi/InstrumentClassifier';
import { readableTextOn, withAlpha } from '../utils/colors';
import { buildExportScene, type ExportSceneInput } from './SceneBuilder';

/** Above this, the SVG becomes unwieldy for most editors. */
export const SVG_NOTE_WARNING_THRESHOLD = 60_000;

function n(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * True vector export of the same arrangement.
 *
 * Raster-only effects (background wash, vignette, note bloom) are intentionally
 * omitted — they would bloat the file with filters and are better re-applied in
 * a vector editor. Geometry, colour and typography all match the PNG.
 */
export function renderSvg(input: ExportSceneInput & { opaqueBackground: boolean }): string {
  const scene = buildExportScene(input);
  const { project, settings, layout, viewport } = scene;
  const theme = settings.theme;
  const { width, height } = input;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(
      FONT_STACK,
    )}">`,
  );
  parts.push(`<title>${esc(project.title)}</title>`);

  if (input.opaqueBackground) {
    parts.push(`<rect width="${width}" height="${height}" fill="${theme.background}"/>`);
  }

  // ---- Grid ----
  if (settings.showGrid && project.bars.length) {
    const stride = calculateGridStride(scene);
    const bars: string[] = [];
    const beats: string[] = [];
    for (const bar of project.bars) {
      const unit = barDomainValue(bar, layout.domain);
      const x = unitToX(unit, layout, viewport);
      if (x < layout.contentX - 1 || x > layout.contentX + layout.contentWidth + 1) continue;
      if (bar.isDownbeat) {
        if ((bar.bar - 1) % stride.barStride !== 0) continue;
        bars.push(`M${n(x)} ${n(layout.gridTop)}V${n(layout.gridBottom)}`);
      } else if (stride.showBeats) {
        beats.push(`M${n(x)} ${n(layout.gridTop)}V${n(layout.gridBottom)}`);
      }
    }
    if (beats.length) {
      parts.push(
        `<path d="${beats.join('')}" stroke="${withAlpha(theme.gridBeat, settings.gridBeatOpacity)}" stroke-width="1" fill="none"/>`,
      );
    }
    if (bars.length) {
      parts.push(
        `<path d="${bars.join('')}" stroke="${withAlpha(theme.gridBar, settings.gridBarOpacity)}" stroke-width="1" fill="none"/>`,
      );
    }
  }

  // ---- Lane separators ----
  if (settings.showSeparators) {
    const left = settings.showTrackPanel ? layout.panelX : layout.contentX;
    const right = layout.contentX + layout.contentWidth;
    const path = layout.lanes.map((lane) => `M${n(left)} ${n(lane.top)}H${n(right)}`).join('');
    if (path) {
      parts.push(
        `<path d="${path}" stroke="${withAlpha(theme.trackSeparator, settings.separatorOpacity)}" stroke-width="1" fill="none"/>`,
      );
    }
  }

  // ---- Marker lines (before clips, so they pass behind clip headers) ----
  if (settings.showMarkers && project.markers.length) {
    for (const marker of project.markers) {
      const unit = layout.domain === 'beats' ? marker.beats : marker.seconds;
      const x = unitToX(unit, layout, viewport);
      if (x < layout.contentX || x > layout.contentX + layout.contentWidth) continue;
      parts.push(
        `<path d="M${n(x)} ${n(layout.gridTop)}V${n(layout.gridBottom)}" stroke="${withAlpha(theme.sectionLine, 0.55)}" stroke-width="1"/>`,
      );
    }
  }

  // ---- Clips ----
  if (settings.showClips) {
    for (const lane of layout.lanes) {
      const headerColor = clipHeaderColor(scene, lane);
      const textColor =
        headerColor === theme.clipHeader ? theme.clipHeaderText : readableTextOn(headerColor);
      const bodyTop = lane.top + lane.headerHeight;
      const bodyHeight = Math.max(lane.height - lane.headerHeight - 1, 1);

      for (const region of lane.track.regions) {
        const from = layout.domain === 'beats' ? region.startBeats : region.startSeconds;
        const to = layout.domain === 'beats' ? region.endBeats : region.endSeconds;
        const x = unitToX(from, layout, viewport);
        const w = Math.max((to - from) * viewport.pxPerUnit, 2);

        parts.push(
          `<rect x="${n(x)}" y="${n(bodyTop)}" width="${n(w)}" height="${n(bodyHeight)}" rx="2" fill="${withAlpha(theme.clipBody, 0.85)}" stroke="${withAlpha(theme.clipBorder, 0.9)}" stroke-width="1"/>`,
        );
        if (lane.headerHeight > 1) {
          parts.push(
            `<rect x="${n(x)}" y="${n(lane.top)}" width="${n(w)}" height="${n(lane.headerHeight)}" rx="2" fill="${headerColor}"/>`,
          );
          if (settings.showClipNames && lane.headerHeight >= 9 * layout.scale && w > 40) {
            // Matches the canvas: label pinned to the visible edge of the clip.
            const labelX = Math.max(x, layout.contentX) + 5 * layout.scale;
            parts.push(
              `<text x="${n(labelX)}" y="${n(lane.top + lane.headerHeight * 0.72)}" font-size="${n(Math.min(9.5 * layout.scale, lane.headerHeight * 0.66))}" font-weight="600" fill="${textColor}">${esc(clipLabel(lane, region))}</text>`,
            );
          }
        }
      }
    }
  }

  // ---- Notes, grouped by colour so the file stays compact ----
  const radius = settings.noteRadius * layout.scale;
  for (const lane of layout.lanes) {
    if (!lane.track.noteCount) continue;
    const table = buildTableForSvg(scene, lane.track, lane.state);
    const byColor = new Map<string, string[]>();

    for (const note of lane.track.notes) {
      const s = noteStart(note, layout.domain);
      const d = noteDuration(note, layout.domain);
      const x = unitToX(s, layout, viewport);
      const w = Math.max(d * viewport.pxPerUnit, settings.noteMinWidth * layout.scale);
      if (x + w < layout.contentX || x > layout.contentX + layout.contentWidth) continue;
      const y = laneNoteY(note.pitch, lane, layout.noteHeight);
      const color = table.colors[table.bucket(note)];
      const list = byColor.get(color) ?? [];
      list.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(layout.noteHeight)}"${radius > 0.35 ? ` rx="${n(radius)}"` : ''}/>`,
      );
      byColor.set(color, list);
    }

    const opacity = settings.noteOpacity * (lane.state.muted ? 0.28 : lane.dimmed ? 0.35 : 1);
    for (const [color, rects] of byColor) {
      parts.push(`<g fill="${color}" opacity="${n(opacity)}">${rects.join('')}</g>`);
    }
  }

  // ---- Track panel ----
  if (settings.showTrackPanel && layout.panelWidth > 0) {
    const panelTop = layout.rulerTop;
    const panelHeight = Math.max(layout.gridBottom - panelTop, layout.rulerHeight);
    parts.push(
      `<rect x="${n(layout.panelX)}" y="${n(panelTop)}" width="${n(layout.panelWidth)}" height="${n(panelHeight)}" fill="${theme.panel}"/>`,
    );
    parts.push(
      `<path d="M${n(layout.contentX)} ${n(panelTop)}V${n(panelTop + panelHeight)}" stroke="${withAlpha(theme.panelBorder, 0.9)}" stroke-width="1"/>`,
    );

    for (const lane of layout.lanes) {
      const cy = lane.top + lane.height / 2;
      const textX = layout.panelX + 18 * layout.scale;
      const name = (lane.state.label ?? lane.track.name).toUpperCase();
      const sub = [
        familyLabel(lane.track.family) === 'Unknown' ? '' : familyLabel(lane.track.family),
        lane.track.channel != null ? `Ch ${lane.track.channel + 1}` : '',
      ]
        .filter(Boolean)
        .join('  ·  ');
      const showSub = settings.showTrackSublabels && lane.height >= 34 * layout.scale && sub;

      parts.push(
        `<circle cx="${n(layout.panelX + 5 * layout.scale)}" cy="${n(cy)}" r="${n(Math.min(2.6 * layout.scale, 4))}" fill="${lane.color}"/>`,
      );
      parts.push(
        `<text x="${n(textX)}" y="${n(showSub ? cy - 2.5 * layout.scale : cy + 3.5 * layout.scale)}" font-size="${n(Math.min(11 * layout.scale, lane.height * 0.3))}" font-weight="500" letter-spacing="${n(1.15 * layout.scale)}" fill="${theme.trackText}">${esc(name)}</text>`,
      );
      if (showSub) {
        parts.push(
          `<text x="${n(textX)}" y="${n(cy + 10 * layout.scale)}" font-size="${n(Math.min(8.5 * layout.scale, lane.height * 0.24))}" fill="${theme.trackSubtext}">${esc(sub)}</text>`,
        );
      }
    }
  }

  // ---- Ruler ----
  if (settings.showRuler) {
    parts.push(
      `<rect x="${n(layout.panelX)}" y="${n(layout.rulerTop)}" width="${n(layout.panelWidth + layout.contentWidth)}" height="${n(layout.rulerHeight)}" fill="${theme.rulerBackground}"/>`,
    );
    const stride = calculateGridStride(scene);
    let labelStride = stride.barStride;
    while (stride.barSpacing * labelStride < 62 * layout.scale && labelStride < 4096) labelStride *= 2;

    for (const bar of project.bars) {
      if (!bar.isDownbeat || (bar.bar - 1) % labelStride !== 0) continue;
      const x = unitToX(barDomainValue(bar, layout.domain), layout, viewport);
      if (x < layout.contentX || x > layout.contentX + layout.contentWidth) continue;
      parts.push(
        `<text x="${n(x + 5 * layout.scale)}" y="${n(layout.rulerTop + layout.rulerHeight * 0.68)}" font-size="${n(10 * layout.scale)}" fill="${theme.rulerText}">${bar.bar}</text>`,
      );
    }
  }

  // ---- Marker labels ----
  if (settings.showMarkers && project.markers.length && layout.markerHeight > 0) {
    for (const marker of project.markers) {
      const unit = layout.domain === 'beats' ? marker.beats : marker.seconds;
      const x = unitToX(unit, layout, viewport);
      if (x < layout.contentX || x > layout.contentX + layout.contentWidth) continue;
      parts.push(
        `<path d="M${n(x)} ${n(layout.markerTop + layout.markerHeight * 0.2)}V${n(layout.markerTop + layout.markerHeight)}" stroke="${withAlpha(theme.sectionLine, 0.9)}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${n(x + 6 * layout.scale)}" y="${n(layout.markerTop + layout.markerHeight * 0.72)}" font-size="${n(10 * layout.scale)}" font-weight="600" letter-spacing="${n(1.4 * layout.scale)}" fill="${theme.sectionText}">${esc(marker.text.toUpperCase())}</text>`,
      );
    }
  }

  // ---- Playhead ----
  if (settings.showPlayhead) {
    const x = unitToX(scene.playheadUnit, layout, viewport);
    if (x >= layout.contentX && x <= layout.contentX + layout.contentWidth) {
      parts.push(
        `<rect x="${n(x - (settings.playheadWidth * layout.scale) / 2)}" y="${n(layout.rulerTop)}" width="${n(Math.max(settings.playheadWidth * layout.scale, 1))}" height="${n(layout.gridBottom - layout.rulerTop)}" fill="${theme.playhead}"/>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

/** Same colour resolution as the canvas path, without touching the render cache. */
function buildTableForSvg(
  scene: Scene,
  track: VisualTrack,
  state: TrackState,
): NoteColorTable {
  return buildNoteColorTable(track, state, scene.settings, scene.project);
}
