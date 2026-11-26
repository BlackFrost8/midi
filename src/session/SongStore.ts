import type { TrackNaming } from '../midi/TrackNaming';
import type { TrackState } from '../models/MidiProject';
import type { ExportSettings, RenderSettings } from '../models/RenderSettings';
import type { ThumbEdits } from '../thumbnail/Editor';
import type { ThumbnailOptions } from '../thumbnail/ThumbnailDesign';

/**
 * Open songs, saved so they are all still there, as you left them, after a
 * reload or in another browser: the MIDI itself, every setting, the thumbnail
 * and its edits, and the recording if one was loaded.
 *
 * Where the app runs from its own server (npm run dev / preview), everything
 * is written to the project's `saved/` folder (see vite-store.ts), so every
 * browser on this computer shares it. Opened with no server, it falls back
 * to this browser's own storage (IndexedDB).
 */

export interface SongAudio {
  file: Blob;
  name: string;
  offset: number;
  volume: number;
  enabled: boolean;
}

/** A track's own audio, so soloing it plays just that part. */
export interface SongStem {
  trackId: string;
  name: string;
  file: Blob;
}

export interface SongSnapshot {
  id: string;
  fileName: string;
  midi: ArrayBuffer;
  settings: RenderSettings;
  trackStates: Array<[string, TrackState]>;
  exportSettings: ExportSettings;
  thumbOptions: ThumbnailOptions;
  thumbEdits: ThumbEdits;
  tempoScale: number;
  trackNaming: TrackNaming;
  audio: SongAudio | null;
  /** Per-track stems (optional; older saves have none). */
  stems?: SongStem[];
}

export interface SongMeta {
  order: string[];
  active: string | null;
}

