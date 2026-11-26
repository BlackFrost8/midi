import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Name the MIDI file specifies, used when there is no override. */
  fileName: string;
  /** Current override, or null when the file's name is in use. */
  label: string | null;
  onChange: (label: string | null) => void;
}

/**
 * Editable track name.
 *
 * The field keeps its own draft text while you type. Without that, clearing it
 * drops the override, which makes the file's name reappear under the cursor —
 * so you could never empty the field to start fresh. The draft lets it sit
 * empty; the override is only resolved back to the file's name on blur.
 */
export function TrackNameInput({ fileName, label, onChange }: Props) {
  const [draft, setDraft] = useState(label ?? fileName);
  /** The last value this field itself committed, to tell self from outside. */
  const committed = useRef(label);

  useEffect(() => {
    // Only re-sync when the override changed somewhere else, such as the row's
    // reset button. Echoes of our own commits must not clobber the draft.
    if (label !== committed.current) {
      committed.current = label;
      setDraft(label ?? fileName);
    }
  }, [fileName, label]);

  const commit = (value: string) => {
    // An empty field, or the file's own name typed back, means "no override".
    const trimmed = value.trim();
    const next = trimmed === '' || trimmed === fileName ? null : value;
    committed.current = next;
    onChange(next);
  };

  return (
    <input
      className="track-rename"
      value={draft}
      title={`Rename — originally "${fileName}"`}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
        commit(event.target.value);
      }}
      onBlur={() => {
        // Leaving it blank falls back to the file's name rather than showing
        // an empty row.
        if (draft.trim() === '') setDraft(fileName);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(fileName);
          commit('');
          event.currentTarget.blur();
        }
      }}
    />
  );
}
