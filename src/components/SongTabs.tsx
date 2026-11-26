interface Props {
  songs: Array<{ id: string; name: string }>;
  active: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: () => void;
}

/**
 * One tab per open song, along the top. Every song keeps its own look,
 * tracks, thumbnail, recording and export settings, and all of them are
 * saved in the browser, so they are still here after a reload.
 */
export function SongTabs({ songs, active, onSelect, onClose, onOpen }: Props) {
  return (
    <div className="song-tabs" role="tablist" aria-label="Open songs">
      {songs.map((song) => (
        <div
          key={song.id}
          role="tab"
          aria-selected={song.id === active}
          className={`song-tab${song.id === active ? ' active' : ''}`}
          title={song.name}
          onClick={() => onSelect(song.id)}
          onAuxClick={(event) => {
            // Middle click closes, as in a browser.
            if (event.button === 1) onClose(song.id);
          }}
        >
          <span className="song-tab-name">{song.name}</span>
          <button
            className="song-tab-close"
            title="Close this song (it is removed from the saved songs)"
            onClick={(event) => {
              event.stopPropagation();
              onClose(song.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="song-tab-add" title="Open another MIDI file in a new tab" onClick={onOpen}>
        +
      </button>
    </div>
  );
}
