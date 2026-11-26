import type { MidiProject, TrackState, VisualTrack } from '../models/MidiProject';
import type { RenderSettings } from '../models/RenderSettings';
import { buildNoteColorTable, type NoteColorTable } from '../layout/ColorResolver';

/**
 * Colour lookup tables are rebuilt only when something that affects them
 * changes. Without this, every frame would recompute 24 colour mixes per track,
 * which is pure waste at 60fps.
 */
export class RenderCache {
  private signature = '';
  private tables = new Map<string, NoteColorTable>();

  /** Call once per frame before requesting any table. */
  sync(settings: RenderSettings, project: MidiProject): void {
    const theme = settings.theme;
    const next = [
      settings.noteColorMode,
      settings.velocityBrightness.toFixed(3),
      settings.pitchMode,
      settings.instrumentPaletteId,
      theme.note,
      theme.noteActive,
      theme.noteGlow,
      theme.background,
      // Palette entries can be edited individually, so hash their values too.
      Object.values(settings.instrumentColors).join(''),
      project.tracks.length,
    ].join('|');

    if (next !== this.signature) {
      this.signature = next;
      this.tables.clear();
    }
  }

  table(
    track: VisualTrack,
    state: TrackState,
    settings: RenderSettings,
    project: MidiProject,
  ): NoteColorTable {
    const key = `${track.id}:${state.color ?? ''}`;
    let table = this.tables.get(key);
    if (!table) {
      table = buildNoteColorTable(track, state, settings, project);
      this.tables.set(key, table);
    }
    return table;
  }

  clear(): void {
    this.signature = '';
    this.tables.clear();
  }
}
