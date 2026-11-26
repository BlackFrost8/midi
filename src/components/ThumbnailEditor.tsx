import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  drawStroke,
  isStampBrush,
  newId,
  stampBox,
  transformBox,
  type Box,
  type BrushId,
  type EditTool,
  type PaintBrush,
  type Stroke,
  type TextureId,
  type ThumbEdits,
  type ThumbElement,
} from '../thumbnail/Editor';
import { ThumbnailView } from './ThumbnailView';

export interface ToolSettings {
  tool: EditTool;
  /** A brush, or a shape that is stamped where you click. */
  brush: PaintBrush;
  color: string;
  /** Brush diameter or shape radius, as a share of the frame height. */
  size: number;
  opacity: number;
  texture: TextureId;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  tool: 'select',
  brush: 'ink',
  color: '#ffffff',
  size: 0.03,
  opacity: 1,
  texture: 'none',
};

interface Props {
  source: HTMLCanvasElement | null;
  version: number;
  label: string;
  edits: ThumbEdits;
  /** `commit` marks the end of a gesture, for undo. */
  onEdits: (edits: ThumbEdits, commit: boolean) => void;
  /** Untransformed bounds of each layer, in frame units. */
  boxes: Map<string, Box>;
  tools: ToolSettings;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** True while a drag is in progress, so the preview can skip the slow finish. */
  onDraft: (draft: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Pixel-accurate test of a point against a layer; the box test runs first. */
  hitTest?: (element: ThumbElement, p: { x: number; y: number }) => boolean;
}

const ASPECT = 16 / 9;

/** The large thumbnail preview, with direct editing on top of it. */
export const ThumbnailEditorStage = memo(function ThumbnailEditorStage(props: Props) {
  const { edits, tools, selectedId, boxes } = props;
  const areaRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gesture = useRef<
    | { kind: 'move'; id: string; start: { x: number; y: number }; t0: ThumbElement['t'] }
    | { kind: 'resize'; id: string; centre: { x: number; y: number }; d0: number; t0: ThumbElement['t'] }
    | { kind: 'paint'; target: string; isNew: boolean; stroke: Stroke; last: { x: number; y: number; time: number } }
    | null
  >(null);
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => {
      const width = Math.max(area.clientWidth - 64, 0);
      const height = Math.max(area.clientHeight - 88, 0);
      const fitted = Math.min(width, height * ASPECT);
      setSize({ width: fitted, height: fitted / ASPECT });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const boxOf = (element: ThumbElement): Box | null => {
    const base = element.kind === 'stamp' && element.stamp ? stampBox(element.stamp) : boxes.get(element.id) ?? null;
    return base ? transformBox(base, element.t) : null;
  };

  const toFrame = (event: { clientX: number; clientY: number }) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.height, y: (event.clientY - rect.top) / rect.height };
  };

  const replace = (id: string, patch: (element: ThumbElement) => ThumbElement): ThumbEdits => ({
    elements: latest.current.edits.elements.map((element) => (element.id === id ? patch(element) : element)),
  });

  /** Top-most visible layer under a point. */
  const hit = (p: { x: number; y: number }): ThumbElement | null => {
    const list = latest.current.edits.elements;
    for (let i = list.length - 1; i >= 0; i--) {
      const element = list[i];
      if (!element.visible) continue;
      // The full-frame background would catch every click and get dragged by
      // accident; it is picked from the Layers list instead.
      if (element.kind === 'part' && element.part === 'ground') continue;
      const box = boxOf(element);
      if (!box || p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) continue;
      if (element.kind === 'stamp' || !latest.current.hitTest || latest.current.hitTest(element, p)) return element;
    }
    return null;
  };

  const liveFrame = useRef(0);
  /** Redraws the stroke in progress at most once per frame. */
  const scheduleLive = () => {
    if (liveFrame.current) return;
    liveFrame.current = requestAnimationFrame(() => {
      liveFrame.current = 0;
      if (gesture.current?.kind === 'paint') drawLive(gesture.current.stroke);
    });
  };

  const drawLive = (stroke: Stroke | null) => {
    const canvas = liveRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.width * dpr);
    const H = Math.round(size.height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (stroke) drawStroke(ctx, stroke.brush === 'eraser' ? { ...stroke, brush: 'round', color: 'rgba(255,255,255,0.35)' } : stroke, W, H);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const p = toFrame(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const { tools: t, edits: current } = latest.current;

    if (t.tool === 'paint' && isStampBrush(t.brush)) {
      const shape = t.brush;
      const element: ThumbElement = {
        id: newId('stamp'),
        kind: 'stamp',
        name: `${shape[0].toUpperCase()}${shape.slice(1)}`,
        visible: true,
        t: { x: 0, y: 0, scale: 1 },
        stamp: {
          shape,
          color: t.color,
          texture: t.texture,
          size: t.size * 1.5,
          rotation: (Math.random() - 0.5) * 0.6,
          seed: Math.floor(Math.random() * 1e9),
          cx: p.x,
          cy: p.y,
        },
      };
      props.onEdits({ elements: insertBelowTitle(current.elements, element) }, true);
      props.onSelect(element.id);
      return;
    }

    if (t.tool === 'paint') {
      const selected = current.elements.find((element) => element.id === latest.current.selectedId);
      const usable = selected?.kind === 'paint' && selected.t.x === 0 && selected.t.y === 0 && selected.t.scale === 1;
      const target = usable ? selected!.id : newId('paint');
      gesture.current = {
        kind: 'paint',
        target,
        isNew: !usable,
        stroke: {
          brush: t.brush as BrushId,
          color: t.color,
          texture: t.texture,
          size: t.size,
          opacity: t.opacity,
          points: [p.x, p.y, pressureOf(event, 0)],
          seed: Math.floor(Math.random() * 1e9),
        },
        last: { x: p.x, y: p.y, time: event.timeStamp },
      };
      drawLive(gesture.current.stroke);
      return;
    }

    // Select: a corner handle of the selection resizes, anything else picks and moves.
    const selected = current.elements.find((element) => element.id === latest.current.selectedId);
    const handle = (event.target as HTMLElement).dataset.handle;
    if (selected && handle) {
      const box = boxOf(selected)!;
      const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      gesture.current = { kind: 'resize', id: selected.id, centre, d0: Math.hypot(p.x - centre.x, p.y - centre.y) || 1e-3, t0: selected.t };
      props.onDraft(true);
      return;
    }
    const target = hit(p);
    props.onSelect(target?.id ?? null);
    if (target) {
      gesture.current = { kind: 'move', id: target.id, start: p, t0: target.t };
      props.onDraft(true);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = toFrame(event);
    if (g.kind === 'move') {
      props.onEdits(replace(g.id, (element) => ({ ...element, t: { ...g.t0, x: g.t0.x + p.x - g.start.x, y: g.t0.y + p.y - g.start.y } })), false);
    } else if (g.kind === 'resize') {
      const scale = Math.min(Math.max(g.t0.scale * (Math.hypot(p.x - g.centre.x, p.y - g.centre.y) / g.d0), 0.08), 10);
      props.onEdits(replace(g.id, (element) => ({ ...element, t: { ...g.t0, scale } })), false);
    } else if (g.kind === 'paint') {
      const dt = Math.max(event.timeStamp - g.last.time, 1);
      const speed = Math.hypot(p.x - g.last.x, p.y - g.last.y) / dt;
      if (Math.hypot(p.x - g.last.x, p.y - g.last.y) < 0.0015) return;
      g.stroke.points.push(p.x, p.y, pressureOf(event, speed));
      g.last = { x: p.x, y: p.y, time: event.timeStamp };
      scheduleLive();
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'paint') {
      cancelAnimationFrame(liveFrame.current);
      liveFrame.current = 0;
      drawLive(g.stroke);
      const current = latest.current.edits.elements;
      const next = g.isNew
        ? insertBelowTitle(current, {
            id: g.target,
            kind: 'paint',
            name: `Paint ${current.filter((element) => element.kind === 'paint').length + 1}`,
            visible: true,
            t: { x: 0, y: 0, scale: 1 },
            strokes: [g.stroke],
          })
        : current.map((element) => (element.id === g.target ? { ...element, strokes: [...(element.strokes ?? []), g.stroke] } : element));
      props.onEdits({ elements: next }, true);
      props.onSelect(g.target);
      // Leave the live stroke up until the committed one has been drawn.
      window.setTimeout(() => drawLive(null), 120);
      return;
    }
    props.onDraft(false);
    props.onEdits(latest.current.edits, true);
  };

  // Clicking anywhere outside the picture (except the side panel, whose
  // controls act on the selection) deselects.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || !latest.current.selectedId) return;
      if (overlayRef.current?.contains(target) || target.closest('.sidebar')) return;
      latest.current.onSelect(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  // Delete removes your own layers and hides generated ones; arrows nudge;
  // Ctrl+Z / Ctrl+Shift+Z undo and redo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const { edits: current, selectedId: id } = latest.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) latest.current.onRedo();
        else latest.current.onUndo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        latest.current.onRedo();
        return;
      }
      if (!id) return;
      if (event.key === 'Escape') {
        latest.current.onSelect(null);
        return;
      }
      const element = current.elements.find((e) => e.id === id);
      if (!element) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        const next =
          element.kind === 'paint' || element.kind === 'stamp'
            ? current.elements.filter((e) => e.id !== id)
            : current.elements.map((e) => (e.id === id ? { ...e, visible: false } : e));
        latest.current.onEdits({ elements: next }, true);
        latest.current.onSelect(null);
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 0.02 : 0.004;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        latest.current.onEdits(
          { elements: current.elements.map((e) => (e.id === id ? { ...e, t: { ...e.t, x: e.t.x + dx, y: e.t.y + dy } } : e)) },
          true,
        );
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const selected = edits.elements.find((element) => element.id === selectedId) ?? null;
  const selectedBox = selected && tools.tool === 'select' ? boxOf(selected) : null;
  const toPx = (v: number) => v * size.height;

  return (
    <div className="thumb-stage" ref={areaRef}>
      <div className="thumb-stage-inner" style={{ width: size.width }}>
        <div className="thumb-stage-caption">
          <span>Thumbnail</span>
          <span>{props.label}</span>
        </div>
        <div style={{ width: size.width, height: size.height, position: 'relative' }}>
          <ThumbnailView source={props.source} version={props.version} />
          <canvas ref={liveRef} className="thumb-live" />
          <div
            ref={overlayRef}
            className={`thumb-edit-overlay tool-${tools.tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {selectedBox && (
              <div
                className="thumb-selection"
                style={{
                  left: toPx(selectedBox.x0),
                  top: toPx(selectedBox.y0),
                  width: toPx(selectedBox.x1 - selectedBox.x0),
                  height: toPx(selectedBox.y1 - selectedBox.y0),
                }}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                  <span key={corner} className={`thumb-handle ${corner}`} data-handle={corner} />
                ))}
                <span className="thumb-selection-name">{selected!.name}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/** New layers go on top of everything except the title. */
export function insertBelowTitle(elements: ThumbElement[], element: ThumbElement): ThumbElement[] {
  const title = elements.findIndex((e) => e.kind === 'title');
  if (title < 0) return [...elements, element];
  return [...elements.slice(0, title), element, ...elements.slice(title)];
}

/** Pen pressure when there is a pen; otherwise faster strokes draw thinner. */
function pressureOf(event: { pointerType: string; pressure: number }, speed: number): number {
  if (event.pointerType === 'pen' && event.pressure > 0) return Math.max(0.15, event.pressure);
  return Math.min(1, Math.max(0.45, 1.1 - speed * 120));
}
