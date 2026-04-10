/* ────────────────────────────────────────────────────────────────
 *  Setup API routes - mounted at /setup-api (no auth required)
 *  Handles first-run wizard config reads and writes.
 * ──────────────────────────────────────────────────────────────── */

import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);
import { config, saveConfig, isConfigComplete, generateDefaultConfig } from './configStore.js';
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

  res.json({ songsDirSuggestion });
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
  const next: AppConfig = {
    ...config,
    cloneHeroSongsDir: incoming.cloneHeroSongsDir ?? config.cloneHeroSongsDir,
    auth: {
      mode: incoming.auth?.mode ?? config.auth.mode,
      google: {
        clientId:      incoming.auth?.google?.clientId      ?? config.auth.google.clientId,
        clientSecret:  incoming.auth?.google?.clientSecret  ?? config.auth.google.clientSecret,
        callbackUrl:   incoming.auth?.google?.callbackUrl   ?? config.auth.google.callbackUrl,
        allowedEmails: incoming.auth?.google?.allowedEmails ?? config.auth.google.allowedEmails,
      },
    },
    tunnel: {
      enabled:  incoming.tunnel?.enabled  ?? config.tunnel.enabled,
      hostname: incoming.tunnel?.hostname ?? config.tunnel.hostname,
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

  // Write cloudflared.yml and start tunnel if enabled
  if (next.tunnel.enabled && next.tunnel.hostname) {
    await writeCloudflaredConfig(next);
    if (!portChanged) startTunnel();
  }

  const externalUrl = next.tunnel.enabled && next.tunnel.hostname
    ? `https://${next.tunnel.hostname}`
    : undefined;

  res.json({ ok: true, restartRequired: portChanged, externalUrl });
});

// ── Helpers ──────────────────────────────────────────────────────

/** Config object safe to send to the client - strips secrets. */
function safeConfig() {
  return {
    port: config.port,
    cloneHeroSongsDir: config.cloneHeroSongsDir,
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
    tunnel: config.tunnel,
  };
}

async function writeCloudflaredConfig(cfg: AppConfig): Promise<void> {
  const cfDir = path.join(os.homedir(), '.cloudflared');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
  const TUNNEL_NAME = 'sidekick';

  let tunnelId = '';
  let credsFile = '';

  // 1. Look for an existing tunnel credential in ~/.cloudflared
  try {
    const files = await fs.readdir(cfDir);
    const credFiles = files.filter(f => UUID_RE.test(f));

    if (credFiles.length === 1) {
      tunnelId = credFiles[0].replace('.json', '');
      credsFile = path.join(cfDir, credFiles[0]);
    } else if (credFiles.length > 1) {
      const stats = await Promise.all(
        credFiles.map(async f => ({ f, mtime: (await fs.stat(path.join(cfDir, f))).mtime }))
      );
      stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      tunnelId = stats[0].f.replace('.json', '');
      credsFile = path.join(cfDir, stats[0].f);
    }
  } catch { /* ~/.cloudflared doesn't exist yet */ }

  // 2. If no credentials found, try to find or create the tunnel via cloudflared CLI
  if (!tunnelId) {
    // Check if a tunnel named "sidekick" already exists
    try {
      const { stdout } = await execFileAsync('cloudflared', ['tunnel', 'list', '-o', 'json']);
      const tunnels = JSON.parse(stdout);
      const existing = tunnels?.find((t: any) => t.name === TUNNEL_NAME && !t.deleted_at);
      if (existing) {
        tunnelId = existing.id;
        credsFile = path.join(cfDir, `${tunnelId}.json`);
        console.log(`  ✔  Found existing tunnel "${TUNNEL_NAME}": ${tunnelId}`);
      }
    } catch { /* cloudflared not installed or not logged in */ }

    // Still nothing? Create a new tunnel
    if (!tunnelId) {
      try {
        const { stdout, stderr } = await execFileAsync('cloudflared', ['tunnel', 'create', TUNNEL_NAME]);
        const output = stdout + stderr;
        const match = output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (match) {
          tunnelId = match[1];
          credsFile = path.join(cfDir, `${tunnelId}.json`);
          console.log(`  ✔  Created tunnel "${TUNNEL_NAME}": ${tunnelId}`);
        }
      } catch (e: any) {
        console.warn('  ⚠  Could not create cloudflared tunnel:', e.stderr || e.message);
        console.warn('     Make sure cloudflared is installed and you have run: cloudflared tunnel login');
        return;
      }
    }
  }

  if (!tunnelId) {
    console.warn('  ⚠  No cloudflared credentials found and could not create tunnel.');
    console.warn('     Run: cloudflared tunnel login && cloudflared tunnel create sidekick');
    return;
  }

  // 3. Write cloudflared.yml
  const yml = [
    '# Generated by Clone Sidekick — ' + new Date().toISOString(),
    'tunnel: ' + tunnelId,
    'credentials-file: ' + credsFile,
    'ingress:',
    '  - hostname: ' + cfg.tunnel.hostname,
    '    service: http://localhost:' + cfg.port,
    '    originRequest:',
    '      noTLSVerify: true',
    '  - service: http_status:404',
  ].join('\n');

  try {
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');
    const __dirname2 = dirname(fileURLToPath(import.meta.url));
    const outPath = path.resolve(__dirname2, '../../cloudflared.yml');
    await fs.writeFile(outPath, yml, 'utf-8');
    console.log('  ✔  Written cloudflared.yml (tunnel: ' + tunnelId + ')');
  } catch (e) {
    console.warn('  ⚠  Could not write cloudflared.yml:', e);
  }

  // 4. Ensure DNS CNAME points to the (possibly new) tunnel
  try {
    await execFileAsync('cloudflared', [
      'tunnel', 'route', 'dns', '--overwrite-dns', tunnelId, cfg.tunnel.hostname,
    ]);
    console.log('  ✔  DNS route updated: ' + cfg.tunnel.hostname + ' → ' + tunnelId);
  } catch (e: any) {
    if (e.stderr?.includes('already configured')) {
      console.log('  ✔  DNS route already points to tunnel ' + tunnelId);
    } else {
      console.warn('  ⚠  Could not update DNS route:', e.stderr || e.message);
    }
  }
}
