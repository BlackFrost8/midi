import { useEffect, useState } from 'react';
import type { RenderSettings } from '../models/RenderSettings';
import { loadLooks, saveLooks, type SavedLook } from '../session/SongStore';

/** Settings that belong to one song, never to a look. */
const SONG_ONLY: Array<keyof RenderSettings> = ['titleText', 'cameraKeys', 'showAdvancedLook'];

export function lookFromSettings(settings: RenderSettings): Partial<RenderSettings> {
  const look: Partial<RenderSettings> = structuredClone(settings);
  for (const key of SONG_ONLY) delete look[key];
  return look;
}

interface Props {
  settings: RenderSettings;
  /** Applies a saved look over the current settings. */
  onApply: (look: Partial<RenderSettings>) => void;
}

/**
 * Your own looks: everything on the Visual and Colour tabs, glow sync and the
 * intro and end cards included, saved under a name so every video in a
 * series can look the same. Saved with the songs (on disk, so every browser
 * has them) and shared by all songs.
 */
export function SavedLooks({ settings, onApply }: Props) {
  const [looks, setLooks] = useState<SavedLook[]>([]);
  const [naming, setNaming] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadLooks().then((saved) => {
      if (live) setLooks(saved);
    });
    return () => {
      live = false;
    };
  }, []);

  const update = (next: SavedLook[]) => {
    setLooks(next);
    void saveLooks(next);
  };

  const save = () => {
    const name = (naming ?? '').trim() || `Look ${looks.length + 1}`;
    const existing = looks.find((look) => look.name.toLowerCase() === name.toLowerCase());
    const look: SavedLook = { id: existing?.id ?? `look-${Date.now().toString(36)}`, name, settings: lookFromSettings(settings) };
    update(existing ? looks.map((l) => (l.id === existing.id ? look : l)) : [...looks, look]);
    setNaming(null);
  };

  return (
    <div className="saved-looks">
      <div className="camera-keys-head">
        <span>My looks</span>
        {naming === null && (
          <button className="chip" onClick={() => setNaming('')} title="Save the current visual, colour and glow settings as a look">
            + save current
          </button>
        )}
      </div>
      {naming !== null && (
        <div className="camera-key-row">
          <input
            className="saved-look-name"
            autoFocus
            placeholder="Name (same name replaces)"
            value={naming}
            onChange={(event) => setNaming(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') setNaming(null);
            }}
          />
          <button className="btn primary" onClick={save}>
            Save
          </button>
          <button className="btn" onClick={() => setNaming(null)}>
            Cancel
          </button>
        </div>
      )}
      {looks.length === 0 && naming === null && (
        <p className="hint">Save the look you have built to reuse it on every song in a series.</p>
      )}
      <div className="saved-look-list">
        {looks.map((look) => (
          <div key={look.id} className="saved-look">
            <button
              className="saved-look-apply"
              title="Apply this look"
              onClick={() => onApply(look.settings)}
            >
              <span className="saved-look-swatches">
                {[look.settings.backgroundColor, look.settings.primaryColor, look.settings.accentColor].map((colour, i) => (
                  <span key={i} style={{ background: colour ?? 'transparent' }} />
                ))}
              </span>
              <span>{look.name}</span>
            </button>
            <button className="mini-btn" title="Update with the current settings" onClick={() => update(looks.map((l) => (l.id === look.id ? { ...l, settings: lookFromSettings(settings) } : l)))}>
              ⟳
            </button>
            <button className="mini-btn" title="Delete this look" onClick={() => update(looks.filter((l) => l.id !== look.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
