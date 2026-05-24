/* ────────────────────────────────────────────────────────────────
 *  Setup API routes - mounted at /setup-api (no auth required)
 *  Handles first-run wizard config reads and writes.
 * ──────────────────────────────────────────────────────────────── */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { config, saveConfig, isConfigComplete } from './configStore.js';
import { setupAuth } from './auth.js';
import { startTunnel } from './tunnel.js';
import type { AppConfig } from '../shared/types.js';

export const setupRouter = Router();

// ── Status ──────────────────────────────────────────────────────

setupRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    needsSetup: !isConfigComplete(config),
    platform: process.platform,
    // Send current (non-secret) config so wizard can pre-populate fields
    current: safeConfig(),
  });
});

// ── Platform-aware defaults ──────────────────────────────────────

setupRouter.get('/defaults', async (_req: Request, res: Response) => {
  const home = os.homedir();
  let songsDirSuggestion: string;

  if (process.platform === 'win32') {
    // On Windows with OneDrive, Documents is often redirected to OneDrive\Documents.
    // Try candidate paths in order and return the first one that actually exists.
    const candidates = [
      path.join(home, 'OneDrive', 'Documents', 'Clone Hero', 'Songs'),
      path.join(home, 'Documents', 'Clone Hero', 'Songs'),
    ];
    songsDirSuggestion = candidates[candidates.length - 1]; // fallback
    for (const candidate of candidates) {
      try {
        await fs.stat(candidate);
        songsDirSuggestion = candidate; // found one that exists
        break;
      } catch { /* try next */ }
    }
  } else if (process.platform === 'darwin') {
    songsDirSuggestion = path.join(home, 'Documents', 'Clone Hero', 'Songs');
  } else {
    songsDirSuggestion = path.join(home, 'Clone Hero', 'Songs');
  }

  // Try to auto-detect the Clone Hero installation directory
  const installDirSuggestion = await detectCloneHeroInstall();

  res.json({ songsDirSuggestion, installDirSuggestion: installDirSuggestion ?? '' });
});

// ── Validate directory ───────────────────────────────────────────

setupRouter.post('/validate-dir', async (req: Request, res: Response) => {
  const { dir } = req.body as { dir: string };
  if (!dir) { res.json({ ok: false, error: 'No path provided' }); return; }

  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      res.json({ ok: false, error: 'Path exists but is not a directory' });
      return;
    }
    // Verify we can read it
    await fs.readdir(dir);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // Directory doesn't exist yet - allowed (Clone Hero may not have run yet)
      res.json({ ok: true, warning: 'Directory not found - it will be created on first download' });
    } else {
      res.json({ ok: false, error: err.message });
    }
  }
});

// ── Save config ──────────────────────────────────────────────────

