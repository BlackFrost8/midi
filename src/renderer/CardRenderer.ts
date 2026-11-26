import type { MidiProject } from '../models/MidiProject';
import { withAlpha } from '../utils/colors';
import type { IntroSource, Scene } from './Scene';
import type { IntroScene } from '../thumbnail/IntroScene';
import { drawSimple, replayElement } from '../thumbnail/VectorRecorder';
import { FONT_STACK, setLetterSpacing } from './Scene';

/**
 * The intro title card and the end card, drawn over the finished frame. Both
 * are worked out from the playhead time alone, so the preview and every export
 * show them identically.
 */

const musicEnds = new WeakMap<MidiProject, number>();

/** When the last note stops sounding. */
export function musicEnd(project: MidiProject): number {
  let end = musicEnds.get(project);
  if (end === undefined) {
    end = 0;
    for (const track of project.tracks) for (const note of track.notes) end = Math.max(end, note.startSeconds + note.durationSeconds);
    if (end <= 0) end = project.durationSeconds;
    musicEnds.set(project, end);
  }
  return end;
}

/** How long the video runs past the music for the end card (0 when it is off). */
export function outroTail(settings: Scene['settings']): number {
  return settings.outroCard ? Math.max(0, settings.outroSeconds ?? 5) : 0;
}

/** Left edge of a line drawn at x with this alignment, for laying a gradient across it. */
function lineLeft(x: number, width: number, align: CanvasTextAlign): number {
  return align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
}

/** A solid colour, or a left-to-right gradient across the text when there are two or more. */
function textFill(
  ctx: CanvasRenderingContext2D,
  colors: string[] | undefined,
  fallback: string,
  x: number,
  width: number,
): string | CanvasGradient {
  const list = (colors ?? []).filter(Boolean);
  if (list.length === 0) return fallback;
  if (list.length === 1) return list[0];
  const gradient = ctx.createLinearGradient(x, 0, x + Math.max(width, 1), 0);
  list.forEach((color, i) => gradient.addColorStop(i / (list.length - 1), color));
  return gradient;
}

/** The cards' clock: the real time, which can run past the held arrangement in an export. */
function clock(scene: Scene): number {
  return scene.clockSeconds ?? scene.playheadSeconds;
}

function smooth(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

export function renderCards(ctx: CanvasRenderingContext2D, scene: Scene): void {
  if (scene.settings.introCard) {
    if (scene.settings.introStyle === 'thumbnail' && scene.intro?.image) renderThumbnailIntro(ctx, scene, scene.intro);
    else renderIntro(ctx, scene);
  }
  if (scene.settings.outroCard) renderOutro(ctx, scene);
}

function frame(scene: Scene) {
  const W = scene.viewport.width;
  const H = scene.viewport.height;
  return { W, H, s: H / 1080 };
}

function titleOf(scene: Scene): string {
  return (scene.settings.titleText || scene.project.title || '').trim();
}

/**
 * The song's title fades up over a darkened picture at the start, holds, and
 * dissolves as the music gets going, rising slightly as it comes in.
 */
function renderIntro(ctx: CanvasRenderingContext2D, scene: Scene): void {
  // Timed from the start of the video, which is before 0 when a recording leads in.
  const t = clock(scene) - (scene.intro?.start ?? 0);
  const length = Math.max(2, scene.settings.introSeconds ?? 4);
  if (t >= length || t < 0) return;
  const fadeIn = smooth(t / Math.min(1.2, length * 0.3));
  const fadeOut = 1 - smooth((t - (length - 1.4)) / 1.4);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0.002) return;
  const title = titleOf(scene);
  const subtitle = (scene.settings.introSubtitle ?? '').trim();
  const { W, H, s } = frame(scene);
  const theme = scene.settings.theme;

  ctx.save();
  // A scrim, so the title reads over a busy opening.
  ctx.globalAlpha = alpha * 0.62;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, W, H);

  const rise = (1 - fadeIn) * 14 * s;
  const cy = H / 2 + rise;
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.titleText;
  let size = 86 * s;
  ctx.font = `300 ${size}px ${FONT_STACK}`;
  setLetterSpacing(ctx, size * 0.18);
  const text = title.toUpperCase();
  while (ctx.measureText(text).width > W * 0.84 && size > 28 * s) {
    size *= 0.92;
    ctx.font = `300 ${size}px ${FONT_STACK}`;
    setLetterSpacing(ctx, size * 0.18);
  }
  ctx.shadowColor = withAlpha(scene.settings.accentColor, 0.45 * alpha);
  ctx.shadowBlur = 30 * s;
  ctx.fillText(text, W / 2, cy - (subtitle ? 18 * s : 0));
  ctx.shadowBlur = 0;

  // A thin accent rule that draws outward from the centre.
  const rule = W * 0.12 * smooth(t / Math.min(1.8, length * 0.45));
  ctx.fillStyle = scene.settings.accentColor;
  ctx.fillRect(W / 2 - rule / 2, cy + size * 0.52 - (subtitle ? 18 * s : 0), rule, Math.max(1, 2 * s));

  if (subtitle) {
    const sub = 26 * s;
    ctx.font = `400 ${sub}px ${FONT_STACK}`;
    setLetterSpacing(ctx, sub * 0.32);
    ctx.fillStyle = withAlpha(theme.titleText, 0.75);
    ctx.fillText(subtitle.toUpperCase(), W / 2, cy + size * 0.52 + 30 * s);
  }
  setLetterSpacing(ctx, 0);
  ctx.restore();
}

