import { lchCss } from '../Oklch';
import type { Random } from '../Noise';
import type { DetailId } from '../Recipe';
import { inside, lineCss, type Env, type Rect } from './Kit';
import type { SubjectResult } from './Subjects';

/** Finishing touches laid over the artwork, before the title. */
export function drawDetail(env: Env, id: DetailId, random: Random, primary: SubjectResult | null, quiet: Rect | null): void {
  const { ctx } = env;
  ctx.save();
  switch (id) {
    case 'arcs':
      arcs(env, random, primary, quiet);
      break;
    case 'frameLine':
      frameLine(env, random);
      break;
    case 'specks':
      specks(env, random, quiet);
      break;
    case 'glitch':
      glitch(env, random);
      break;
    case 'grain':
      grain(env, random);
      break;
    case 'scanlines':
      scanlines(env);
      break;
  }
  ctx.restore();
}

/** Thin circle arcs hung on the main shape's outline, or circling its focal point. */
function arcs(env: Env, random: Random, primary: SubjectResult | null, quiet: Rect | null): void {
  const { ctx, H, A } = env;
  ctx.strokeStyle = lineCss(env, 0.88);
  ctx.lineWidth = Math.max(1, 0.0028 * H);
  ctx.lineCap = 'round';
  const outline = primary?.outline;
  const focal = primary?.focal ?? { x: A / 2, y: 0.5, r: 0.2 };

  // An arc that would cross the title is left out rather than cut.
  const stroke = (x: number, y: number, radius: number, start: number, sweep: number) => {
    for (let i = 0; i <= 24; i++) {
      const angle = start + (sweep * i) / 24;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (quiet && px > quiet.x0 - 0.02 && px < quiet.x1 + 0.02 && py > quiet.y0 - 0.02 && py < quiet.y1 + 0.02) return;
    }
    ctx.beginPath();
    ctx.arc(x * H, y * H, radius * H, start, start + sweep);
    ctx.stroke();
  };

  if (!outline) {
    for (let i = random.int(3, 5); i > 0; i--) {
      stroke(focal.x, focal.y, Math.max(focal.r, 0.1) * random.range(1.1, 2.2), random.range(0, Math.PI * 2), random.range(0.6, 2.4));
    }
    return;
  }

  const points: Array<{ x: number; y: number }> = [];
  const count = random.int(3, 5);
  for (let attempt = 0; attempt < 2500 && points.length < count; attempt++) {
    const x = random.range(0.08, A - 0.08);
    const y = random.range(0.08, 0.92);
    if (Math.abs(outline(x, y)) > 0.025) continue;
    // A step toward the centre must land well inside, or this is a stray drop's edge.
    const toward = Math.hypot(focal.x - x, focal.y - y) || 1;
    if (outline(x + ((focal.x - x) / toward) * 0.06, y + ((focal.y - y) / toward) * 0.06) < 0.05) continue;
    if (points.some((p) => Math.hypot(p.x - x, p.y - y) < 0.2)) continue;
    points.push({ x, y });
  }
  for (const p of points) {
    stroke(p.x, p.y, random.range(0.06, 0.16), random.range(0, Math.PI * 2), random.range(2.2, 4.6));
  }
}

function frameLine(env: Env, random: Random): void {
  const { ctx, W, H } = env;
  const inset = random.range(0.035, 0.055) * H;
  ctx.strokeStyle = lineCss(env, 0.8);
  ctx.lineWidth = Math.max(1, 0.0026 * H);
  ctx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
}

/** A sprinkle of tiny squares, like dust on a scan. */
function specks(env: Env, random: Random, quiet: Rect | null): void {
  const { ctx, H, A } = env;
  for (let i = random.int(20, 60); i > 0; i--) {
    const x = random.range(0.03, A - 0.03);
    const y = random.range(0.03, 0.97);
    const size = random.range(0.0025, 0.008) * H;
    const alpha = random.range(0.3, 0.9);
    if (inside(quiet, x, y)) continue;
    ctx.fillStyle = random.chance(0.15) ? lchCss(env.ink.accent, alpha) : lineCss(env, alpha);
    ctx.fillRect(x * H, y * H, size, size);
  }
}

/** A few horizontal slices knocked sideways, with a hairline of colour. */
function glitch(env: Env, random: Random): void {
  const { ctx, W, H } = env;
  const canvas = ctx.canvas;
  for (let i = random.int(3, 6); i > 0; i--) {
    const y = random.range(0.05, 0.95) * H;
    const height = random.range(0.004, 0.035) * H;
    const shiftX = random.range(0.01, 0.05) * W * random.sign();
    ctx.drawImage(canvas, 0, y, W, height, shiftX, y, W, height);
  }
  ctx.fillStyle = lchCss(env.ink.accent, 0.85);
  for (let i = random.int(1, 2); i > 0; i--) {
    ctx.fillRect(0, random.range(0.1, 0.9) * H, W, Math.max(1, 0.002 * H));
  }
}

/** Fine film grain from a seeded noise tile. */
function grain(env: Env, random: Random): void {
  const { ctx, W, H } = env;
  const size = 160;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  if (!tctx) return;
  const image = tctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = random.next() * 255;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  tctx.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  // Grain is a property of the print, not the pixels: keep it fine at any size.
  pattern.setTransform(new DOMMatrix().scale(Math.max(H / 1080, 0.5)));
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
}

function scanlines(env: Env): void {
  const { ctx, W, H } = env;
  const pitch = Math.max(2, Math.round(H / 240));
  ctx.fillStyle = env.tone === 'light' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.22)';
  for (let y = 0; y < H; y += pitch * 2) ctx.fillRect(0, y, W, pitch);
}
