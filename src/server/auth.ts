/* ────────────────────────────────────────────────────────────────
 *  Google OAuth 2.0 with Passport.js
 * ──────────────────────────────────────────────────────────────── */

import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { config } from './configStore.js';
import type { UserInfo } from '../shared/types.js';

export function setupAuth() {
  if (config.auth.mode !== 'google') return;
  if (!config.auth.google.clientId || !config.auth.google.clientSecret) {
    console.warn(
      '⚠  Google OAuth credentials not configured - auth is effectively disabled.\n' +
      '   Complete setup at http://localhost:' + config.port + '/setup\n',
    );
    return;
  }

  // Unregister any existing strategy so setupAuth() is safe to call again
  // after the wizard updates credentials mid-run.
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

/** Express middleware - rejects unauthenticated requests with 401. */
export function requireAuth(req: any, res: any, next: () => void) {
  if (config.auth.mode === 'none') return next();
  if (config.auth.mode === 'google' && !config.auth.google.clientId) return next();
  if (req.isAuthenticated?.()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}