/**
 * After the last note the picture fades to black, then the end text fades up
 * on the left, leaving the right of the frame clear for YouTube's end screen.
 */
function renderOutro(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const t = clock(scene) - musicEnd(scene.project);
  if (t <= 0) return;
  const { W, H, s } = frame(scene);
  // The fades scale with the card's length, so a short end card still shows its text in full.
  const length = Math.max(1, scene.settings.outroSeconds ?? 5);
  const black = smooth(t / Math.min(2.2, length * 0.4));
  ctx.save();
  ctx.globalAlpha = black;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  const textIn = Math.min(1.4, length * 0.28);
  const textAlpha = smooth((t - textIn) / textIn);
  if (textAlpha > 0.002) {
    const text = (scene.settings.outroText ?? '').trim();
    const title = (scene.settings.outroSubtext ?? '').trim() || titleOf(scene);
    const settings = scene.settings;
    const align = settings.outroAlign ?? 'left';
    const x = W * (settings.outroX ?? 0.08);
    const y = H * (settings.outroY ?? 0.5);
    const drift = (1 - textAlpha) * 10 * s;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if (text) {
      ctx.globalAlpha = textAlpha;
      const size = 54 * s;
      ctx.font = `300 ${size}px ${FONT_STACK}`;
      setLetterSpacing(ctx, size * 0.06);
      ctx.fillStyle = textFill(ctx, scene.settings.outroTextColors, '#f2f5f5', lineLeft(x, ctx.measureText(text).width, align), ctx.measureText(text).width);
      ctx.fillText(text, x, y + drift);
    }
    if (title) {
      const custom = (scene.settings.outroSubColors ?? []).length > 0;
      ctx.globalAlpha = textAlpha * (custom ? 0.9 : 0.6);
      const size = 22 * s;
      ctx.font = `500 ${size}px ${FONT_STACK}`;
      setLetterSpacing(ctx, size * 0.3);
      const line = title.toUpperCase();
      ctx.fillStyle = textFill(ctx, scene.settings.outroSubColors, scene.settings.accentColor, lineLeft(x, ctx.measureText(line).width, align), ctx.measureText(line).width);
      ctx.fillText(line, x, y + (text ? 46 * s : 0) + drift);
    }
    setLetterSpacing(ctx, 0);
  }
  ctx.restore();
}

/**
 * The thumbnail as the opening shot: it fills the frame from the very start
 * of the video (while a recording's intro plays, if it has one), drifting in
 * very slowly, then dissolves into the arrangement over a few seconds.
 *
 * When the thumbnail has a title, the title is its own layer, hovering well
 * above the picture. It starts resting where it was placed, then rises: it
 * grows a little (nearer the camera) and its soft shadow slides away and
 * spreads on the picture below. While it hovers it glides slowly across the
 * frame along a path chosen to stay clear of the main shapes, bobbing gently.
 * As the picture dissolves it floats on a moment longer, then fades too.
 */
