import type { FollowMode } from '../models/RenderSettings';
import { clamp } from '../utils/math';

export interface FollowInput {
  mode: FollowMode;
  /** Fraction of the visible span the playhead is pinned at in continuous mode. */
  anchor: number;
  /** Playhead position, in the layout's time domain. */
  unit: number;
  /** Domain units visible across the content area. */
  span: number;
  /** Song length in the same domain. */
  duration: number;
  /** Current left edge of the view. */
  scroll: number;
}

/**
 * Where the view's left edge should be so the playhead is framed the way the
 * follow mode intends. Shared by playback (every frame) and by seeking, so a
 * jump lands on exactly the framing that playing to that point would have.
 *
 * "off" keeps the view still while it holds the playhead, and otherwise
 * frames it like continuous mode — a seek should never leave the playhead
 * somewhere you cannot see it.
 */
export function followScroll({ mode, anchor, unit, span, duration, scroll }: FollowInput): number {
  if (span <= 0) return scroll;
  // The whole song already fits; nothing to move.
  if (span >= duration) return 0;

  const left = scroll;
  const right = left + span;

  if (mode === 'page') {
    if (unit >= left && unit <= right - span * 0.02) return left;
    // Not capped at the song's end: a recording's tail plays on past the last
    // note, and the next page has to come up to keep the playhead in view.
    return Math.max(unit - span * 0.06, 0);
  }

  if (mode === 'off' && unit >= left && unit <= right) return left;

  // Continuous: the playhead stays pinned at the anchor and the music moves
  // under it. No clamp at the end — stopping the camera there would send the
  // playhead walking to the right edge during the final bars.
  return Math.max(unit - span * clamp(anchor, 0, 0.95), 0);
}
