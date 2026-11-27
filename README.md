# MIDI Cinematic Arrangement Visualizer

Drop in a `.mid` file and get a cinematic picture of the arrangement — every lane, entrance,
exit and melodic contour drawn from the actual MIDI data, with a cyan light moving through it.
Built to produce footage you can cut straight into a YouTube video.

Nothing is faked: every note rectangle comes from a parsed MIDI note, every horizontal position
from real musical timing, every vertical position from real pitch.

```bash
npm install
npm run dev
```

Then open the printed URL and drop a MIDI file anywhere in the window.

---

## Making a video

The usual flow:

1. **Load the MIDI.** Tracks, instruments, tempo map, time signatures, markers and clip regions
   are detected automatically, and the app opens in the **Cinematic** look — already framed for
   video, nothing to configure.
2. **Colour it** in the *Colour* tab (see below).
3. **Adjust if you want to** in the *Visual* tab — five controls, or Advanced for everything.
4. **Export** from the *Export* tab.

The preview is framed at the export size (16:9 by default), so what you see is the video frame.

### Songs and saving

Every MIDI file you open gets its own **tab along the top** (open several at once by picking or
dropping several files). Each song keeps its own look, colours, tracks, camera keyframes,
thumbnail and edits, recording and export settings; click a tab to switch, ✕ or middle-click to
close (it asks first, since closing deletes that song's saved work). A new song starts from the
current song's look, so a series stays consistent.

Everything is **saved to disk** as you work: the app's server (`npm run dev`, or `npm run preview`)
writes the MIDI file, the recording and every setting into the project's **`saved/`** folder, and
your looks into `saved/looks.json`. Any browser on this computer that opens the app (the Claude
browser, Opera GX, Chrome…) reads the same files, so your tabs, looks and edits are there in all
of them, and after a reload or a restart. The first time, songs a browser had saved on its own are
moved into `saved/` automatically. Work in one browser at a time: two open at once each save over
the other's changes. If the app is ever opened without its server it falls back to that browser's
own storage. Back the `saved/` folder up to keep your work safe.

### Intro and end card

**Visual → Intro & end card**, both optional. **Intro shows** picks the opening: a **Title card**
fades the song title (and an optional subtitle such as the artist or series) up over a dimmed
picture at the start, with a thin accent rule drawing outward, then dissolves after the length you
set; **Thumbnail** opens on your thumbnail (edits and filter included, rendered at the video's own
size), filling the frame with a slow push-in from the very first frame, while a recording's
intro plays if it has one, then slowly dissolves into the arrangement over the last part of the
intro length. If the thumbnail has a title, the title sits on its own layer, hovering
above the picture. It starts resting where it was placed, then rises off it: it grows a little,
as if nearer the camera, and its soft shadow slides away and spreads on the picture below. While
it hovers it glides slowly from where it sits to a nearby spot, along a path chosen to stay clear
of the thumbnail's shapes, details and anything else that stands out from the background, and it
bobs very gently. As the picture dissolves it floats on a moment longer, then fades too. (On a
very dark picture the shadow has nothing to fall on, so the depth comes from the rise and the
drift. A title that is filtered with the picture stays part of it.)

The intro is always drawn at the video's own resolution (up to 4K), in the preview as well as the
export, so the thumbnail is as sharp in the opening as it is as a still.

**Intro animation** decides how the thumbnail leaves. *Dissolve* fades it into the arrangement.
The others take it apart, every element (the shapes, the details, your paint and stamps, the
title) moving on its own while the background dissolves, one after another from the top layer
down, the title last, each accelerating as if it had weight: *Scatter* flies everything outward
from the centre, spinning a little; *Slide away* sends each element off its nearer side; *Fall*
gives each a small hop before gravity takes it out of the bottom of the frame; *Fly through* is a 3D flight through the
thumbnail itself. The design is drawn again with a recorder in front of the canvas, so every single
element comes back as its own vector shape: each shard of a Shard Burst, each spark, ring, arc and
stroke, each line of the title. Each gets its own depth (lower layers deeper, with a little
variation), and the camera flies forward through them in true perspective: at the first frame they
line up exactly into the thumbnail, then each swells and sweeps past at a speed set by its depth,
nearest first, parting around you like a cloud. Further copies wait deeper in, turned round the
centre and mirrored, so the way ahead keeps filling like a tunnel; the camera sways and rolls a
little, as a head would. The title grows toward you and passes last. Because the elements are
vectors redrawn at their size on screen every frame, they stay crisp all the way to the lens; the
background sits far away at the end of the tunnel and dissolves into the arrangement. Layers that
cannot be split (a layer coloured with the gradient, your paint and stamps) fly as sharp
full-resolution pieces, and a filtered picture stays as the backdrop while its title and anything
above it fly. A thumbnail with a filter cannot
be taken apart, so it moves out as one piece. All of it is in every export. The **end card** fades
the picture to black once the last note has finished and brings up your text ("Thanks for
listening" by default) with a smaller sub-text under it (the song title unless you type one,
e.g. "Subscribe for more"); each line has its own colour or a **Gradient** (two to four colours
running across the text; **+ gradient** adds more), on the left by default so the right of the frame stays clear for
YouTube's end-screen elements. **Text position** is a miniature of the frame: drag in it to place
the text anywhere (the striped strip marks where end-screen elements usually go), with **Align**
left, centre or right, **Show end card** to jump there while you place it, and **Reset position**.
The fades scale with the card's length, so even a two-second card shows its text in full. With the end card on, playback and the default export range run on
past the music for its length. Both are in every export.

### Dynamic camera

**Visual → Dynamic** turns the frame into a camera that follows the music: only the tracks that
are playing are in view, filling the frame (one track alone is held to most of the height). A track
that stops shrinks and fades away, even when it sits between two that keep playing, and the rest
close up around the gap; a track about to play starts fading and growing back in about two and a
half seconds before its first note, so the camera opens up ahead of each entrance. Rests of up to
about two seconds keep a track in view, so nothing twitches. Muted tracks, and tracks silenced by a
solo, are ignored. The moves are worked out once per song from the notes, so the preview and every
export (MP4, WebM, frames) follow exactly the same path.

Two settings shape the move. **Camera speed** (slow to fast) sets how long each fade and zoom
takes; slower moves also start earlier, so they still land on the entrance. **Camera motion**:
*Glide* eases in and out, *Snap* commits quickly and settles, *Drift* is slow and even and keeps
tracks in view a little longer.
Tracks that come in (or drop out) within a couple of seconds of each other are taken as one move,
so the camera makes a single clean zoom rather than a stutter of small ones.

**Camera keyframes** (under the Dynamic settings) let you decide what is in view over a stretch of
the song: **+ at playhead** adds one starting where the playhead is; set its start and end (type a
time like `1:23.5`, or ⇤ / ⇥ to take the playhead), pick the tracks, and choose **Focus** (only
these tracks), **Include** (these as well as whatever is playing) or **Hide** (keep these out).
The move starts a little early so it has settled by the start time, eases out the same way at the
end, and is in every export. ▶ jumps to a keyframe. Keyframes belong to their song.

### Play bar

Under the arrangement is a play bar: a miniature of the whole song, one thin row per track,
so you can see where parts enter and drop out. Click or drag anywhere on it to jump there —
the view re-frames around the playhead the way playback would. MIDI markers appear above it as
clickable section names, hovering shows the bar number and time, and Home / End jump to the
start and end when it has focus.

### Looks

One click sets the whole frame. Looks never touch your colours.

**My looks** saves your own: **+ save current** stores everything on the Visual and Colour tabs
(glow sync and the intro and end card included) under a name, and clicking it applies that look to
whichever song is open; that song's title and camera keyframes stay its own. ⟳ updates a look with
the current settings, ✕ deletes it, and saving under an existing name replaces it. Looks are kept
in this browser and shared by all songs.

| Look | What you get |
| --- | --- |
| **Cinematic** (default) | Full bleed, every track on screen sharing the full height, about eight seconds of music across the frame (whole bars at the song's tempo), the playhead pinned a fifth of the way in while the music scrolls under it, no ruler or markers, an activity strip beside each track name. The music-video look. |
| **Overview** | The whole arrangement in one frame, every track, ruler and markers on. Good for a still. |
| **Studio** | Dense and analytical: every track, beat grid, one shared pitch scale. |

Under the presets are the five controls that actually change the feel — **tracks in view**,
**bars on screen** (the zoom), **note size**, **glow** and **follow** — plus tempo. Everything
else lives behind the **Advanced** switch, in the same place it always was.

**Exports reproduce the visual settings.** Colours, note styling, lane height, tracks in view,
icons, the title, vertical scroll — all of it comes from the Visual and Colour tabs. Nothing is
restyled or re-laid-out for export.

Two framings, chosen in the Export tab:

| Framing | What you get | Good for |
| --- | --- | --- |
| **Match the view** (default) | Exactly what is on screen: your zoom, scroll position and settings. Video motion follows the **Follow** mode you picked in the Visual tab | Anything you have framed by hand |
| **Whole song** | The full song scaled across the frame with the playhead sweeping over it | Full-song visuals, the reference look |

Under *Match the view*, the Visual tab's **Follow** setting drives how the video moves: `Scroll`
keeps the playhead pinned (a fifth of the way in for Cinematic; *Playhead position* under
Advanced changes it), `Page` jumps a screen at a time, and `Off` holds your framing
still and lets the playhead cross it. **Tracks in view** is honoured too, so a five-lane framing
exports as five lanes rather than being squeezed back to all of them.

Three ways to get moving footage:

- **Export MP4** (recommended) — H.264 via WebCodecs. Every frame is rendered offline and handed
  to the encoder in turn, so a heavy scene makes the export take longer rather than dropping
  frames. Upload-ready with no transcode. H.264 needs even dimensions, so odd sizes are rounded
  down by a pixel.
- **WebM** — real-time capture via `MediaRecorder`. Faster, but a heavy scene at 4K can drop
  frames.
- **PNG frames** — renders every frame offline into a folder you pick, for your own encode. Then
  run the `ffmpeg` command shown in the panel:

```bash
ffmpeg -framerate 60 -i frame_%05d.png -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p out.mp4
```

PNG frame export needs a Chromium-based browser (it uses the File System Access API).

There is no audio in the export — mute the preview synth and lay your real mixdown over the
video in your editor. The visual clock is real time, so it lines up.

### Stills

**Export PNG** renders a single frame at any resolution up to 16384 px per side (1080p / 1440p /
4K / 8K presets, plus square and vertical for shorts). Transparent background is available for
compositing. **Export SVG** produces true vector output; it omits the raster-only atmospherics
(background wash, vignette, note bloom) and the instrument icons, since those belong in a
compositor rather than a vector file.

**Playhead fade-out.** Near the end of the song the playhead dims away (its glow narrowing as it
goes) over the last few seconds, gone just as the final note ends, so the last chord rings out in
the dark. It shows in the preview and in every export; turn it off with *Fade out at the end* in
the Visual tab.

Exports never screenshot the UI. They re-render the arrangement through the same renderer at the
target resolution, so no buttons, scrollbars or selection highlights leak into the frame.

---

## Thumbnails

The **Thumb** tab designs a YouTube thumbnail for the loaded song: abstract art in the manner of
AZALI's cover art, built from the song itself. The stage shows it large while the tab is open, and
the panel shows a feed-size copy with the song's duration badge.

**Reading the song.** Energy (tempo, note rate, velocity, drums — and the mix's loudness and attack
when a recording is loaded), brightness (major or minor, register, pace), tension (notes outside the
key, restless dynamics) and air (pads, choirs, long notes), plus how much is played on keys or synths.

**Style.** Most thumbnails are *Layered* (below). The eight original designs are also there as
complete compositions — **Colour Field, Paper Bloom, Void Rift, Neon Frame, Shard Burst, Fracture,
Orbit and Glyph Score** — picked from the Style menu at the top of the Look section. The favourites also come in fixed variations:
Void Rift · Tear / Mass / Splash, Paper Bloom · Streak / Island / Corner, Shard Burst · Storm / Drift /
Colour, and **Moon & Ring** (a moon with its ring on a soft ground, different with each shuffle). On Auto, about
half of songs (and shuffles) land on a classic, led by Void Rift, Paper Bloom and Shard Burst; layered
designs lean toward a moon with a ring.

**Layers.** A layered thumbnail is a stack of choices, each weighted by that reading and rolled with
the song's own seed:

| Layer | Options |
| --- | --- |
| Tone | Light, Dark, Colour |
| Background | Plain, Clouds, Gradient, Split, Strata, Pixel |
| Main shape | None, Bloom, Tear, Mass, Islands, Moon, Sun, Pillar, Crackle, Shards, Frame, Glyphs, Contour, Skyline, Ring |
| Second shape | A partner that suits the main one (a ring round a moon, a contour inside a frame…), or none |
| Details | Up to three of Arcs, Border, Specks, Glitch, Grain, Scanlines |
| Composition | Where the focal point sits, its size, and which way it faces |

Glyphs and Contour draw the song's actual lead melody; Skyline draws how busy each
bar is from intro to outro. The same file always opens on the same design; **Shuffle** rolls a new
one and **Original** comes back. Any layer can be set by hand in the Look section.

**Colour.** The key sets the hue by walking the circle of fifths round the colour wheel (C red,
G orange, D gold, A chartreuse, E green … F rose); energy sets how vivid it is and brightness how
light. A colour word in the title wins over the key — "horizon chartreuse" is chartreuse, "altered
obsidian" goes dark, "rain" goes teal. The Colour section then lets you change any of it: presets
(Song, Pastel, Deep, Neon, Mono, Triad, Dusk, Bright — each built from your accent colour and shown
as it would look), background tone, exact main and accent colours, a gradient, vividness and
lightness. Colour changes recolour the design without changing its shapes.

A main or accent colour you type is used exactly as typed (the hue, vividness and lightness sliders
still adjust it). If the main colour would vanish into the background — black, white or grey, or a
colour too close to the background's own tone — it becomes the background and the accent paints the
shapes: black with a cyan accent gives cyan shapes on black. This applies to the classic styles too.

**Starting colour.** The thumbnail starts from the accent chosen in the Colour tab, so it matches
the video; the song's energy still sets how vivid it is, and a colour word in the title still wins.
**Gradient** in the thumbnail's Colour section takes two to five colours. **Gradient on** picks
what it colours: the Background (the default: the background becomes that gradient on Auto, and the
classic styles paint it behind their shapes), the Main shape, the Second shape, the Details and/or
the Title, in any mix. Shapes are recoloured across their own bounds and keep a little of their
shading; the title's letters are filled with it. **Direction** runs it across, down or diagonally.
Classic styles are one picture, so only Background and Title apply to them.

**Editing by hand.** The thumbnail on the stage is editable, and edits survive shuffles and colour
changes:

- **Select** — click any element (title, shapes, details, your paint and shapes) to select it,
  drag to move it, drag a corner handle to resize it. The background is selected from the Layers
  list, so a stray click never drags it. Click outside the picture (or press Esc) to deselect. Arrow
  keys nudge (Shift for bigger steps); Delete removes paint and shapes and hides generated layers.
- **Paint** — one tool for brushes and shapes, each with an icon:
  - *Brushes, drag to paint:* Round, Ink (tapers with speed or pen pressure), Dry brush (bristle
    streaks), Chalk (broken, grainy), Spray, Marker (flat, translucent) and Eraser (erases within
    its own paint layer). Strokes go into the selected paint layer, or a new one.
  - *Shapes, click to place:* Land (a ragged coastline with islets), Blob, Circle, Moon, Ring,
    Shard, Sparkle, Drop. Every shape is a little different; a selected one can be recoloured,
    rotated, re-textured or re-rolled with **New shape**.
  - *Texture,* for brushes and shapes alike: Smooth, Canvas (woven), Paper (rough tooth), Sponge,
    Hatch, Dots, Grit.
  - Colour swatches come from the thumbnail's palette plus black and white; size and opacity.
- **Layers** — the list in the Edit section, top first: select, show/hide, move up or down, delete
  (your layers) or reset position (generated ones). Classic styles are one *Artwork* layer.
- **Undo / Redo** — buttons, or Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y.

Edits reset when a new song is loaded. Exports include them at full resolution, since paint and
shapes are stored as shapes, not pixels.

**Filter** (a section of the Thumb tab, under Title). One filter over the whole thumbnail, each shown as a live preview of your picture:
Pixel (made in MS Paint with a mouse: chunky pixels, wobbly lines, hard splotches with spray
speckle), Oil paint (smeared dabs that keep the shapes, brush-stroke ridges, fine lines picked back
out), Watercolor (thin washes pooling darker at their edges, paper showing through, a ragged
unpainted border), Coloring book (black outlines on white), Comic (punchy cel-shaded colour with
smooth ink outlines), 3D (raised, lit and casting soft shadows like a paper cut-out), Duotone (two
palette colours), Neon (glowing edges on black), Dreamy (soft bloom), Sketch (pencil outlines and
cross-hatching that builds up in the shadows), Stained glass and Noir (S-curve black and white,
cool shadows, vignette). Each has its own main slider (Chunkiness, Brush size, Wetness, Line weight,
Ink, Depth…) and an **Amount** slider that blends the filter with the original picture. The title stays
clean on top unless **Filter the title too** is on; your paint and shapes below it are filtered
with the picture. While you drag a layer the filter runs at half size so it keeps up, then
sharpens when you let go.

**Title.** Taken from the file name (`03_mechanical-god.mid` → "mechanical god"), editable, with an
optional second line, a font (Clean, Grotesk, Wide, Heavy, Tall, Serif, Mono, Marker, Pixel — web
fonts from Google Fonts, with system fallbacks offline), a case switch and a colour (auto, white,
dark, accent or a custom colour). **Outline**, **Shadow** and **Glow** sliders (each off by default)
keep the title readable at the small size YouTube shows thumbnails; each has its own colour, which
follows the title (a dark outline on a light title, and so on) until you set one. It is placed away
from the focal point and never in the bottom-right corner, where YouTube draws the duration.

**Export.** The thumbnail is saved from the **Export** tab (its Thumbnail section).
*YouTube 1280×720* writes a PNG, or a high-quality JPEG if the PNG would break YouTube's
2 MB limit. *1920×1080* and *4K* are always PNG. Every size is rendered fresh at its resolution.

---

## Colour

**Simple mode (the default)** asks for three colours and derives everything else:

- **Primary** paints the notes and text.
- **Accent** paints the playhead, clip headers and glow.
- **Background** sets the canvas.

Panel, grid, ruler, markers, separators and every other slot are blended from those, and the
instrument colours fan out as a gradient running primary → accent → a hue-rotated accent. The
**Gradient spread** slider sets how far round the colour wheel that gradient travels. The gradient
is stretched across the instrument families actually present in your file, so a twelve-part
orchestral score uses the whole ramp rather than crowding into one corner of it. Moving the
slider switches notes to their instrument's colour if they were all one colour (Uniform, Velocity
or Pitch), since otherwise the spread would not show; tracks with their own colour keep it, and a
note under the slider offers to clear them.

**Advanced mode** exposes all 27 element slots and the individual instrument colours, for when you
want to place a specific value. Switching back to simple regenerates the set from your two colours.

Per-track overrides sit on top of both and win over every other rule.

**Themes** — `Frost Cinematic` (the default black/white/cyan look), plus Monochrome, Ice, Amber,
Crimson, Neon, Blueprint, Aurora and a light `Paper` theme. Picking a theme replaces every colour
slot; anything you edit afterwards sticks until you pick another theme.

**Note colour source** decides where a note's colour comes from:

| Mode | Behaviour |
| --- | --- |
| Uniform | Every note uses the Note colour |
| By instrument | Colour comes from the instrument palette |
| By track | Each track keeps its own assigned colour |
| By velocity | Blends Note → Note (playing) with dynamics |
| By pitch | Blends Note → accent across the pitch range |

**Instrument palettes** — Frost, Spectrum, Orchestral, Cool, Warm, Neon, Pastel, Greyscale, Ink.
Only families actually present in your file are listed for editing. These colours also drive clip
headers and the panel indicator dots, so a recoloured section reads consistently across the frame.

**Per-track overrides** beat every other rule. Set them individually from the swatch in the
*Tracks* tab, or hit **Auto-assign** to spread distinct hues across every track at once.

**Element slots** (advanced mode) — background, ambient glow, panel fill and edge, track name,
sub-label, icon, indicator dot, bar line, beat line, lane separator, clip header, clip label, clip
fill, clip outline, note, note-playing, note glow, note-selected, playhead, playhead glow, ruler
fill, ruler text, ruler line, marker text, marker line and title.

---

## Tracks

Tracks are named after the **instrument the MIDI file specifies** for them: the track's
`Instrument Name` if it has one, otherwise the General MIDI program set on its channel — written
as you would label a track ("Sawtooth Lead", "Metallic Pad", "Steel Guitar"). Drum channels are
named by kit ("Drums", "Analog Drums", "Brush Drums"), including kits selected through GM2 or XG
bank select on channels other than 10. When two tracks play the same instrument they are
numbered ("Grand Piano 1", "Grand Piano 2"). A track whose channel never receives a program
change has not specified an instrument, so it keeps its own name instead of a guessed piano.

Programs are looked up across the whole file, because channels are global: many exporters put
every program change on the first track. Everything is read straight from the MIDI bytes and
matched to each track by its first note, which stays exact however the parsing library splits
or reorders chunks. A format-0 file's name is its song title, never a track name.

If a file's tracks carry their own names ("Piano Right", "Piano Left"), a **Names: Instrument /
Track name** switch appears at the top of the Tracks tab.

Each row in the Tracks tab carries a colour swatch, an icon button and the track
name as an editable field. Click the name to rename it — press Enter or click away to
commit, or press Escape to abandon the edit. You can clear the field completely while typing;
leaving it blank falls back to the name in the file. Renames show up in the track panel, on the
clip headers over the notes, and in every export, and override the file's name without
discarding it — the ↺ button on a row
restores the name the file specified, along with its colour and icon.

Renames live in the session, not in the `.mid` file; the app never writes to your MIDI.

---

## Icons

The **Studio** group adds the instruments a DAW like Logic gives its tracks: electric piano,
electric guitar and bass, amp, ukulele, mandolin, sitar, string section, trombone, French horn,
tuba, clarinet, bagpipes, kick, cowbell, shaker, marimba, steel drum, drum machine, sampler,
modular synth, turntable and loop. The Instruments icon set also uses them automatically when a
file names the exact General MIDI instrument (an electric piano, a trombone, a steel drum…).

The track panel draws from a library of 70 clean stroke glyphs in ten groups: keys (piano,
synth keyboard, organ, accordion, harmonica), strings, wind and brass (including sax and pan flute),
percussion (kit, snare, hi-hat, cymbal, timpani, conga, tambourine, maracas, mallet bars, bell,
gong), voice and sound, synth and waveforms (sine, square, saw, triangle, pulse, noise, ADSR
envelope, knob, bolt), atmosphere (cloud, sparkle, drop, waves, moon, sun, planet), notation
(notes, treble and bass clef, metronome, vinyl), shapes and minimal marks.

Pick a **set** in the Visual tab (Instruments, Waveform, Geometric, Minimal or None). The
Instruments set matches the exact General MIDI instrument whenever the file names one — a marimba
gets mallet bars, an accordion its bellows, a warm pad a cloud — and falls back to the instrument
family otherwise, so new files get fitting glyphs with no setup. Click the icon button beside any
track's colour swatch to pick a specific glyph for that one track. The picker renders through the
same drawing code as the arrangement, so what you pick is exactly what appears in the frame and in
exports.

**Gradient icons** (Colour tab → Icons) paint every track icon in a gradient instead of a flat
colour, and lift them from a faint watermark to a feature of the frame. *Match accent* builds the
gradient from your accent colour (so changing the accent recolours the icons); *Custom* takes two
to four colours of your own. Five styles: diagonal, vertical, horizontal, radial (centre out) and
sweep (round the icon). *Strength* sets how strongly the icons show.

With gradient icons on, each track's icon can **glow in sync** with its own notes, following the
pace of the music. Every glow peaks on its note, so it stays in sync. In fast passages each note
or chord is a quick flash and a crisp fade, so the icon lights up with the beat; in slow ones the
rise is gentler, the glow settles to a steady level for as long as the note sounds (well under the
peak, so the next note still reads as a fresh strike), and fades out over a second or so after it
ends. Each phrase eases in over its first second, and its last note fades out slowly. Louder notes glow brighter, and each new note or chord strikes on top of whatever is still
glowing, so a melody over a held chord still flashes note by note. A chord counts as one
hit. *Glow sync* sets the overall amount; the ◉ button on each row of the Tracks tab turns it on or
off for that track. **Glow sync on clips** also lights the clip that is playing in the track's
colour, and **Glow sync on lanes** swells a soft band of that colour behind the notes; both follow
the same envelope. It is worked out from the playhead position alone, so a paused frame and every
frame of an exported video look exactly like live playback.

---

## Audio

### Stems: solo and mute you can hear

A recording is one finished mix, which cannot be taken apart, so soloing a track cannot pull its
part out of it. **Stems** can: one audio file per track, exported from your DAW with the same
start as the mix (in Logic: File → Export → All Tracks as Audio Files). In the Audio tab's
**Stems** section, **+ match by name** takes several files at once and gives each to the track
whose name it matches ("02 Grand Piano.wav" → Grand Piano); the **+** on a track adds one by hand.

- Solo a track that has a stem and you hear just that stem (several soloed: all of their stems).
- When every track has a stem, the stems replace the mix, so mute works on the sound too.
- **Focus the mix when soloing a track without a stem** (on by default) is the approximate
  fallback: it filters the recording to the soloed part's range of notes, which brings it forward
  but keeps anything else playing in that range. Drum tracks are not focused.

Stems are saved with the song. The MP4 export carries the audio exactly as you hear it: stems at
their levels, soloed or muted, and the solo focus, mixed down when you export.

**YouTube Short** (Export tab) makes a vertical 1080×1920 MP4 of 15–60 seconds with sound. It
starts on the downbeat where the song hits hardest (found from note density, velocity and jumps
in energy, ignoring muted tracks), with your hook caption popping up over the first seconds. It
has no intro or end card, so it loops cleanly. **Hear it** plays from the chosen start;
**Start at playhead** overrides it, and **Auto** goes back to the automatic start.

Drop your mixdown anywhere in the window — WAV, MP3, M4A, OGG or FLAC — and it loads into the
**Audio** tab. Once it is playing, it becomes the clock the whole app runs on: the playhead reads
the audio position every frame instead of integrating its own, so the picture cannot drift away
from the music however long the track runs. The preview synth is bypassed while it plays.

**Auto-sync** lines the arrangement up with the recording by matching every note start in the
MIDI against the attacks heard in the audio, across the whole song:

- The audio becomes an onset envelope — log-magnitude spectral flux at ~12 ms resolution.
- A global search over speed (0.5×–2×) and offset cross-correlates the MIDI's note train with that
  envelope, using the busiest 30 seconds of the song.
- Checkpoints every four seconds then each find their local timing, and a robust straight-line
  fit through them gives the final **offset** and **speed**. The fit grows outward from where the
  coarse match was made, so it cannot jump to a neighbouring beat.

Both halves matter. A recording rendered at a different tempo than the MIDI file states, or
slowed down or sped up afterwards, lines up at the first note and then slides further off every
bar if only the offset is set. When the speed differs, the project tempo is changed to match and
the panel says so ("157 BPM (MIDI says 154)"); when the tempos agree, it stays exactly as it was.
The panel also reports how many sections matched and the accuracy in milliseconds. On synthetic
renders with a known answer, the start and end of the song land within about 1 ms.

The preview also allows for output latency: the audio clock is corrected by how long the sound
takes to reach your speakers or headphones (a quarter of a second on Bluetooth), so the picture
does not run ahead of what you hear.

**The recording sets the length.** Once a recording is loaded, the session runs from its first
sound to its last — not just from the first MIDI note to the last. A reverb or delay tail rings out
in full instead of being cut at the final note-off, and an intro before the first note (a riser, a
vocal, a sample) is played and exported rather than skipped; the time display counts it down from
below zero. The tail is found with a sensitive −60 dB threshold so a fade is heard to silence; the
intro needs −40 dB, so a stray click or hiss ahead of the downbeat does not add dead air. Play,
Return to start, the play bar, *Fit*, page and continuous following, and the export range all use
this span, and removing the recording returns everything to the MIDI's own length.

MP4 exports mux the loaded audio in as AAC at the offset you set, so the file is ready to upload
with no second pass in an editor. WebM and PNG frames are video only.

---

## Tempo

The Visual tab's **Tempo** section re-times the piece. Type a BPM or drag the scale slider: bars
and beats do not move, only how fast you travel through them, so the picture is unchanged while
playback and every video export run at the new speed. Files with tempo changes keep their relative
shape. The reset button returns to the tempo written in the file.

---

## Reading the picture

- **Lanes** — one per MIDI track, in file order. The left panel carries an instrument icon, the
  track name, its classified family and channel, and a colour dot. By default every track is
  squeezed into the frame; set **Tracks in view** in the Visual tab to size the lanes to a fixed
  count and wheel-scroll through the rest. A hairline indicator on the right edge appears whenever
  there is more to scroll to (it is never drawn into an export).
- **Clips** — contiguous runs of notes, split wherever a rest longer than two bars appears. Named
  from the track (`Cello I`, `Cello II`) unless the file supplies better names.
- **Pitch** — vertical. By default each track gets its own pitch window so a cello fills its lane
  instead of being squashed; switch to *Global* in the Visual tab to compare registers across
  instruments on one scale. Drum kits map each sound to an evenly spaced row rather than by
  semitone, which can be turned off.
- **Time** — horizontal, in bars and beats by default, honouring tempo and time-signature changes.
  Seconds and timecode axes are also available.
- **Markers** — real MIDI markers only. Section names are never invented.

---

## Keyboard and mouse

The **Info** button in the toolbar (or `?`) opens a bar with the workflow, the tabs, the thumbnail
editor and every shortcut. `Esc` closes it.

| Input | Action |
| --- | --- |
| `Space` | Play / pause |
| `Enter` or `Shift`+`B` | Back to the beginning (keeps playing if it was) |
| `F` | Fit the whole song |
| `←` / `→` | Seek 2s (`Shift` for 10s) |
| `Esc` | Clear note selection |
| Drag | Pan |
| Wheel | Scroll up and down the tracks |
| `Ctrl` + wheel | Zoom about the cursor |
| `Shift` + wheel | Scroll horizontally |
| Drag the ruler, or `Alt` + drag | Scrub the playhead |
| Click a note | Inspect pitch, velocity, position, duration, channel, track |

The **Preview** button in the toolbar plays a simple Web Audio synth so you can check that the
visuals line up with the music. It is a sanity check, not an instrument — it is not meant to be
recorded.

---

## Architecture

```
MIDI file
  → midi/MidiParser        parse, classify instruments, detect clip regions
  → models/MidiProject     internal model, independent of parser and renderer
  → layout/LayoutEngine    lanes, pitch windows, grid geometry (pure, no drawing)
  → renderer/CanvasRenderer  draws a Scene onto any 2D context
  → export/                same Scene at any resolution → PNG / SVG / WebM / frames

MidiProject (+ recording)
  → thumbnail/SongMood     key, tempo, energy, tension, air (AudioMood adds loudness/brightness/punch)
  → thumbnail/Palette      colours from key, mood and title, then the Colour section's adjustments
  → thumbnail/Recipe       tone, background, shapes, details and composition, weighted by the mood
  → thumbnail/render/      grounds, shapes and details at any resolution, then the title
  → thumbnail/Compose      parts, title, paint and stamps stacked with your edits (thumbnail/Editor)
```

Some specifics worth knowing:

- **One renderer, two consumers.** The interactive canvas and every export build the same `Scene`
  object and call the same `renderScene`. That is what makes an 8K export identical in composition
  to what is on screen.
- **Geometry is authored against a 1080-tall canvas** and scaled from there, so resolution changes
  sharpness, not layout.
- **Viewport culling.** Notes are sorted by start time and located with a binary search, so only
  what is on screen is considered. Notes are then batched by colour into one fill per colour, and
  colour lookup tables are cached and rebuilt only when something that affects them changes.
  A 60,000-note file renders a full-song frame in about 50 ms; zoomed in it is far faster.
- **Playback lives outside React.** The clock is a plain object the render loop reads each frame;
  React only samples it about ten times a second for the readout.

Test fixtures covering the awkward cases — tempo changes, mixed time signatures, percussion on
channel 10, unnamed and empty tracks, 40-bar notes next to 8-tick stabs, duplicate track names,
and a 60,000-note stress file — are generated by:

```bash
npm run make-test-midi
```

They land in `test-midi/`.

---

## Known limits

- MP4 export needs WebCodecs (Chromium-based browsers). WebM recording is real-time capture, so a
  very heavy scene can drop frames — prefer MP4 or the PNG frame sequence when the output has to be
  exact.
- SVG export omits glow, vignette and instrument icons by design, and gets large past roughly
  60,000 notes; the panel warns when your file is over that.
- Preview audio is a basic synth with a 48-voice cap, not a sampler.
- Control changes, pitch bends and lyrics are parsed into the model but not yet drawn.