function renderThumbnailIntro(ctx: CanvasRenderingContext2D, scene: Scene, intro: IntroSource): void {
  if ((scene.settings.introMotion ?? 'dissolve') === 'rush' && intro.scene3d) {
    renderFlyThrough(ctx, scene, intro, intro.scene3d);
    return;
  }
  const image = intro.image;
  if (!image) return;
  const t = clock(scene) - intro.start;
  const length = Math.max(2, scene.settings.introSeconds ?? 4);
  const fade = Math.min(6, Math.max(2.5, length * 0.65));
  if (t >= length || t < 0) return;
  const p = smooth((t - (length - fade)) / fade);
  const baseAlpha = 1 - p;
  const { W, H, s } = frame(scene);
  const iw = (image as HTMLCanvasElement).width || W;
  const ih = (image as HTMLCanvasElement).height || H;
  const cover = Math.max(W / iw, H / ih);
  const progress = t / length;
  // The picture pushes in slowly across the whole intro.
  const baseZoom = 1 + 0.05 * progress;
  // Picture coordinates (fractions of the thumbnail) to the frame.
  const toFrame = (fx: number, fy: number) => ({
    x: W / 2 + (fx * iw - iw / 2) * cover * baseZoom,
    y: H / 2 + (fy * ih - ih / 2) * cover * baseZoom,
  });

  const motion = scene.settings.introMotion ?? 'dissolve';
  const pieces = motion !== 'dissolve' ? intro.pieces : undefined;
  // Movement runs through the fade; the elements leave one after another,
  // top first, and the title last.
  const movers = pieces ? pieces.filter((piece) => !piece.ground).length : 0;
  const titleMoves = Boolean(pieces) && Boolean(intro.title);
  // Departures are spread over at most the first 42% of the fade, so every
  // element is gone by the end however many there are.
  const count = movers + (titleMoves ? 1 : 0);
  const span = Math.min(0.42, 0.12 * Math.max(0, count - 1));
  const step = count > 1 ? span / (count - 1) : 0;
  /** Progress (0–1, eased) of the element `order` places from the top. */
  const exit = (order: number) => {
    const local = Math.min(1, Math.max(0, (p - order * step) / (1 - span)));
    return local * local;
  };

  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  if (!pieces) {
    if (baseAlpha > 0.002) {
      ctx.globalAlpha = baseAlpha;
      ctx.translate(W / 2, H / 2);
      ctx.scale(cover * baseZoom, cover * baseZoom);
      ctx.drawImage(image, -iw / 2, -ih / 2);
    }
  } else if (motion === 'rush') {
    renderTunnel(ctx, pieces, p, baseAlpha, toFrame, cover * baseZoom, iw, ih, W, H);
  } else {
    // Pieces run bottom to top; count the movers passed so far to rank each from the top.
    let seen = 0;
    for (const piece of pieces) {
      const pw = piece.canvas.width;
      const ph = piece.canvas.height;
      const centre = toFrame((piece.x + pw / 2) / iw, (piece.y + ph / 2) / ih);
      const size = cover * baseZoom;
      if (piece.ground) {
        // The background stays put and dissolves into the arrangement.
        if (baseAlpha <= 0.002) continue;
        ctx.save();
        ctx.globalAlpha = baseAlpha;
        ctx.translate(centre.x, centre.y);
        ctx.scale(size, size);
        ctx.drawImage(piece.canvas, -pw / 2, -ph / 2);
        ctx.restore();
        continue;
      }
      // Top elements leave first.
      const q = exit(movers - 1 - seen);
      seen++;
      const move = pieceMotion(motion, q, centre.x, centre.y, W, H, pw * size, ph * size, pieces.indexOf(piece));
      if (move.alpha <= 0.002) continue;
      ctx.save();
      ctx.globalAlpha = move.alpha;
      ctx.translate(centre.x + move.dx, centre.y + move.dy);
      ctx.rotate(move.rotate);
      ctx.scale(size * move.scale, size * move.scale);
      ctx.drawImage(piece.canvas, -pw / 2, -ph / 2);
      ctx.restore();
    }
  }
  ctx.restore();

  const title = intro.title;
  const centre = intro.titleCenter;
  if (!title || !centre) return;
  // In a moving exit the title leaves last, the same way; otherwise it fades.
  const titleExit = titleMoves ? exit(Math.max(0, movers)) : 0;
  const titleAlpha = titleMoves ? 1 - smooth((titleExit - 0.75) / 0.25) : 1 - smooth((p - 0.35) / 0.65);
  if (titleAlpha <= 0.002) return;

  // Rising off the picture over the first second and a half.
  const rise = smooth(t / Math.min(1.5, length * 0.3));
  // The glide: from where it rests along the planned path, easing in and out.
  const path = intro.titlePath;
  const along = smooth(Math.min(1, t / (length * 0.95)));
  const fx = path ? path.from.x + (path.to.x - path.from.x) * along : centre.x;
  const fy = path ? path.from.y + (path.to.y - path.from.y) * along : centre.y;
  // At rest the title sits exactly where it was placed; the path starts there or nearby.
  const restX = centre.x + (fx - centre.x) * rise;
  const restY = centre.y + (fy - centre.y) * rise;
  const at = toFrame(restX, restY);
  const bob = Math.sin(t * 1.4) * 3 * s * rise;
  const scale = cover * baseZoom * (1 + 0.06 * rise);
  const cx = centre.x * iw;
  const cy = centre.y * ih;

  // The shadow lies on the picture: further off, softer and fainter the higher the title is.
  const shadow = intro.titleDepth;
  if (shadow && baseAlpha > 0.002) {
    const height = (4 + 26 * rise) * s - bob;
    ctx.save();
    ctx.globalAlpha = baseAlpha * (0.62 - 0.22 * rise);
    ctx.translate(at.x + height * 0.45, at.y + height);
    ctx.scale(cover * baseZoom * (1 + 0.02 * rise), cover * baseZoom * (1 + 0.02 * rise));
    ctx.drawImage(shadow, -cx, -cy);
    ctx.restore();
  }

  const leave = !titleMoves
    ? { dx: 0, dy: 0, rotate: 0, scale: 1, alpha: 1 }
    : motion === 'rush'
      ? flyPast(titleExit, at.x, at.y, W, H)
      : pieceMotion(motion, titleExit, at.x, at.y, W, H, (title as HTMLCanvasElement).width * 0.3 * cover, 0, 99);
  ctx.save();
  ctx.globalAlpha = titleAlpha * leave.alpha;
  ctx.translate(at.x + leave.dx, at.y + bob - 4 * s * rise + leave.dy);
  ctx.rotate(leave.rotate);
  ctx.scale(scale * leave.scale, scale * leave.scale);
  ctx.drawImage(title, -cx, -cy);
  ctx.restore();
}

