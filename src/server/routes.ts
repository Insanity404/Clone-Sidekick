/* ────────────────────────────────────────────────────────────────
 *  API routes - mounted at /api
 * ──────────────────────────────────────────────────────────────── */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { searchCharts, advancedSearchCharts } from './enchor.js';
import {
  enqueueDownload,
  getQueueSnapshot,
  removeDownload,
  subscribeSSE,
  enrichSingleDownload,
} from './downloadManager.js';
import { requireAuth } from './auth.js';
import { config } from './configStore.js';
import type { SearchRequest, AdvancedSearchRequest, ChartResult, UserInfo, UserPrefs } from '../shared/types';

export const apiRouter = Router();

// Every API route requires auth (unless disabled)
apiRouter.use(requireAuth);

// ── Search ──────────────────────────────────────────────────────

apiRouter.post('/search', async (req: Request, res: Response) => {
  try {
    const body: SearchRequest = req.body;
    if (!body.search) body.search = '*';
    if (!body.page) body.page = 1;
    const result = await searchCharts(body);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

apiRouter.post('/advancedSearch', async (req: Request, res: Response) => {
  try {
    const body: AdvancedSearchRequest = req.body;
    if (!body.page) body.page = 1;
    const result = await advancedSearchCharts(body);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// ── Download ────────────────────────────────────────────────────

apiRouter.post('/download', async (req: Request, res: Response) => {
  try {
    const chart: ChartResult = req.body;
    if (!chart?.md5) {
      res.status(400).json({ error: 'Missing chart data (md5 required)' });
      return;
    }
    const session = req.session as any;
    const prefs: UserPrefs = session.prefs ?? DEFAULT_PREFS;
    enqueueDownload(chart, {
      format: prefs.downloadFormat,
      skipVideo: !prefs.downloadVideoBackground,
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

apiRouter.delete('/download/:md5', async (req: Request, res: Response) => {
  const md5 = req.params.md5 as string;
  const deleteFiles = req.query['deleteFiles'] === 'true';

  if (deleteFiles) {
    const dp = getQueueSnapshot().find(d => d.md5 === md5);
    const destPath = dp?.destinationPath;

    if (destPath) {
      const songsDir = config.cloneHeroSongsDir;
      // Safety: only delete if path is inside the configured songs directory
      const resolved = path.resolve(destPath);
      const resolvedBase = songsDir ? path.resolve(songsDir) : null;

      if (!resolvedBase || !resolved.startsWith(resolvedBase + path.sep)) {
        res.status(403).json({ error: 'Path is outside songs directory' });
        return;
      }

      try {
        await fs.rm(resolved, { recursive: true, force: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: `Failed to delete files: ${msg}` });
        return;
      }
    }
  }

  removeDownload(md5);
  res.json({ ok: true });
});

apiRouter.get('/downloads', (_req: Request, res: Response) => {
  res.json(getQueueSnapshot());
});

apiRouter.post('/enrich/:md5', async (req: Request, res: Response) => {
  try {
    const md5 = req.params.md5 as string;
    const enriched = await enrichSingleDownload(md5);
    res.json({ ok: true, enriched });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Download progress SSE stream ────────────────────────────────

apiRouter.get('/downloads/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send current state first
  for (const dp of getQueueSnapshot()) {
    res.write(`data: ${JSON.stringify(dp)}\n\n`);
  }

  const unsub = subscribeSSE(dp => {
    res.write(`data: ${JSON.stringify(dp)}\n\n`);
  });

  req.on('close', unsub);
});

// ── Local album art (served from downloaded song folder) ────────

apiRouter.get('/art/local/:md5', async (req: Request, res: Response) => {
  const md5 = req.params.md5 as string;
  const dp = getQueueSnapshot().find(d => d.md5 === md5);
  const destPath = dp?.destinationPath;

  if (!destPath) { res.status(404).end(); return; }

  const songsDir = config.cloneHeroSongsDir;
  const resolved = path.resolve(destPath);
  const resolvedBase = songsDir ? path.resolve(songsDir) : null;

  if (!resolvedBase || !resolved.startsWith(resolvedBase + path.sep)) {
    res.status(403).end(); return;
  }

  // Try common album art filenames
  for (const name of ['album.jpg', 'album.png', 'Album.jpg', 'Album.png']) {
    const artPath = path.join(resolved, name);
    try {
      await fs.access(artPath);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.sendFile(artPath);
      return;
    } catch { /* try next */ }
  }
  res.status(404).end();
});

// ── Song count ─────────────────────────────────────────────────

apiRouter.get('/song-count', async (_req: Request, res: Response) => {
  const songsDir = config.cloneHeroSongsDir;
  if (!songsDir) { res.json({ count: 18 }); return; }
  try {
    const entries = await fs.readdir(songsDir, { withFileTypes: true });
    const dirCount = entries.filter(e => e.isDirectory()).length;
    res.json({ count: dirCount + 18 });
  } catch {
    res.json({ count: 18 });
  }
});

// ── User preferences ────────────────────────────────────────────

const DEFAULT_PREFS: UserPrefs = { instrument: null, difficulty: null, emhxOnly: false, downloadFormat: 'folder', downloadVideoBackground: false };

apiRouter.get('/prefs', (req: Request, res: Response) => {
  const session = req.session as any;
  res.json(session.prefs ?? DEFAULT_PREFS);
});

apiRouter.put('/prefs', (req: Request, res: Response) => {
  const session = req.session as any;
  const incoming = req.body as Partial<UserPrefs>;
  session.prefs = {
    instrument: incoming.instrument ?? null,
    difficulty: incoming.difficulty ?? null,
    emhxOnly: typeof incoming.emhxOnly === 'boolean' ? incoming.emhxOnly : false,
    downloadFormat: incoming.downloadFormat === 'sng' ? 'sng' : 'folder',
    downloadVideoBackground: typeof incoming.downloadVideoBackground === 'boolean' ? incoming.downloadVideoBackground : false,
  } satisfies UserPrefs;
  res.json(session.prefs);
});

// ── Config (non-sensitive) ──────────────────────────────────────

apiRouter.get('/config', (_req: Request, res: Response) => {
  res.json({
    songsDir: config.cloneHeroSongsDir || null,
    authMode: config.auth.mode,
    authEnabled: config.auth.mode === 'google' && !!config.auth.google.clientId,
  });
});

// ── Current user ────────────────────────────────────────────────

apiRouter.get('/me', (req: Request, res: Response) => {
  if (config.auth.mode === 'none') {
    res.json({ email: 'local', displayName: 'Local User' } satisfies UserInfo);
    return;
  }
  if (req.isAuthenticated?.()) {
    res.json(req.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});
