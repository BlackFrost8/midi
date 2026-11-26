export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Maps `value` from [inMin, inMax] onto [outMin, outMax] without clamping. */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return (outMin + outMax) / 2;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Index of the first element whose key is >= target, or list.length if none.
 * Used for viewport culling: the note array is sorted by start time, so this
 * finds the first candidate in O(log n) instead of scanning every note.
 */
export function lowerBound<T>(list: T[], target: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Rounds to a device pixel boundary so 1px lines stay crisp. */
export function crisp(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
