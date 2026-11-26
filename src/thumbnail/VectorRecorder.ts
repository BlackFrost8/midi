/**
 * Records a canvas drawing as separate vector elements.
 *
 * The thumbnail styles draw straight to a 2D context, one shape at a time:
 * every shard of a Shard Burst is its own fill, every spark, ring, arc and
 * line its own stroke. The recorder stands in front of a real context and
 * passes every call through, so the picture is drawn exactly as before, but
 * each drawing operation (a fill, a stroke, a rectangle, a run of text, an
 * image) is also captured as its own element: its path, the transform each
 * part of the path was built under, the clip around it and every bit of
 * drawing state. An element can then be redrawn on its own, under any extra
 * transform, as sharp as vector art at any size, which is what lets the
 * intro fly the camera through the thumbnail's elements one by one.
 */

type PathOpName =
  | 'moveTo'
  | 'lineTo'
  | 'bezierCurveTo'
  | 'quadraticCurveTo'
  | 'arc'
  | 'arcTo'
  | 'ellipse'
  | 'rect'
  | 'roundRect'
  | 'closePath';

interface PathOp {
  name: PathOpName;
  args: unknown[];
  m: DOMMatrix;
}

/** A path, or a Path2D, with the transform it was given in. */
interface RecordedPath {
  ops?: PathOp[];
  path2d?: Path2D;
  m?: DOMMatrix;
  rule?: CanvasFillRule;
}

interface DrawState {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  lineDash: number[];
  lineDashOffset: number;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  letterSpacing?: string;
  filter: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
}

export interface VectorElement {
  kind: 'fill' | 'stroke' | 'text' | 'image';
  path?: RecordedPath;
  /** fillText/strokeText arguments, or drawImage's (image first). */
  args?: unknown[];
  textStroke?: boolean;
  /** Transform when the element was drawn. */
  m: DOMMatrix;
  clips: RecordedPath[];
  state: DrawState;
  /** Where it landed, in the recorded canvas's pixels. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /**
   * For a plain fill or stroke (no clip, shadow, filter, dash or blend, the
   * whole path in one transform): the path ready-made in that transform's
   * space, so it can be redrawn with one call (see drawSimple).
   */
  local?: Path2D;
}

const PATH_OPS = new Set<string>([
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'closePath',
]);

/** Copies a canvas used as an image source: the styles throw their scratch canvases away right after drawing them. */
function keep(source: unknown): unknown {
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext('2d')?.drawImage(source, 0, 0);
    return copy;
  }
  return source;
}

function snapshot(ctx: CanvasRenderingContext2D): DrawState {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  return {
    fillStyle: c.fillStyle,
    strokeStyle: c.strokeStyle,
    lineWidth: c.lineWidth,
    lineCap: c.lineCap,
    lineJoin: c.lineJoin,
    miterLimit: c.miterLimit,
    lineDash: c.getLineDash(),
    lineDashOffset: c.lineDashOffset,
    globalAlpha: c.globalAlpha,
    globalCompositeOperation: c.globalCompositeOperation,
    shadowBlur: c.shadowBlur,
    shadowColor: c.shadowColor,
    shadowOffsetX: c.shadowOffsetX,
    shadowOffsetY: c.shadowOffsetY,
    font: c.font,
    textAlign: c.textAlign,
    textBaseline: c.textBaseline,
    letterSpacing: c.letterSpacing,
    filter: c.filter,
    imageSmoothingEnabled: c.imageSmoothingEnabled,
    imageSmoothingQuality: c.imageSmoothingQuality,
  };
}

