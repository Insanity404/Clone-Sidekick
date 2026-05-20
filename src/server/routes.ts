/* ────────────────────────────────────────────────────────────────
 *  API routes - mounted at /api
 * ──────────────────────────────────────────────────────────────── */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import QRCode from 'qrcode';
import { searchCharts, advancedSearchCharts } from './enchor.js';
import {
  enqueueDownload,
  getQueueSnapshot,
  removeDownload,
  subscribeSSE,
  enrichSingleDownload,
} from './downloadManager.js';
import { requireAuth, requireAdmin, isAdmin, getGuestSession } from './auth.js';
import { config, saveConfig } from './configStore.js';
import {
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
  getActiveSessions,
} from './partyStore.js';
import type {
  SearchRequest,
  AdvancedSearchRequest,
  ChartResult,
  UserInfo,
  UserPrefs,
  PartyConfig,
} from '../shared/types.js';

export const apiRouter = Router();

// Every API route requires auth (unless disabled)
apiRouter.use(requireAuth);

// ── Search (guests need canBrowseSources) ────────────────────────

apiRouter.post('/search', async (req: Request, res: Response) => {
  const guest = getGuestSession(req);
  if (guest && !guest.permissions.canBrowseSources) {
    res.status(403).json({ error: 'Search is not permitted for guests' });
    return;
  }
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
  const guest = getGuestSession(req);
  if (guest && !guest.permissions.canBrowseSources) {
    res.status(403).json({ error: 'Search is not permitted for guests' });
    return;
  }
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

// ── Download (guests need canDownload) ───────────────────────────

apiRouter.post('/download', async (req: Request, res: Response) => {
  const guest = getGuestSession(req);
  if (guest && !guest.permissions.canDownload) {
    res.status(403).json({ error: 'Downloading is not permitted for guests' });
    return;
  }
  try {
    const chart: ChartResult = req.body;
    if (!chart?.md5) {
      res.status(400).json({ error: 'Missing chart data (md5 required)' });
      return;
    }
    const session = req.session as any;
    const prefs: UserPrefs = session.prefs ?? DEFAULT_PREFS;
    const addedBy = guest
      ? { type: 'guest' as const, guestToken: guest.token }
      : { type: 'admin' as const };
    enqueueDownload(chart, { format: prefs.downloadFormat, skipVideo: !prefs.downloadVideoBackground }, addedBy);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

apiRouter.delete('/download/:md5', async (req: Request, res: Response) => {
  const md5 = req.params.md5 as string;
  const deleteFiles = req.query['deleteFiles'] === 'true';
  const guest = getGuestSession(req);

  if (guest) {
    const { deleteMode } = guest.permissions;
    if (deleteMode === 'none') {
      res.status(403).json({ error: 'Deleting is not permitted for guests' });
      return;
    }
    if (deleteMode === 'own') {
      const dp = getQueueSnapshot().find(d => d.md5 === md5);
      if (dp?.addedBy?.guestToken !== guest.token) {
        res.status(403).json({ error: 'You can only delete songs you added' });
        return;
      }
    }
  }

  if (deleteFiles) {
    const dp = getQueueSnapshot().find(d => d.md5 === md5);
    const destPath = dp?.destinationPath;

    if (destPath) {
      const songsDir = config.cloneHeroSongsDir;
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

apiRouter.get('/downloads', (req: Request, res: Response) => {
  const guest = getGuestSession(req);
  if (guest && !guest.permissions.canBrowseLibrary) {
    res.status(403).json({ error: 'Library access is not permitted for guests' });
    return;
  }
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

// ── Download progress SSE stream ─────────────────────────────────

apiRouter.get('/downloads/stream', (req: Request, res: Response) => {
  const guest = getGuestSession(req);
  if (guest && !guest.permissions.canBrowseLibrary && !guest.permissions.canDownload) {
    res.status(403).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  for (const dp of getQueueSnapshot()) {
    res.write(`data: ${JSON.stringify(dp)}\n\n`);
  }

  const unsub = subscribeSSE(dp => {
    res.write(`data: ${JSON.stringify(dp)}\n\n`);
  });

  req.on('close', unsub);
});

// ── Local album art ───────────────────────────────────────────────

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

// ── Song count ────────────────────────────────────────────────────

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

// ── User preferences ──────────────────────────────────────────────

const DEFAULT_PREFS: UserPrefs = {
  instrument: null,
  difficulty: null,
  emhxOnly: false,
  downloadFormat: 'folder',
  downloadVideoBackground: false,
};

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

// ── Config (non-sensitive) ────────────────────────────────────────

apiRouter.get('/config', (_req: Request, res: Response) => {
  res.json({
    songsDir: config.cloneHeroSongsDir || null,
    authMode: config.auth.mode,
    authEnabled: config.auth.mode === 'google' && !!config.auth.google.clientId,
    partyEnabled: config.party.enabled,
  });
});

// ── Current user ──────────────────────────────────────────────────

apiRouter.get('/me', (req: Request, res: Response) => {
  if (isAdmin(req)) {
    if (config.auth.mode === 'none') {
      res.json({ email: 'local', displayName: 'Local User' } satisfies UserInfo);
    } else {
      res.json(req.user);
    }
    return;
  }
  const guest = getGuestSession(req);
  if (guest) {
    res.json({
      email: 'guest',
      displayName: 'Guest',
      isGuest: true,
      permissions: guest.permissions,
    } satisfies UserInfo);
    return;
  }
  res.status(401).json({ error: 'Not authenticated' });
});

// ── Party Mode (admin only) ───────────────────────────────────────

apiRouter.get('/party', requireAdmin, (_req: Request, res: Response) => {
  res.json({
    config: config.party,
    sessions: getActiveSessions(),
  });
});

apiRouter.put('/party/config', requireAdmin, async (req: Request, res: Response) => {
  const incoming = req.body as Partial<PartyConfig>;

  const updated: PartyConfig = {
    enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : config.party.enabled,
    sessionDurationHours: (typeof incoming.sessionDurationHours === 'number' && incoming.sessionDurationHours >= 1 && incoming.sessionDurationHours <= 24)
      ? incoming.sessionDurationHours
      : config.party.sessionDurationHours,
    defaultPermissions: incoming.defaultPermissions
      ? {
          canBrowseSources: Boolean(incoming.defaultPermissions.canBrowseSources),
          canBrowseLibrary: Boolean(incoming.defaultPermissions.canBrowseLibrary),
          canDownload: Boolean(incoming.defaultPermissions.canDownload),
          deleteMode: ['none', 'own', 'any'].includes(incoming.defaultPermissions.deleteMode as string)
            ? incoming.defaultPermissions.deleteMode
            : config.party.defaultPermissions.deleteMode,
        }
      : config.party.defaultPermissions,
  };

  if (!updated.enabled) revokeAllSessions();

  await saveConfig({ ...config, party: updated });
  res.json({ ok: true, config: updated });
});

apiRouter.post('/party/sessions', requireAdmin, (req: Request, res: Response) => {
  if (!config.party.enabled) {
    res.status(400).json({ error: 'Party mode is not enabled' });
    return;
  }
  const session = createSession();
  const base = config.tunnel.enabled && config.tunnel.hostname
    ? `https://${config.tunnel.hostname}`
    : `http://localhost:${config.port}`;
  const joinUrl = `${base}/guest/join/${session.token}`;
  res.json({ session, joinUrl });
});

apiRouter.get('/party/sessions/:token/qr', requireAdmin, async (req: Request, res: Response) => {
  const token = req.params['token'] as string;
  const session = validateSession(token);
  if (!session) { res.status(404).json({ error: 'Session not found or expired' }); return; }

  const base = config.tunnel.enabled && config.tunnel.hostname
    ? `https://${config.tunnel.hostname}`
    : `http://localhost:${config.port}`;
  const joinUrl = `${base}/guest/join/${token}`;

  try {
    const dataUrl = await QRCode.toDataURL(joinUrl, { width: 280, margin: 2 });
    res.json({ dataUrl, joinUrl });
  } catch {
    res.status(500).json({ error: 'QR code generation failed' });
  }
});

apiRouter.delete('/party/sessions/:token', requireAdmin, (req: Request, res: Response) => {
  const revoked = revokeSession(req.params['token'] as string);
  res.json({ ok: revoked });
});

apiRouter.delete('/party/sessions', requireAdmin, (_req: Request, res: Response) => {
  revokeAllSessions();
  res.json({ ok: true });
});