/**
 * Where an element is on its way out: `q` runs 0 (in place) to 1 (gone),
 * already eased so it accelerates like something with weight. (cx, cy) is its
 * centre in the frame, w × h its size there.
 */
function pieceMotion(
  motion: string,
  q: number,
  cx: number,
  cy: number,
  W: number,
  H: number,
  w: number,
  h: number,
  index: number,
): { dx: number; dy: number; rotate: number; scale: number; alpha: number } {
  const spin = index % 2 ? 1 : -1;
  if (q <= 0) return { dx: 0, dy: 0, rotate: 0, scale: 1, alpha: 1 };
  if (motion === 'scatter') {
    // Straight out from the centre of the frame, far enough to clear it.
    let ux = cx - W / 2;
    let uy = cy - H / 2;
    const len = Math.hypot(ux, uy);
    if (len < W * 0.05) {
      const angle = index * 2.4;
      ux = Math.cos(angle);
      uy = Math.sin(angle);
    } else {
      ux /= len;
      uy /= len;
    }
    const reach = Math.hypot(W, H) * 0.75 + Math.max(w, h);
    return { dx: ux * reach * q, dy: uy * reach * q, rotate: spin * 0.35 * q, scale: 1 + 0.15 * q, alpha: 1 - smooth((q - 0.7) / 0.3) };
  }
  if (motion === 'slide') {
    // Off to the nearer side, with a little lift as it goes.
    const side = cx < W / 2 ? -1 : 1;
    const reach = (side < 0 ? cx : W - cx) + w / 2 + W * 0.05;
    return { dx: side * reach * q, dy: -H * 0.03 * Math.sin(Math.PI * q), rotate: side * 0.06 * q, scale: 1, alpha: 1 };
  }
  if (motion === 'fall') {
    // A small hop, then gravity takes it out of the bottom of the frame.
    const reach = H - cy + h / 2 + H * 0.05;
    const hop = H * 0.035 * Math.sin(Math.PI * Math.min(1, q * 3));
    return { dx: spin * W * 0.04 * q, dy: reach * q - hop, rotate: spin * 0.5 * q, scale: 1, alpha: 1 };
  }
  return { dx: 0, dy: 0, rotate: 0, scale: 1, alpha: 1 };
}