/** Bounds of a recorded path, from its points (and arc extents) under each op's transform. */
function pathBounds(path: RecordedPath, extra: number, out: { x0: number; y0: number; x1: number; y1: number }): void {
  const add = (m: DOMMatrix, x: number, y: number, r = 0) => {
    const px = m.a * x + m.c * y + m.e;
    const py = m.b * x + m.d * y + m.f;
    const s = r * Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
    out.x0 = Math.min(out.x0, px - s - extra);
    out.y0 = Math.min(out.y0, py - s - extra);
    out.x1 = Math.max(out.x1, px + s + extra);
    out.y1 = Math.max(out.y1, py + s + extra);
  };
  if (path.path2d) {
    // A Path2D cannot be read back; assume it may cover the canvas.
    out.x0 = Math.min(out.x0, -1e5);
    out.y0 = Math.min(out.y0, -1e5);
    out.x1 = Math.max(out.x1, 1e5);
    out.y1 = Math.max(out.y1, 1e5);
    return;
  }
  for (const op of path.ops ?? []) {
    const a = op.args as number[];
    switch (op.name) {
      case 'moveTo':
      case 'lineTo':
        add(op.m, a[0], a[1]);
        break;
      case 'quadraticCurveTo':
        add(op.m, a[0], a[1]);
        add(op.m, a[2], a[3]);
        break;
      case 'bezierCurveTo':
        add(op.m, a[0], a[1]);
        add(op.m, a[2], a[3]);
        add(op.m, a[4], a[5]);
        break;
      case 'arcTo':
        add(op.m, a[0], a[1]);
        add(op.m, a[2], a[3]);
        break;
      case 'arc':
        add(op.m, a[0], a[1], a[2]);
        break;
      case 'ellipse':
        add(op.m, a[0], a[1], Math.max(a[2], a[3]));
        break;
      case 'rect':
      case 'roundRect':
        add(op.m, a[0], a[1]);
        add(op.m, a[0] + a[2], a[1] + a[3]);
        break;
      default:
        break;
    }
  }
}

export interface Recorder {
  ctx: CanvasRenderingContext2D;
  elements: VectorElement[];
}

