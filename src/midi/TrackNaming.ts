import type { MidiProject } from '../models/MidiProject';

/**
 * Which name a track shows.
 *
 *  - instrument: the instrument the file specifies ("Cello", "Analog Drums"),
 *    numbered when repeated. The default.
 *  - file: the track's own name in the file ("Piano Right"), for files whose
 *    authors named their parts. Tracks without one keep the instrument.
 *
 * A name typed in the Tracks tab overrides either.
 */
export type TrackNaming = 'instrument' | 'file';

export function applyTrackNaming(project: MidiProject, naming: TrackNaming): MidiProject {
  if (naming === 'instrument') return project;
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.rawName && track.rawName !== track.name ? { ...track, name: track.rawName } : track,
    ),
  };
}

/** Whether switching to file names would change anything for this project. */
export function hasDistinctFileNames(project: MidiProject): boolean {
  return project.tracks.some((track) => track.rawName && track.rawName !== track.instrumentLabel);
}
