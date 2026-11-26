interface Props {
  onClose: () => void;
}

type Row = [keys: string[], action: string];

const PLAYBACK: Row[] = [
  [['Space'], 'Play / pause'],
  [['Enter'], 'Back to the start (keeps playing)'],
  [['Shift', 'B'], 'Back to the start'],
  [['←', '→'], 'Seek 2 s (with Shift: 10 s)'],
  [['F'], 'Fit the whole song'],
  [['Esc'], 'Clear the note selection, close this bar'],
  [['?'], 'Show or hide this bar'],
];

const MOUSE: Row[] = [
  [['Drag'], 'Pan the arrangement'],
  [['Wheel'], 'Scroll up and down the tracks'],
  [['Ctrl', 'Wheel'], 'Zoom about the cursor'],
  [['Shift', 'Wheel'], 'Scroll sideways'],
  [['Alt', 'Drag'], 'Scrub the playhead (or drag the ruler)'],
  [['Click'], 'Inspect a note'],
];

const THUMB: Row[] = [
  [['Click'], 'Select an element (Select tool)'],
  [['Drag'], 'Move it; drag a corner handle to resize'],
  [['←', '→', '↑', '↓'], 'Nudge the selection (with Shift: further)'],
  [['Delete'], 'Delete paint or a shape; hide a generated layer'],
  [['Esc'], 'Deselect (or click outside the picture)'],
  [['Ctrl', 'Z'], 'Undo'],
  [['Ctrl', 'Shift', 'Z'], 'Redo (or Ctrl+Y)'],
];

/** A slide-down bar explaining the app: the flow, the tabs, the thumbnail editor and every shortcut. */
export function InfoBar({ onClose }: Props) {
  return (
    <div className="info-bar" role="dialog" aria-label="How it works">
      <div className="info-bar-head">
        <span className="info-bar-title">How it works</span>
        <button className="mini-btn" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="info-bar-grid">
        <section>
          <h3>Making a video</h3>
          <ol>
            <li>
              <b>Open MIDI</b>, or drop .mid files anywhere: each song opens in its own tab along the top, and everything is saved to the project's saved/ folder, so every browser on this computer has it. Drop an audio file (WAV, MP3…) to play your real mix under it.
            </li>
            <li>
              <b>Colour</b>: pick a preset or two colours; the instruments follow.
            </li>
            <li>
              <b>Visual</b>: the look and framing. The preview is the exact video frame.
            </li>
            <li>
              <b>Audio</b>: <i>Auto-sync</i> lines the recording up with the notes.
            </li>
            <li>
              <b>Export</b>: MP4 (with your audio), WebM, PNG frames, a still or SVG.
            </li>
          </ol>
        </section>
        <section>
          <h3>Tabs</h3>
          <dl>
            <dt>Tracks</dt>
            <dd>Show, mute, solo, group and recolour each track.</dd>
            <dt>Visual</dt>
            <dd>Looks and <b>My looks</b>, bars on screen, note size, glow, <b>Dynamic</b> (camera follows the playing tracks, with keyframes), follow, tempo, layout, the track panel, and the <b>intro &amp; end card</b>.</dd>
            <dt>Colour</dt>
            <dd>Theme and instrument colours. The accent also starts the thumbnail.</dd>
            <dt>Audio</dt>
            <dd>Load your mixdown, auto-sync, offset and volume.</dd>
            <dt>Thumb</dt>
            <dd>A YouTube thumbnail designed from the song, editable by hand, with a Filter section (Pixel, Oil paint, Watercolor, Comic, 3D and more).</dd>
            <dt>Export</dt>
            <dd>Size, frame rate, range and format; the thumbnail is saved here too.</dd>
          </dl>
        </section>
        <section>
          <h3>Thumbnail</h3>
          <ul>
            <li>
              <b>Shuffle</b> rolls a new design; <b>Style</b> picks Layered, Moon &amp; Ring or a classic.
            </li>
            <li>
              <b>Select</b> moves and resizes anything, title included.
            </li>
            <li>
              <b>Paint</b>: drag with a brush, or click to drop a shape (Land, Moon, Sparkle…). Pick a texture for either.
            </li>
            <li>
              <b>Filter</b> section: one filter over the whole picture, with a strength; the title stays clean unless you include it.
            </li>
            <li>
              <b>Layers</b>: reorder, hide, delete or reset. The background is picked here.
            </li>
            <li>
              <b>Title</b>: text, second line, font, case and colour.
            </li>
          </ul>
        </section>
        <section>
          <h3>Keyboard</h3>
          <Keys rows={PLAYBACK} />
          <h3>Mouse</h3>
          <Keys rows={MOUSE} />
        </section>
        <section>
          <h3>Thumbnail editor</h3>
          <Keys rows={THUMB} />
          <p className="info-bar-note">Shortcuts pause while you type in a text field.</p>
        </section>
      </div>
    </div>
  );
}

function Keys({ rows }: { rows: Row[] }) {
  return (
    <table className="info-keys">
      <tbody>
        {rows.map(([keys, action]) => (
          <tr key={action}>
            <td>
              {keys.map((key) => (
                <span key={key} className="kbd">
                  {key}
                </span>
              ))}
            </td>
            <td>{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
