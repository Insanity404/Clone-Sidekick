/* ────────────────────────────────────────────────────────────────
 *  Party Mode — guest session store
 *  Sessions are kept in memory and persisted to data/party.json.
 * ──────────────────────────────────────────────────────────────── */

import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './configStore.js';
import type { GuestSession } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.resolve(__dirname, '../../data');
const PARTY_PATH = path.join(DATA_DIR, 'party.json');

const sessions = new Map<string, GuestSession>();

// ── Public API ───────────────────────────────────────────────────

export function createSession(): GuestSession {
  const token      = randomBytes(32).toString('base64url');
  const now        = new Date();
  const hours      = Math.max(1, Math.min(24, config.party.sessionDurationHours));
  const expiresAt  = new Date(now.getTime() + hours * 3_600_000).toISOString();

  const session: GuestSession = {
    token,
    createdAt:   now.toISOString(),
    expiresAt,
    permissions: { ...config.party.defaultPermissions },
  };

  sessions.set(token, session);
  scheduleSave();
  return session;
}

/** Returns the session only if it is valid (not revoked, not expired). */
export function validateSession(token: string): GuestSession | null {
  const s = sessions.get(token);
  if (!s || s.revokedAt) return null;
  if (new Date(s.expiresAt) < new Date()) return null;
  return s;
}

export function revokeSession(token: string): boolean {
  const s = sessions.get(token);
  if (!s) return false;
  s.revokedAt = new Date().toISOString();
  scheduleSave();
  return true;
}

export function revokeAllSessions(): void {
  const now = new Date().toISOString();
  for (const s of sessions.values()) {
    if (!s.revokedAt) s.revokedAt = now;
  }
  scheduleSave();
}

export function getActiveSessions(): GuestSession[] {
  const now = new Date();
  return [...sessions.values()].filter(
    s => !s.revokedAt && new Date(s.expiresAt) >= now,
  );
}

export async function initPartyStore(): Promise<void> {
  try {
    const raw = await fs.readFile(PARTY_PATH, 'utf-8');
    const arr: GuestSession[] = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const s of arr) sessions.set(s.token, s);
    }
  } catch { /* fresh start — no party.json yet */ }
}

// ── Persistence (debounced) ──────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const snapshot = [...sessions.values()];
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(PARTY_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch { /* best-effort */ }
  }, 500);
}