setupRouter.post('/save', async (req: Request, res: Response) => {
  const incoming = req.body as Partial<AppConfig>;

  // Build new config by merging over current
  // The Settings UI displays a masked secret (••••xxxx). If the incoming value
  // still looks masked, the user didn't change it — keep the real stored secret.
  const isMasked = (s: string | undefined) => !s || s.startsWith('••••');
  const next: AppConfig = {
    ...config,
    cloneHeroSongsDir:   incoming.cloneHeroSongsDir   ?? config.cloneHeroSongsDir,
    cloneHeroInstallDir: incoming.cloneHeroInstallDir ?? config.cloneHeroInstallDir,
    yargSongsDir:        incoming.yargSongsDir        ?? config.yargSongsDir,
    auth: {
      mode: incoming.auth?.mode ?? config.auth.mode,
      google: {
        clientId:      incoming.auth?.google?.clientId      ?? config.auth.google.clientId,
        clientSecret:  isMasked(incoming.auth?.google?.clientSecret)
          ? config.auth.google.clientSecret
          : incoming.auth!.google!.clientSecret!,
        callbackUrl:   incoming.auth?.google?.callbackUrl   ?? config.auth.google.callbackUrl,
        allowedEmails: incoming.auth?.google?.allowedEmails ?? config.auth.google.allowedEmails,
      },
    },
    tunnel: {
      enabled:  incoming.tunnel?.enabled  ?? config.tunnel.enabled,
      hostname: incoming.tunnel?.hostname ?? config.tunnel.hostname,
      token:    isMasked(incoming.tunnel?.token)
        ? config.tunnel.token
        : (incoming.tunnel?.token ?? config.tunnel.token),
    },
  };

  // Allow port change; detect if restart is needed
  const portChanged = incoming.port !== undefined && incoming.port !== config.port;
  if (incoming.port) next.port = incoming.port;

  // Auto-compute the correct callback URL based on tunnel settings
  // (the user can't know the final URL during the auth step since tunnel comes after)
  if (next.tunnel.enabled && next.tunnel.hostname) {
    next.auth.google.callbackUrl = `https://${next.tunnel.hostname}/auth/google/callback`;
  } else {
    next.auth.google.callbackUrl = `http://localhost:${next.port}/auth/google/callback`;
  }

  // Validate
  if (!next.cloneHeroSongsDir) {
    res.status(400).json({ error: 'Songs directory is required' });
    return;
  }
  if (next.auth.mode === 'google' && (!next.auth.google.clientId || !next.auth.google.clientSecret)) {
    res.status(400).json({ error: 'Google Client ID and Secret are required when using Google auth' });
    return;
  }

  await saveConfig(next);

  // If Google auth was just enabled/reconfigured, re-register Passport strategy
  if (next.auth.mode === 'google') {
    setupAuth();
  }

  // Start tunnel if enabled (token mode only - routing configured in Cloudflare dashboard)
  if (next.tunnel.enabled && next.tunnel.token && !portChanged) {
    startTunnel();
  }

  const externalUrl = next.tunnel.enabled && next.tunnel.hostname
    ? `https://${next.tunnel.hostname}`
    : undefined;

  res.json({ ok: true, restartRequired: portChanged, externalUrl });
});

// ── Helpers ──────────────────────────────────────────────────────

/** Try to find the Clone Hero installation directory by checking common locations. */
async function detectCloneHeroInstall(): Promise<string | null> {
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const drives = ['C:', 'D:', 'E:'];
    for (const d of drives) {
      candidates.push(
        `${d}\\Program Files\\Clone Hero`,
        `${d}\\Program Files (x86)\\Clone Hero`,
        `${d}\\Clone Hero`,
        `${d}\\Games\\Clone Hero`,
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Clone Hero.app/Contents');
  } else {
    candidates.push(
      `${os.homedir()}/Clone Hero`,
      `${os.homedir()}/Games/Clone Hero`,
    );
  }

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, 'Clone Hero_Data'));
      return candidate;
    } catch { /* not here */ }
  }
  return null;
}

/** Config object safe to send to the client - strips secrets. */
function safeConfig() {
  return {
    port: config.port,
    cloneHeroSongsDir:   config.cloneHeroSongsDir,
    cloneHeroInstallDir: config.cloneHeroInstallDir,
    yargSongsDir:        config.yargSongsDir,
    auth: {
      mode: config.auth.mode,
      google: {
        clientId: config.auth.google.clientId,
        // Mask secret - show only last 4 chars if set
        clientSecret: config.auth.google.clientSecret
          ? '••••' + config.auth.google.clientSecret.slice(-4)
          : '',
        callbackUrl: config.auth.google.callbackUrl,
        allowedEmails: config.auth.google.allowedEmails,
      },
    },
    tunnel: {
      enabled: config.tunnel.enabled,
      hostname: config.tunnel.hostname,
      // Mask token — show only last 4 chars if set
      token: config.tunnel.token
        ? '••••' + config.tunnel.token.slice(-4)
        : '',
    },
  };
}

