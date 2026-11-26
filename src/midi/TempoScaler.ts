import type { MidiProject } from '../models/MidiProject';
import { TimeMapper } from './TimeMapper';

/**
 * Re-times a project without touching a single note's musical content.
 *
 * Ticks and beats are the source of truth and stay exactly as parsed; only the
 * seconds derived from them change. That means the arrangement looks identical
 * in the bars/beats view while playback, the seconds axis and any video export
 * all run at the new tempo — which is what "change the tempo" should mean.
 */
export function applyTempoScale(project: MidiProject, scale: number): MidiProject {
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 1e-6) return project;
  const factor = Math.max(scale, 0.01);

  // Rebuild the tempo map at the new rate, re-accumulating elapsed seconds.
  const tempos = project.tempos.map((tempo) => ({ ...tempo, bpm: tempo.bpm * factor }));
  for (let i = 1; i < tempos.length; i++) {
    const previous = tempos[i - 1];
    tempos[i].seconds = previous.seconds + ((tempos[i].beats - previous.beats) * 60) / previous.bpm;
  }

  const mapper = new TimeMapper(project.ppq, tempos, project.timeSignatures);
  const at = (beats: number) => mapper.beatsToSeconds(beats);

  return {
    ...project,
    tempos,
    timeSignatures: project.timeSignatures.map((sig) => ({ ...sig, seconds: at(sig.beats) })),
    markers: project.markers.map((marker) => ({ ...marker, seconds: at(marker.beats) })),
    bars: project.bars.map((bar) => ({ ...bar, seconds: at(bar.beats) })),
    durationSeconds: at(project.durationBeats),
    tracks: project.tracks.map((track) => {
      let maxDurationSeconds = 0;
      const notes = track.notes.map((note) => {
        const startSeconds = at(note.startBeats);
        const durationSeconds = Math.max(at(note.startBeats + note.durationBeats) - startSeconds, 1e-4);
        if (durationSeconds > maxDurationSeconds) maxDurationSeconds = durationSeconds;
        // Note ids are preserved so a selection survives a tempo change.
        return { ...note, startSeconds, durationSeconds };
      });

      return {
        ...track,
        notes,
        maxDurationSeconds,
        regions: track.regions.map((region) => ({
          ...region,
          startSeconds: at(region.startBeats),
          endSeconds: at(region.endBeats),
        })),
      };
    }),
  };
}

/** The tempo in effect at the start of the song, which the UI edits. */
export function baseTempo(project: MidiProject): number {
  return project.tempos[0]?.bpm ?? 120;
}
