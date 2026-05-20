/* ────────────────────────────────────────────────────────────────
 *  Google OAuth 2.0 with Passport.js + guest session helpers
 * ──────────────────────────────────────────────────────────────── */

import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { Request, Response, NextFunction } from 'express';
import { config } from './configStore.js';
import { validateSession } from './partyStore.js';
import type { UserInfo, GuestSession } from '../shared/types.js';

export function setupAuth() {
  if (config.auth.mode !== 'google') return;
  if (!config.auth.google.clientId || !config.auth.google.clientSecret) {
    console.warn(
      '⚠  Google OAuth credentials not configured - auth is effectively disabled.\n' +
      '   Complete setup at http://localhost:' + config.port + '/setup\n',
    );
    return;
  }

  try { passport.unuse('google'); } catch { /* not registered yet */ }

  passport.use(
    new GoogleStrategy(
      {
        clientID: config.auth.google.clientId,
        clientSecret: config.auth.google.clientSecret,
        callbackURL: config.auth.google.callbackUrl,
      },
      (_accessToken, _refreshToken, profile: Profile, done) => {
        const email = profile.emails?.[0]?.value?.toLowerCase() ?? '';

        if (
          config.auth.google.allowedEmails.length > 0 &&
          !config.auth.google.allowedEmails.includes(email)
        ) {
          return done(null, false, { message: 'Email not in allow-list' });
        }

        const user: UserInfo = {
          email,
          displayName: profile.displayName ?? email,
          photo: profile.photos?.[0]?.value,
        };

        return done(null, user);
      },
    ),
  );
}

// ── Admin / guest identity helpers ───────────────────────────────

export function isAdmin(req: Request): boolean {
  if (config.auth.mode === 'none') return true;
  if (config.auth.mode === 'google' && !config.auth.google.clientId) return true;
  return req.isAuthenticated?.() ?? false;
}

export function getGuestSession(req: Request): GuestSession | null {
  const token = (req.session as any)?.guestToken as string | undefined;
  if (!token) return null;
  return validateSession(token);
}

// ── Middleware ───────────────────────────────────────────────────

/** Allows authenticated admins OR guests with a valid session token. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAdmin(req)) return next();
  if (getGuestSession(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

/** Allows admins only — guests are rejected with 403. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (isAdmin(req)) return next();
  res.status(403).json({ error: 'Admin access required' });
}
