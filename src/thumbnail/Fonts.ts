/**
 * Title typefaces. The web fonts come from Google Fonts (linked in
 * index.html); each stack ends in system fonts, so the title still draws if
 * the browser is offline.
 */

export type FontId = 'clean' | 'grotesk' | 'wide' | 'heavy' | 'condensed' | 'serif' | 'mono' | 'marker' | 'pixel';

export interface TitleFont {
  id: FontId;
  name: string;
  /** The web font family, or null for system fonts only. */
  family: string | null;
  stack: string;
  weight: number;
  subWeight: number;
  /** Letter spacing as a share of the size, for mixed case and for capitals. */
  tracking: { mixed: number; upper: number };
  /** Starting size relative to the default; narrow faces can go bigger. */
  scale: number;
}

const SYSTEM = '"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, -apple-system, sans-serif';

export const TITLE_FONTS: TitleFont[] = [
  { id: 'clean', name: 'Clean', family: null, stack: SYSTEM, weight: 700, subWeight: 600, tracking: { mixed: -0.012, upper: 0.045 }, scale: 1 },
  { id: 'grotesk', name: 'Grotesk', family: 'Space Grotesk', stack: `"Space Grotesk", ${SYSTEM}`, weight: 700, subWeight: 600, tracking: { mixed: -0.02, upper: 0.03 }, scale: 1 },
  { id: 'wide', name: 'Wide', family: 'Syne', stack: `"Syne", ${SYSTEM}`, weight: 800, subWeight: 700, tracking: { mixed: -0.01, upper: 0.02 }, scale: 1 },
  { id: 'heavy', name: 'Heavy', family: 'Archivo Black', stack: `"Archivo Black", ${SYSTEM}`, weight: 400, subWeight: 400, tracking: { mixed: -0.015, upper: 0.02 }, scale: 1 },
  { id: 'condensed', name: 'Tall', family: 'Bebas Neue', stack: `"Bebas Neue", ${SYSTEM}`, weight: 400, subWeight: 400, tracking: { mixed: 0.02, upper: 0.04 }, scale: 1.3 },
  { id: 'serif', name: 'Serif', family: 'Playfair Display', stack: `"Playfair Display", Georgia, serif`, weight: 700, subWeight: 700, tracking: { mixed: -0.01, upper: 0.04 }, scale: 1.05 },
  { id: 'mono', name: 'Mono', family: 'Space Mono', stack: `"Space Mono", Consolas, monospace`, weight: 700, subWeight: 700, tracking: { mixed: -0.02, upper: 0 }, scale: 0.9 },
  { id: 'marker', name: 'Marker', family: 'Permanent Marker', stack: `"Permanent Marker", "Comic Sans MS", cursive`, weight: 400, subWeight: 400, tracking: { mixed: 0, upper: 0.02 }, scale: 1 },
  { id: 'pixel', name: 'Pixel', family: 'Silkscreen', stack: `"Silkscreen", Consolas, monospace`, weight: 400, subWeight: 400, tracking: { mixed: 0, upper: 0 }, scale: 0.85 },
];

export function titleFont(id: FontId | undefined): TitleFont {
  return TITLE_FONTS.find((font) => font.id === id) ?? TITLE_FONTS[0];
}

const ready = new Set<FontId>(['clean']);

export function fontReady(id: FontId): boolean {
  return ready.has(id);
}

/**
 * Waits for a title font to load (or up to three seconds, offline), so the
 * canvas never caches a title drawn in the fallback face.
 */
export async function ensureFont(id: FontId): Promise<void> {
  if (ready.has(id) || typeof document === 'undefined' || !document.fonts) return;
  const font = titleFont(id);
  if (!font.family) return;
  const load = Promise.all([
    document.fonts.load(`${font.weight} 64px "${font.family}"`),
    document.fonts.load(`${font.subWeight} 24px "${font.family}"`),
  ]).catch(() => undefined);
  await Promise.race([load, new Promise((resolve) => setTimeout(resolve, 3000))]);
  ready.add(id);
}