/** Wraps a context so that everything drawn through it is also recorded as elements. */
export function createRecorder(target: CanvasRenderingContext2D): Recorder {
  const elements: VectorElement[] = [];
  let path: PathOp[] = [];
  let clips: RecordedPath[] = [];
  const clipStack: RecordedPath[][] = [];

  const emit = (element: Omit<VectorElement, 'm' | 'clips' | 'state' | 'bounds'>, bounds: VectorElement['bounds']) => {
    const m = target.getTransform();
    const state = snapshot(target);
    const recorded: VectorElement = { ...element, m, clips: clips.slice(), state, bounds };
    recorded.local = simplePath(recorded) ?? undefined;
    elements.push(recorded);
  };
  const emptyBounds = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

  const handlers: Record<string, (args: unknown[]) => void> = {
    beginPath: () => {
      path = [];
    },
    save: () => {
      clipStack.push(clips.slice());
    },
    restore: () => {
      clips = clipStack.pop() ?? [];
    },
    clip: (args) => {
      if (args[0] instanceof Path2D) clips.push({ path2d: args[0], m: target.getTransform(), rule: args[1] as CanvasFillRule });
      else clips.push({ ops: path.slice(), rule: args[0] as CanvasFillRule });
    },
    fill: (args) => {
      const recorded: RecordedPath =
        args[0] instanceof Path2D
          ? { path2d: args[0], m: target.getTransform(), rule: args[1] as CanvasFillRule }
          : { ops: path.slice(), rule: args[0] as CanvasFillRule };
      const bounds = emptyBounds();
      pathBounds(recorded, 0, bounds);
      emit({ kind: 'fill', path: recorded }, bounds);
    },
    stroke: (args) => {
      const recorded: RecordedPath = args[0] instanceof Path2D ? { path2d: args[0], m: target.getTransform() } : { ops: path.slice() };
      const m = target.getTransform();
      const bounds = emptyBounds();
      pathBounds(recorded, (target.lineWidth / 2) * Math.max(Math.hypot(m.a, m.b), 1e-6), bounds);
      emit({ kind: 'stroke', path: recorded }, bounds);
    },
    fillRect: (args) => {
      const m = target.getTransform();
      const recorded: RecordedPath = { ops: [{ name: 'rect', args: args.slice(0, 4), m }] };
      const bounds = emptyBounds();
      pathBounds(recorded, 0, bounds);
      emit({ kind: 'fill', path: recorded }, bounds);
    },
    strokeRect: (args) => {
      const m = target.getTransform();
      const recorded: RecordedPath = { ops: [{ name: 'rect', args: args.slice(0, 4), m }] };
      const bounds = emptyBounds();
      pathBounds(recorded, target.lineWidth / 2, bounds);
      emit({ kind: 'stroke', path: recorded }, bounds);
    },
    fillText: (args) => textElement(args, false),
    strokeText: (args) => textElement(args, true),
    drawImage: (args) => {
      const [image, ...rest] = args;
      const n = rest as number[];
      const source = image as { width: number; height: number };
      let dx: number;
      let dy: number;
      let dw: number;
      let dh: number;
      if (n.length >= 8) [dx, dy, dw, dh] = [n[4], n[5], n[6], n[7]];
      else if (n.length >= 4) [dx, dy, dw, dh] = [n[0], n[1], n[2], n[3]];
      else [dx, dy, dw, dh] = [n[0], n[1], source.width, source.height];
      const m = target.getTransform();
      const bounds = emptyBounds();
      pathBounds({ ops: [{ name: 'rect', args: [dx, dy, dw, dh], m }] }, 0, bounds);
      emit({ kind: 'image', args: [keep(image), ...rest] }, bounds);
    },
    putImageData: (args) => {
      // Not transformed and not composited: an image placed in canvas pixels.
      const data = args[0] as ImageData;
      const canvas = document.createElement('canvas');
      canvas.width = data.width;
      canvas.height = data.height;
      canvas.getContext('2d')?.putImageData(data, 0, 0);
      const dx = args[1] as number;
      const dy = args[2] as number;
      elements.push({
        kind: 'image',
        args: [canvas, dx, dy],
        m: new DOMMatrix(),
        clips: [],
        state: { ...snapshot(target), globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', shadowBlur: 0 },
        bounds: { x0: dx, y0: dy, x1: dx + data.width, y1: dy + data.height },
      });
    },
  };

  function textElement(args: unknown[], strokeIt: boolean): void {
    const [text, x, y] = args as [string, number, number];
    const metrics = target.measureText(String(text));
    const left = target.textAlign === 'center' ? x - metrics.width / 2 : target.textAlign === 'right' || target.textAlign === 'end' ? x - metrics.width : x;
    const size = metrics.fontBoundingBoxAscent || parseFloat(target.font) || 16;
    const m = target.getTransform();
    const bounds = emptyBounds();
    pathBounds({ ops: [{ name: 'rect', args: [left, y - size, metrics.width, size * 1.35], m }] }, 0, bounds);
    emit({ kind: 'text', args: args.slice(), textStroke: strokeIt }, bounds);
  }

  const ctx = new Proxy(target, {
    get(t, prop) {
      const value = (t as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value !== 'function') return value;
      const name = String(prop);
      return (...args: unknown[]) => {
        if (PATH_OPS.has(name)) path.push({ name: name as PathOpName, args, m: t.getTransform() });
        const handler = handlers[name];
        // Record before forwarding where the state matters at the moment of drawing (it does not change in between).
        const result = (value as (...a: unknown[]) => unknown).apply(t, args);
        handler?.(args);
        return result;
      };
    },
    set(t, prop, value) {
      (t as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });
  return { ctx, elements };
}

const sameMatrix = (a: DOMMatrix, b: DOMMatrix) =>
  a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.e === b.e && a.f === b.f;

/** The ready-made path for a plain fill or stroke, or null when it needs the full replay. */
function simplePath(element: VectorElement): Path2D | null {
  if (element.kind !== 'fill' && element.kind !== 'stroke') return null;
  const s = element.state;
  if (element.clips.length || !element.path?.ops?.length) return null;
  if (s.globalCompositeOperation !== 'source-over' || (s.shadowBlur > 0 && s.shadowColor !== 'rgba(0, 0, 0, 0)')) return null;
  if (s.filter !== 'none' || s.lineDash.length) return null;
  if (!element.path.ops.every((op) => sameMatrix(op.m, element.m))) return null;
  const path = new Path2D();
  for (const op of element.path.ops) (path[op.name] as (...a: unknown[]) => void)(...op.args);
  return path;
}

/**
 * Draws an element that has a ready-made path with as little as possible:
 * one transform, its colours, one fill or stroke. `t` is the full transform
 * from the recorded element's own space to the device ([a, b, c, d, e, f]).
 * The caller keeps shadows, filters and blending at their defaults.
 */
export function drawSimple(ctx: CanvasRenderingContext2D, element: VectorElement, t: number[], alpha: number): void {
  const s = element.state;
  ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
  ctx.globalAlpha = s.globalAlpha * alpha;
  if (element.kind === 'fill') {
    ctx.fillStyle = s.fillStyle;
    ctx.fill(element.local!, element.path?.rule ?? 'nonzero');
  } else {
    ctx.strokeStyle = s.strokeStyle;
    ctx.lineWidth = s.lineWidth;
    ctx.lineCap = s.lineCap;
    ctx.lineJoin = s.lineJoin;
    ctx.miterLimit = s.miterLimit;
    ctx.stroke(element.local!);
  }
}

/** Replays a recorded path into `ctx` under `outer`, op by op in the transform each was built in. */
function tracePath(ctx: CanvasRenderingContext2D, path: RecordedPath, outer: DOMMatrix): Path2D | null {
  if (path.path2d) {
    ctx.setTransform(outer.multiply(path.m ?? new DOMMatrix()));
    return path.path2d;
  }
  ctx.beginPath();
  for (const op of path.ops ?? []) {
    ctx.setTransform(outer.multiply(op.m));
    (ctx[op.name] as (...a: unknown[]) => void)(...op.args);
  }
  return null;
}

/**
 * Draws one recorded element into `ctx` under an extra transform `base`
 * (mapping the recorded canvas's pixels to where it should go), with its
 * opacity multiplied by `alpha`. The context's own transform (its pixel
 * ratio) is kept underneath.
 */
export function replayElement(ctx: CanvasRenderingContext2D, element: VectorElement, base: DOMMatrix, alpha = 1): void {
  const outer = ctx.getTransform().multiply(base);
  ctx.save();
  for (const clip of element.clips) {
    const p2d = tracePath(ctx, clip, outer);
    if (p2d) ctx.clip(p2d, clip.rule ?? 'nonzero');
    else ctx.clip(clip.rule ?? 'nonzero');
  }
  const s = element.state;
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  c.fillStyle = s.fillStyle;
  c.strokeStyle = s.strokeStyle;
  c.lineWidth = s.lineWidth;
  c.lineCap = s.lineCap;
  c.lineJoin = s.lineJoin;
  c.miterLimit = s.miterLimit;
  c.setLineDash(s.lineDash);
  c.lineDashOffset = s.lineDashOffset;
  c.globalAlpha = s.globalAlpha * alpha;
  c.globalCompositeOperation = s.globalCompositeOperation;
  // Shadows ignore the transform, so they are scaled with it by hand.
  const scale = Math.hypot(base.a, base.b);
  c.shadowBlur = s.shadowBlur * scale;
  c.shadowColor = s.shadowColor;
  c.shadowOffsetX = s.shadowOffsetX * scale;
  c.shadowOffsetY = s.shadowOffsetY * scale;
  c.font = s.font;
  c.textAlign = s.textAlign;
  c.textBaseline = s.textBaseline;
  if (s.letterSpacing !== undefined && 'letterSpacing' in c) c.letterSpacing = s.letterSpacing;
  c.filter = s.filter;
  c.imageSmoothingEnabled = s.imageSmoothingEnabled;
  c.imageSmoothingQuality = s.imageSmoothingQuality;

  if (element.kind === 'fill' || element.kind === 'stroke') {
    const p2d = element.path ? tracePath(ctx, element.path, outer) : null;
    ctx.setTransform(outer.multiply(element.m));
    if (element.kind === 'fill') {
      if (p2d) ctx.fill(p2d, element.path?.rule ?? 'nonzero');
      else ctx.fill(element.path?.rule ?? 'nonzero');
    } else if (p2d) ctx.stroke(p2d);
    else ctx.stroke();
  } else if (element.kind === 'text') {
    ctx.setTransform(outer.multiply(element.m));
    const [text, x, y, maxWidth] = element.args as [string, number, number, number | undefined];
    if (element.textStroke) {
      if (maxWidth !== undefined) ctx.strokeText(text, x, y, maxWidth);
      else ctx.strokeText(text, x, y);
    } else if (maxWidth !== undefined) ctx.fillText(text, x, y, maxWidth);
    else ctx.fillText(text, x, y);
  } else if (element.kind === 'image') {
    ctx.setTransform(outer.multiply(element.m));
    const [image, ...rest] = element.args as [CanvasImageSource, ...number[]];
    (ctx.drawImage as (...a: unknown[]) => void)(image, ...rest);
  }
  ctx.restore();
}