/** How many copies of each element line the tunnel, and how far apart they are in depth. */
const TUNNEL_COPIES = 5;
const TUNNEL_GAP = 0.8;

/**
 * Fly through: the camera travels forward through a tunnel built from the
 * thumbnail's own elements. Each element is the nearest of a run of copies
 * set further and further back, every copy turned a little further round the
 * centre (and every other one mirrored), so the shapes wrap the way ahead.
 * Everything is drawn in perspective from far to near: distant copies small,
 * dim and close to the centre, swelling and sweeping outward as the camera
 * nears, and fading as they rush past the lens. The deeper copies fade in as
 * the move begins, so before it the thumbnail looks exactly as designed.
 */
function renderTunnel(
  ctx: CanvasRenderingContext2D,
  pieces: NonNullable<IntroSource['pieces']>,
  p: number,
  baseAlpha: number,
  toFrame: (fx: number, fy: number) => { x: number; y: number },
  size: number,
  iw: number,
  ih: number,
  W: number,
  H: number,
): void {
  const cx = W / 2;
  const cy = H / 2;
  // Ease in and out: the camera gathers speed, then glides through the last copies.
  const ease = p * p * (3 - 2 * p);
  const camera = ease * (1 + (TUNNEL_COPIES - 1) * TUNNEL_GAP - 0.1);
  const deepIn = smooth(p * 5);

  const instances: Array<{ z: number; draw: () => void }> = [];
  pieces.forEach((piece, index) => {
    const pw = piece.canvas.width;
    const ph = piece.canvas.height;
    const at = toFrame((piece.x + pw / 2) / iw, (piece.y + ph / 2) / ih);
    if (piece.ground) {
      // The background stays where it is and dissolves into the arrangement.
      if (baseAlpha <= 0.002) return;
      instances.push({
        z: Infinity,
        draw: () => {
          ctx.save();
          ctx.globalAlpha = baseAlpha;
          ctx.translate(at.x, at.y);
          ctx.scale(size, size);
          ctx.drawImage(piece.canvas, -pw / 2, -ph / 2);
          ctx.restore();
        },
      });
      return;
    }
    for (let k = 0; k < TUNNEL_COPIES; k++) {
      const z = 1 + k * TUNNEL_GAP + (index % 3) * 0.07;
      const depth = z - camera;
      if (depth <= 0.08) continue;
      const f = 1 / depth;
      // Fade in from the distance, and out as it passes the lens.
      let alpha = smooth((depth - 0.1) / 0.35) * Math.min(1, 1.6 / (depth + 0.4));
      if (k > 0) alpha *= deepIn * 0.9;
      if (alpha <= 0.004) continue;
      // Each copy turned further round the centre; every other one mirrored.
      const turn = k * 1.1 + (index % 2 ? 0.35 : -0.35) * Math.min(k, 1);
      const mirror = k % 2 === 1 ? -1 : 1;
      const ox = (at.x - cx) * mirror;
      const oy = at.y - cy;
      const rx = ox * Math.cos(turn) - oy * Math.sin(turn);
      const ry = ox * Math.sin(turn) + oy * Math.cos(turn);
      instances.push({
        z,
        draw: () => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(cx + rx * f, cy + ry * f);
          ctx.rotate(turn);
          ctx.scale(size * f * mirror, size * f);
          ctx.drawImage(piece.canvas, -pw / 2, -ph / 2);
          ctx.restore();
        },
      });
    }
  });
  // Far to near, so nearer copies cover the ones behind them.
  instances.sort((a, b) => b.z - a.z);
  for (const instance of instances) instance.draw();
}

