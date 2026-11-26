import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

/**
 * Saves open songs, looks and settings to disk, in the project's `saved/`
 * folder, through a small API on the dev (and preview) server. Every browser
 * that opens the app — the Claude browser, Opera GX, Chrome — reads and writes
 * the same files, so your work follows you between them.
 *
 *   GET  /api/store/ping
 *   GET  PUT          /api/store/meta | /api/store/looks          (JSON)
 *   GET  PUT  DELETE  /api/store/songs/<id>                       (JSON)
 *   GET  PUT          /api/store/songs/<id>/midi | /audio         (binary)
 *   GET  PUT  DELETE  /api/store/songs/<id>/stem/<trackId>        (binary)
 */

const ID = /^[a-z0-9-]{1,80}$/i;
const MAX_BODY = 1024 * 1024 * 1024; // 1 GB: a long WAV mixdown fits

export function storePlugin(root: string): Plugin {
  const dir = path.join(root, 'saved');
  const songsDir = path.join(dir, 'songs');

  const file = (name: string) => path.join(dir, name);
  const songFile = (id: string, ext: string) => path.join(songsDir, `${id}.${ext}`);

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new Error('Too large');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /** Writes to one file run one after another, so overlapping saves never collide. */
  const queues = new Map<string, Promise<void>>();

  /**
   * Writes beside the target and renames, so a crash never leaves half a
   * file. Windows refuses the rename while the target is being read, so it
   * retries briefly, then writes in place; the temporary file never stays.
   */
  function writeAtomic(target: string, data: Buffer): Promise<void> {
    const run = async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temp, data);
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            await fs.rename(temp, target);
            return;
          } catch (error) {
            if (attempt >= 5) throw error;
            await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
          }
        }
      } catch {
        await fs.writeFile(target, data);
      } finally {
        await fs.rm(temp, { force: true });
      }
    };
    const next = (queues.get(target) ?? Promise.resolve()).then(run, run);
    queues.set(target, next.catch(() => undefined));
    return next;
  }

  /** Sends a saved file. A missing one is 404, or with `quiet` 204 (nothing saved yet, not an error). */
  async function send(res: ServerResponse, target: string, type: string, quiet = false): Promise<void> {
    try {
      const data = await fs.readFile(target);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.end(data);
    } catch {
      res.statusCode = quiet ? 204 : 404;
      res.end();
    }
  }

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/api/store/')) return next();
    const parts = url.slice('/api/store/'.length).split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    void (async () => {
      try {
        if (parts[0] === 'ping') {
          res.setHeader('Content-Type', 'application/json');
          res.end('{"ok":true}');
          return;
        }
        if ((parts[0] === 'meta' || parts[0] === 'looks') && parts.length === 1) {
          const target = file(`${parts[0]}.json`);
          if (method === 'GET') return send(res, target, 'application/json', true);
          if (method === 'PUT') {
            await writeAtomic(target, await readBody(req));
            res.end();
            return;
          }
        }
        if (parts[0] === 'songs' && parts[1] && ID.test(parts[1])) {
          const id = parts[1];
          const part = parts[2];
          if (!part) {
            if (method === 'GET') return send(res, songFile(id, 'json'), 'application/json');
            if (method === 'PUT') {
              await writeAtomic(songFile(id, 'json'), await readBody(req));
              res.end();
              return;
            }
            if (method === 'DELETE') {
              for (const ext of ['json', 'mid', 'audio']) await fs.rm(songFile(id, ext), { force: true });
              // And every stem.
              for (const name of await fs.readdir(songsDir).catch(() => [] as string[])) {
                if (name.startsWith(`${id}.stem-`)) await fs.rm(path.join(songsDir, name), { force: true });
              }
              res.end();
              return;
            }
          }
          if (part === 'stem' && parts[3] && ID.test(parts[3])) {
            const target = songFile(id, `stem-${parts[3]}`);
            if (method === 'GET') return send(res, target, 'application/octet-stream');
            if (method === 'PUT') {
              await writeAtomic(target, await readBody(req));
              res.end();
              return;
            }
            if (method === 'DELETE') {
              await fs.rm(target, { force: true });
              res.end();
              return;
            }
          }
          if (part === 'midi' || part === 'audio') {
            const target = songFile(id, part === 'midi' ? 'mid' : 'audio');
            if (method === 'GET') return send(res, target, 'application/octet-stream');
            if (method === 'PUT') {
              await writeAtomic(target, await readBody(req));
              res.end();
              return;
            }
          }
        }
        res.statusCode = 404;
        res.end();
      } catch (error) {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : 'Store error');
      }
    })();
  };

  return {
    name: 'midi-visualizer-store',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
