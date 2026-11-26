import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Every file dropped or picked, in order. */
  onFiles: (files: File[]) => void;
  /** Rendered as a full-screen empty state when no project is loaded. */
  idle: boolean;
  children?: React.ReactNode;
}

/**
 * How long without a dragover before the overlay assumes the drag is over.
 * Browsers fire dragover continuously (every 50 ms or so) while a drag hovers
 * the page, so silence this long means it was cancelled, left the window or
 * was dropped somewhere else.
 */
const DRAG_TIMEOUT_MS = 300;

/** Only drags carrying files show the overlay — not dragged text or links. */
function carriesFiles(event: React.DragEvent | DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes('Files'));
}

/**
 * Wraps the stage so a MIDI file or a recording can be dropped anywhere in the
 * window, and shows the empty state before anything is loaded.
 */
export function FileDropZone({ onFiles, idle, children }: Props) {
  const [dragging, setDragging] = useState(false);
  const timerRef = useRef<number | null>(null);

  const endDrag = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDragging(false);
  }, []);

  /**
   * A drag can end in ways that never reach this element — Escape, leaving the
   * window, dropping on another app, or a leave event landing on a child of
   * the overlay. Rather than trying to catch every one, the overlay stays up
   * only while dragover keeps arriving.
   */
  const keepAlive = useCallback(() => {
    setDragging(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(endDrag, DRAG_TIMEOUT_MS);
  }, [endDrag]);

  // The quick exits, so the overlay does not even linger for the timeout.
  useEffect(() => {
    const onWindowLeave = (event: DragEvent) => {
      // relatedTarget is null when the pointer leaves the window entirely.
      if (event.relatedTarget === null) endDrag();
    };
    window.addEventListener('dragleave', onWindowLeave);
    window.addEventListener('dragend', endDrag);
    window.addEventListener('drop', endDrag);
    return () => {
      window.removeEventListener('dragleave', onWindowLeave);
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('drop', endDrag);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [endDrag]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      endDrag();
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length) onFiles(files);
    },
    [endDrag, onFiles],
  );

  const openPicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi,audio/midi,audio/x-midi';
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length) onFiles(files);
    };
    input.click();
  }, [onFiles]);

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        keepAlive();
      }}
      onDragLeave={(event) => {
        // Leaving for somewhere outside this area: either another part of the
        // app or, with a null relatedTarget, out of the window.
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) endDrag();
      }}
      onDrop={handleDrop}
    >
      {children}
      {(idle || dragging) && (
        <div className={`dropzone${dragging ? ' dragging' : ''}`} style={idle ? undefined : { opacity: 0.96 }}>
          <div className="dropzone-frame">
            <h1>MIDI Arrangement Visualizer</h1>
            {dragging && !idle ? (
              <p>Drop a MIDI file or a recording</p>
            ) : (
              <>
                <p>Drop a .mid file</p>
                <button className="btn primary" onClick={openPicker}>
                  Choose a MIDI file
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