/** The title flying past the camera at the end of the tunnel: growing, sweeping outward, fading at the lens. */
function flyPast(q: number, x: number, y: number, W: number, H: number): { dx: number; dy: number; rotate: number; scale: number; alpha: number } {
  const depth = Math.max(0.06, 1 - 0.92 * q);
  const f = 1 / depth;
  return { dx: (x - W / 2) * (f - 1), dy: (y - H / 2) * (f - 1), rotate: 0, scale: f, alpha: smooth((depth - 0.08) / 0.3) };
}

/** A stable 0–1 number per element, for its depth and spin. */
function hash01(i: number, salt: number): number {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Fly through, in 3D. Every element of the thumbnail (each shard, spark,
 * ring, stroke, each line of the title) is placed at its own depth, and the
 * camera travels forward through them. At the first frame everything lines
 * up exactly into the thumbnail; as the camera moves, each element swells and
 * sweeps outward at a rate set by its depth, nearer ones first, so they part
 * around you like a cloud you are flying into. More copies of the elements
 * wait further in, turned round the centre and mirrored, so the way ahead
 * keeps filling like a tunnel. The camera sways and rolls a little, as a head
 * would. Elements are vectors, redrawn at their size on screen every frame,
 * so they stay sharp all the way to the lens; the backdrop sits far away and
 * dissolves into the arrangement.
 */
function renderFlyThrough(ctx: CanvasRenderingContext2D, scene: Scene, intro: IntroSource, world: IntroScene): void {
  const t = clock(scene) - intro.start;
  const length = Math.max(2, scene.settings.introSeconds ?? 4);
  const fade = Math.min(6, Math.max(2.5, length * 0.65));
  if (t >= length || t < 0) return;
  const p = smooth((t - (length - fade)) / fade);
  const { W, H } = frame(scene);
  const iw = world.width;
  const ih = world.height;
  const cover = Math.max(W / iw, H / ih);
  const progress = t / length;
  const size = cover * (1 + 0.04 * progress);
  // Thumbnail pixels to the frame.
  const F = new DOMMatrix().translate(W / 2 - (iw / 2) * size, H / 2 - (ih / 2) * size).scale(size);
  const cx = W / 2;
  const cy = H / 2;

  const n = world.elements.length;
  const copies = n > 1800 ? 1 : n > 800 ? 2 : 3;
  const gap = 2.2;
  const deepest = 1.2 + 2.6 + 0.8 + (copies - 1) * gap;
  // The camera is moving from the very first frame (no standing start, so
  // playback opens straight into the flight) and gathers speed through the
  // intro; the dissolve into the arrangement is timed by `p` at the end.
  const u = Math.min(1, t / length);
  const ease = u * (0.35 + 0.65 * u);
  const camera = ease * (deepest + 0.2);
  // A head's sway and roll, nothing at the start.
  const sway = Math.sin(Math.PI * u);
  const camX = W * 0.05 * sway * Math.sin(u * 4.2);
  const camY = H * 0.035 * sway * Math.cos(u * 3.1);
  const roll = 0.16 * sway * Math.sin(u * 2.3 + 0.4);
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);
  const ending = 1 - smooth((p - 0.86) / 0.14);
  // The deeper copies only appear once the camera is on its way.
  const deepIn = smooth((u - 0.06) * 5);
  // Before playback the real thumbnail is shown; from the first frame of
  // motion the separate elements take over in one clean cut (no crossfade:
  // two near-identical pictures blended read as a smear). The scene is built
  // to match the thumbnail, so the cut does not show.
  const handover = t > 0 ? 1 : 0;
  const drawFlat = (alpha: number) => {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(world.flat, 0, 0, iw, ih, W / 2 - (iw / 2) * size, H / 2 - (ih / 2) * size, iw * size, ih * size);
    ctx.restore();
  };
  if (handover <= 0) {
    drawFlat(1);
    return;
  }

  ctx.save();
  // The far end: the backdrop, barely moving, dissolving into the arrangement.
  const baseAlpha = 1 - p;
  if (baseAlpha > 0.002) {
    const zb = 9;
    const fb = zb / Math.max(zb - camera, 0.5);
    ctx.globalAlpha = baseAlpha;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cx, cy);
    ctx.rotate(roll * 0.3);
    ctx.scale(fb, fb);
    ctx.translate(-cx, -cy);
    ctx.drawImage(world.backdrop, 0, 0, iw, ih, W / 2 - (iw / 2) * size, H / 2 - (ih / 2) * size, iw * size, ih * size);
  }
  ctx.restore();

  // Affine transforms as [a, b, c, d, e, f], composed by hand: thousands of
  // elements a frame, so no matrix objects in the loop.
  const mul = (A: number[], B: number[]) => [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
  const aff = (m: DOMMatrix) => [m.a, m.b, m.c, m.d, m.e, m.f];
  const rootT = aff(ctx.getTransform());
  const Fa = aff(F);

  type Item = { depth: number; element: (typeof world.elements)[number]; M: number[]; alpha: number };
  const items: Item[] = [];
  world.elements.forEach((element, index) => {
    // Lower layers sit deeper; the title passes last.
    const rank = n > 1 ? index / (n - 1) : 1;
    const z0 = element.title ? 1.2 + 2.6 * 0.95 : 1.2 + (1 - rank) * 2.6 + hash01(index, 1) * 0.8;
    const ex = Fa[0] * element.cx + Fa[2] * element.cy + Fa[4];
    const ey = Fa[1] * element.cx + Fa[3] * element.cy + Fa[5];
    const sizeOnFrame = element.size * size;
    for (let k = 0; k < copies; k++) {
      if (k > 0 && element.title) break;
      const z = z0 + k * gap;
      const depth = z - camera;
      if (depth <= 0.04) continue;
      let alpha = smooth((depth - 0.04) / 0.28) * ending;
      if (k > 0) alpha *= deepIn * smooth((9 - depth) / 3);
      if (alpha <= 0.004) continue;
      const f = z / depth;
      // Copies further in are turned round the centre, every other one mirrored.
      const turn = k * 2.399 + (k ? (hash01(index, 3) - 0.5) * 0.6 : 0);
      const mirror = k % 2 ? -1 : 1;
      let ox = (ex - cx) * mirror;
      let oy = ey - cy;
      if (k) {
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        [ox, oy] = [ox * c - oy * sn, ox * sn + oy * c];
      }
      // Into the camera's view: offset by its sway, turned by its roll, then perspective.
      const rx = ox - camX * (1 - 1 / z);
      const ry = oy - camY * (1 - 1 / z);
      // The title grows toward the camera but drifts outward much less, so it
      // stays in view until it rushes past at the very end.
      const spread = element.title ? Math.pow(f, 0.3) : f;
      const sx = cx + (rx * cosR - ry * sinR) * spread;
      const sy = cy + (rx * sinR + ry * cosR) * spread;
      const onScreen = sizeOnFrame * f;
      if (sx + onScreen < -W * 0.1 || sx - onScreen > W * 1.1 || sy + onScreen < -H * 0.1 || sy - onScreen > H * 1.1) continue;
      const spin = roll + (k ? turn : 0) + (hash01(index, 5) - 0.5) * 0.5 * ease;
      const cs = Math.cos(spin);
      const ss = Math.sin(spin);
      // translate(sx, sy) · rotate(spin) · scale(f·mirror, f) · translate(−ex, −ey)
      const a = cs * f * mirror;
      const b = ss * f * mirror;
      const c2 = -ss * f;
      const d = cs * f;
      const M = [a, b, c2, d, sx - (a * ex + c2 * ey), sy - (b * ex + d * ey)];
      items.push({ depth, element, M, alpha });
    }
  });
  // Far to near, so nearer elements pass in front.
  items.sort((a, b) => b.depth - a.depth);
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingQuality = 'high';
  for (const { element, M, alpha } of items) {
    // Element space → thumbnail pixels → frame → camera → device.
    const toFrame = mul(Fa, aff(element.base));
    const full = mul(rootT, mul(M, toFrame));
    const vector = element.vector;
    if (vector?.local) {
      drawSimple(ctx, vector, mul(full, aff(vector.m)), alpha);
    } else if (vector) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      replayElement(ctx, vector, new DOMMatrix(mul(M, toFrame)).preMultiplySelf(new DOMMatrix(rootT)), alpha);
    } else if (element.image) {
      ctx.setTransform(full[0], full[1], full[2], full[3], full[4], full[5]);
      ctx.globalAlpha = alpha;
      ctx.drawImage(element.image, 0, 0);
    }
  }
  ctx.restore();
  drawFlat(1 - handover);
}
