import type { MidiProject } from '../models/MidiProject';
import { TimeMapper } from './TimeMapper';

export interface ProjectStats {
  trackCount: number;
  noteCount: number;
  /** "72" or "68–142" when the file has tempo changes. */
  tempoLabel: string;
  timeSignatureLabel: string;
  durationSeconds: number;
  barCount: number;
  markerCount: number;
  pitchLabel: string;
}

export function analyzeProject(project: MidiProject): ProjectStats {
  const bpms = project.tempos.map((tempo) => tempo.bpm);
  const min = Math.round(Math.min(...bpms));
  const max = Math.round(Math.max(...bpms));

  const sigs = project.timeSignatures.map((sig) => `${sig.numerator}/${sig.denominator}`);
  const uniqueSigs = [...new Set(sigs)];

  const lastBar = project.bars.length ? project.bars[project.bars.length - 1].bar : 0;

  return {
    trackCount: project.tracks.length,
    noteCount: project.totalNotes,
    tempoLabel: min === max ? `${min}` : `${min}–${max}`,
    timeSignatureLabel: uniqueSigs.slice(0, 3).join(', ') + (uniqueSigs.length > 3 ? '…' : ''),
    durationSeconds: project.durationSeconds,
    barCount: lastBar,
    markerCount: project.markers.length,
    pitchLabel: `${project.minPitch}–${project.maxPitch}`,
  };
}

/**
 * Musical position of a beat offset, honouring time-signature changes. Walks
 * back to the governing signature rather than assuming 4/4 throughout.
 */
export function beatsToBarBeat(
  project: MidiProject,
  beats: number,
): { bar: number; beat: number; beatInBar: number } {
  const sigs = project.timeSignatures;
  let sig = sigs[0];
  for (const candidate of sigs) {
    if (candidate.beats <= beats + 1e-9) sig = candidate;
    else break;
  }
  if (!sig) return { bar: 1, beat: 1, beatInBar: 0 };

  const beatsPerBar = TimeMapper.beatsPerBar(sig);
  const beatsPerPulse = TimeMapper.beatsPerPulse(sig);
  const offset = Math.max(beats - sig.beats, 0);
  const barsIn = Math.floor(offset / beatsPerBar);
  const withinBar = offset - barsIn * beatsPerBar;
  const beatInBar = withinBar / beatsPerPulse;

  return {
    bar: sig.barStart + barsIn,
    beat: Math.floor(beatInBar) + 1,
    beatInBar,
  };
}

/** Fraction of the song each track is actually playing, for the status bar. */
export function trackCoverage(project: MidiProject, trackId: string): number {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track || !track.regions.length || project.durationBeats <= 0) return 0;
  const covered = track.regions.reduce((sum, region) => sum + (region.endBeats - region.startBeats), 0);
  return covered / project.durationBeats;
}
