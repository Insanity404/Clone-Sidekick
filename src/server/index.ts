/* ────────────────────────────────────────────────────────────────
 *  Clone Sidekick - Express server entry point
 * ──────────────────────────────────────────────────────────────── */

import express from 'express';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { config, initConfig, isConfigComplete } from './configStore.js';
import { setupAuth } from './auth.js';
import { apiRouter } from './routes.js';
import { setupRouter } from './setupRoutes.js';
import { initQueue } from './downloadManager.js';
import { startTunnel, stopTunnel } from './tunnel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load config (must happen before anything reads `config`) ─────
await initConfig();

const app = express();

// ── Trust proxy (required behind cloudflared / reverse proxy) ────
app.set('trust proxy', 1);

// ── Body parsing ────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── Setup API (no auth - reachable before wizard completes) ─────
app.use('/setup-api', setupRouter);

// ── Sessions ────────────────────────────────────────────────────
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: 'auto' as any,
      httpOnly: true,
      sameSite: 'lax',
    },
  }),
);

// ── Passport (always initialise; strategy only registered if Google auth) ──
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj: any, done) => done(null, obj));
app.use(passport.initialize());
app.use(passport.session());

// Register Google strategy if configured
setupAuth();

// ── Auth routes (only active when Google auth is configured) ─────
app.get('/auth/google', (req, res, next) => {
  if (config.auth.mode !== 'google') { res.status(404).end(); return; }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (config.auth.mode !== 'google') { res.status(404).end(); return; }
  passport.authenticate('google', { failureRedirect: '/login?error=denied' })(req, res, next);
}, (_req, res) => res.redirect('/'));

app.get('/auth/logout', (req, res) => {
  req.logout?.(() => {});
  res.redirect('/');
});

// ── Setup gate middleware ────────────────────────────────────────
app.use((req, res, next) => {
  if (isConfigComplete(config)) return next();
  if (
    req.path.startsWith('/setup-api') ||
    req.path.startsWith('/assets') ||
    /\.[a-z0-9]+$/i.test(req.path)
  ) {
    return next();
  }
  if (req.path === '/setup' || req.path === '/') return next();
  res.redirect('/setup');
});

// ── API ─────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Serve React client (production) ─────────────────────────────
const clientDir = path.resolve(__dirname, '../../dist/client');
app.use(express.static(clientDir));

// SPA fallback - any non-API route gets index.html
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────
await initQueue();
app.listen(config.port, '0.0.0.0', () => {
  const setupNeeded = !isConfigComplete(config);
  console.log(`\n  🎸 Clone Sidekick running at http://localhost:${config.port}`);
  if (setupNeeded) {
    console.log(`\n  ⚙  First run detected - open the URL above to complete setup.\n`);
    return;
  }
  console.log(`     LAN: http://${getLocalIP()}:${config.port}`);
  if (config.auth.mode === 'none') {
    console.log('     ⚠  Authentication is DISABLED');
  }
  console.log();

  // Start cloudflared tunnel if configured
  if (config.tunnel.enabled && config.tunnel.hostname) {
    startTunnel();
  }


});

// ── Graceful shutdown ────────────────────────────────────────────

function shutdown() {
  stopTunnel();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Helpers ─────────────────────────────────────────────────────

function getLocalIP(): string {
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