const DB_NAME = 'midi-visualizer';
const SONGS = 'songs';
const META = 'meta';

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const base = request.result;
        if (!base.objectStoreNames.contains(SONGS)) base.createObjectStore(SONGS, { keyPath: 'id' });
        if (!base.objectStoreNames.contains(META)) base.createObjectStore(META);
      };
      request.onsuccess = () => resolve(request.result);
      // Private windows and blocked storage: the app still works, it just forgets.
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return db().then(
    (base) =>
      new Promise<T | null>((resolve) => {
        if (!base) return resolve(null);
        try {
          const tx = base.transaction(store, mode);
          const request = body(tx.objectStore(store));
          tx.oncomplete = () => resolve(request ? (request.result as T) : null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

function localSaveSong(song: SongSnapshot): Promise<unknown> {
  return run(SONGS, 'readwrite', (s) => s.put(song));
}

function localDeleteSong(id: string): Promise<unknown> {
  return run(SONGS, 'readwrite', (s) => s.delete(id));
}

function localLoadSong(id: string): Promise<SongSnapshot | null> {
  return run<SongSnapshot>(SONGS, 'readonly', (s) => s.get(id));
}

function localSaveMeta(meta: SongMeta): Promise<unknown> {
  return run(META, 'readwrite', (s) => s.put(meta, 'tabs'));
}

function localLoadMeta(): Promise<SongMeta | null> {
  return run<SongMeta>(META, 'readonly', (s) => s.get('tabs'));
}

// ---------------------------------------------------------------------------
// Disk store (shared by every browser)
// ---------------------------------------------------------------------------

const API = '/api/store';
let probe: Promise<boolean> | null = null;

/** Whether the app's server can save to disk. */
export function diskStoreAvailable(): Promise<boolean> {
  if (!probe) {
    probe = fetch(`${API}/ping`, { cache: 'no-store' })
      .then((response) => response.ok && response.headers.get('content-type')?.includes('json') === true)
      .catch(() => false);
  }
  return probe;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

async function put(url: string, body: BodyInit, type: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': type } });
    return response.ok;
  } catch {
    return false;
  }
}

/** Binaries already on disk, so a settings change does not re-upload the MIDI or a big recording. */
const uploaded = new WeakMap<object, string>();

type StoredSong = Omit<SongSnapshot, 'midi' | 'audio' | 'stems'> & {
  audio: Omit<SongAudio, 'file'> | null;
  stems?: Array<Omit<SongStem, 'file'>>;
};

async function diskSaveSong(song: SongSnapshot): Promise<void> {
  const base = `${API}/songs/${song.id}`;
  if (uploaded.get(song.midi) !== song.id && (await put(`${base}/midi`, song.midi, 'application/octet-stream'))) {
    uploaded.set(song.midi, song.id);
  }
  if (song.audio && uploaded.get(song.audio.file) !== song.id && (await put(`${base}/audio`, song.audio.file, 'application/octet-stream'))) {
    uploaded.set(song.audio.file, song.id);
  }
  for (const stem of song.stems ?? []) {
    if (uploaded.get(stem.file) !== song.id && (await put(`${base}/stem/${stem.trackId}`, stem.file, 'application/octet-stream'))) {
      uploaded.set(stem.file, song.id);
    }
  }
  const { midi, audio, stems, ...rest } = song;
  void midi;
  const stored: StoredSong = {
    ...rest,
    audio: audio ? { name: audio.name, offset: audio.offset, volume: audio.volume, enabled: audio.enabled } : null,
    stems: (stems ?? []).map((stem) => ({ trackId: stem.trackId, name: stem.name })),
  };
  await put(base, JSON.stringify(stored), 'application/json');
}

async function diskLoadSong(id: string): Promise<SongSnapshot | null> {
  const base = `${API}/songs/${id}`;
  const stored = await getJson<StoredSong>(base);
  if (!stored) return null;
  try {
    const midiResponse = await fetch(`${base}/midi`, { cache: 'no-store' });
    if (!midiResponse.ok) return null;
    const midi = await midiResponse.arrayBuffer();
    uploaded.set(midi, id);
    let audio: SongAudio | null = null;
    if (stored.audio) {
      const audioResponse = await fetch(`${base}/audio`, { cache: 'no-store' });
      if (audioResponse.ok) {
        const file = await audioResponse.blob();
        uploaded.set(file, id);
        audio = { ...stored.audio, file };
      }
    }
    const stems: SongStem[] = [];
    for (const stem of stored.stems ?? []) {
      const response = await fetch(`${base}/stem/${stem.trackId}`, { cache: 'no-store' });
      if (!response.ok) continue;
      const file = await response.blob();
      uploaded.set(file, id);
      stems.push({ ...stem, file });
    }
    return { ...stored, midi, audio, stems };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The store the app uses
// ---------------------------------------------------------------------------

export async function saveSong(song: SongSnapshot): Promise<unknown> {
  return (await diskStoreAvailable()) ? diskSaveSong(song) : localSaveSong(song);
}

export async function deleteSong(id: string): Promise<unknown> {
  if (await diskStoreAvailable()) {
    try {
      await fetch(`${API}/songs/${id}`, { method: 'DELETE' });
    } catch {
      // Offline: the file stays until the next delete.
    }
    return null;
  }
  return localDeleteSong(id);
}

export async function loadSong(id: string): Promise<SongSnapshot | null> {
  return (await diskStoreAvailable()) ? diskLoadSong(id) : localLoadSong(id);
}

export async function saveMeta(meta: SongMeta): Promise<unknown> {
  return (await diskStoreAvailable()) ? put(`${API}/meta`, JSON.stringify(meta), 'application/json') : localSaveMeta(meta);
}

/**
 * The open tabs. The first time the disk store is used, songs this browser
 * had saved on its own are moved onto disk, so nothing made before is lost.
 */
export async function loadMeta(): Promise<SongMeta | null> {
  if (!(await diskStoreAvailable())) return localLoadMeta();
  const meta = await getJson<SongMeta>(`${API}/meta`);
  if (meta) return meta;
  const local = await localLoadMeta();
  if (!local?.order.length) return null;
  for (const id of local.order) {
    const song = await localLoadSong(id);
    if (song) await diskSaveSong(song);
  }
  await put(`${API}/meta`, JSON.stringify(local), 'application/json');
  return local;
}

export function newSongId(): string {
  return `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Saved looks (small, so localStorage)
// ---------------------------------------------------------------------------

export interface SavedLook {
  id: string;
  name: string;
  /** The visual, colour and glow settings, without anything song-specific. */
  settings: Partial<RenderSettings>;
}

const LOOKS_KEY = 'midi-visualizer:looks';

function localLooks(): SavedLook[] {
  try {
    const raw = localStorage.getItem(LOOKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Saved looks: from disk when the server is there (moving this browser's own looks over the first time). */
export async function loadLooks(): Promise<SavedLook[]> {
  if (!(await diskStoreAvailable())) return localLooks();
  const looks = await getJson<SavedLook[]>(`${API}/looks`);
  if (Array.isArray(looks)) return looks;
  const local = localLooks();
  if (local.length) await put(`${API}/looks`, JSON.stringify(local), 'application/json');
  return local;
}

export async function saveLooks(looks: SavedLook[]): Promise<void> {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
  } catch {
    // Storage full or blocked: the disk copy (if any) still has them.
  }
  if (await diskStoreAvailable()) await put(`${API}/looks`, JSON.stringify(looks), 'application/json');
}
