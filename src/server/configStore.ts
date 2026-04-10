/* ────────────────────────────────────────────────────────────────
 *  Config store - reads/writes data/config.json
 *  Sensitive fields (Google credentials, session secret) are
 *  encrypted at rest using AES-256-GCM with a key stored in
 *  data/.key (separate file, already gitignored via data/*).
 * ──────────────────────────────────────────────────────────────── */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import dotenv from 'dotenv';
import type { AppConfig } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR    = path.resolve(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const KEY_PATH    = path.join(DATA_DIR, '.key');
const ENV_PATH    = path.resolve(__dirname, '../../.env');

// ── Mutable singleton ────────────────────────────────────────────

export const config: AppConfig = generateDefaultConfig();

// ── Encryption ───────────────────────────────────────────────────

// Fields encrypted before writing to disk, decrypted after reading.
const SENSITIVE_FIELDS = [
  'sessionSecret',
  'auth.google.clientId',
  'auth.google.clientSecret',
] as const;

const ENC_PREFIX = 'enc:';

let _encKey: Buffer | null = null;

async function getEncKey(): Promise<Buffer> {
  if (_encKey) return _encKey;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(KEY_PATH, 'utf-8');
    _encKey = Buffer.from(raw.trim(), 'hex');
  } catch {
    // Generate a new 256-bit key on first run
    _encKey = randomBytes(32);
    await fs.writeFile(KEY_PATH, _encKey.toString('hex'), 'utf-8');
  }
  return _encKey;
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [iv, tag, ct].map(b => b.toString('hex')).join(':');
}

function decrypt(value: string, key: Buffer): string {
  if (!value.startsWith(ENC_PREFIX)) return value; // plain text (legacy/migration)
  const parts = value.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return value;
  const [iv, tag, ct] = parts.map(h => Buffer.from(h, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
}

/** Get a nested value from an object by dot-path. */
function getPath(obj: any, dotPath: string): string {
  return dotPath.split('.').reduce((o, k) => o?.[k], obj) ?? '';
}

/** Set a nested value on an object by dot-path (mutates). */
function setPath(obj: any, dotPath: string, value: string) {
  const keys = dotPath.split('.');
  const last = keys.pop()!;
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

async function encryptConfig(cfg: AppConfig): Promise<any> {
  const key = await getEncKey();
  const out = JSON.parse(JSON.stringify(cfg)); // deep clone
  for (const field of SENSITIVE_FIELDS) {
    const val = getPath(out, field);
    if (val) setPath(out, field, encrypt(val, key));
  }
  return out;
}

async function decryptConfig(raw: any): Promise<any> {
  const key = await getEncKey();
  const out = JSON.parse(JSON.stringify(raw));
  for (const field of SENSITIVE_FIELDS) {
    const val = getPath(out, field);
    if (val) setPath(out, field, decrypt(val, key));
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────

export async function initConfig(): Promise<void> {
  const loaded = await loadConfig();
  if (loaded) {
    Object.assign(config, loaded);
    return;
  }

  // No config.json - check for legacy .env and migrate if present
  const migrated = await migrateFromEnv();
  if (migrated) {
    Object.assign(config, migrated);
    await saveConfig(config);
    console.log('  ✔  Migrated settings from .env → data/config.json (credentials encrypted)');
    console.log('     You can delete .env - it is no longer used.\n');
    return;
  }

  // Fresh install - write default skeleton so the file exists
  await saveConfig(config);
}

/** Returns true when all required fields are present. */
export function isConfigComplete(cfg: AppConfig): boolean {
  if (!cfg.cloneHeroSongsDir) return false;
  if (cfg.auth.mode === 'google') {
    if (!cfg.auth.google.clientId || !cfg.auth.google.clientSecret) return false;
  }
  return true;
}

/** Persist config to disk atomically (sensitive fields encrypted). */
export async function saveConfig(cfg: AppConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const encrypted = await encryptConfig(cfg);
  const tmp = CONFIG_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(encrypted, null, 2), 'utf-8');
  await fs.rename(tmp, CONFIG_PATH);
  Object.assign(config, cfg);
}

// ── Internals ────────────────────────────────────────────────────

async function loadConfig(): Promise<AppConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const decrypted = await decryptConfig(parsed);
    return deepMerge(generateDefaultConfig(), decrypted);
  } catch {
    return null;
  }
}

async function migrateFromEnv(): Promise<AppConfig | null> {
  try {
    await fs.access(ENV_PATH);
  } catch {
    return null;
  }

  dotenv.config({ path: ENV_PATH });

  const cfg = generateDefaultConfig();
  if (process.env.PORT)                 cfg.port = parseInt(process.env.PORT, 10);
  if (process.env.SESSION_SECRET)       cfg.sessionSecret = process.env.SESSION_SECRET;
  if (process.env.CLONE_HERO_SONGS_DIR) cfg.cloneHeroSongsDir = process.env.CLONE_HERO_SONGS_DIR;
  if (process.env.TUNNEL_HOSTNAME) {
    cfg.tunnel.enabled  = true;
    cfg.tunnel.hostname = process.env.TUNNEL_HOSTNAME;
  }

  const hasGoogle = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
  const disableAuth = process.env.DISABLE_AUTH === 'true';

  if (hasGoogle && !disableAuth) {
    cfg.auth.mode                 = 'google';
    cfg.auth.google.clientId      = process.env.GOOGLE_CLIENT_ID!;
    cfg.auth.google.clientSecret  = process.env.GOOGLE_CLIENT_SECRET!;
    cfg.auth.google.callbackUrl   = process.env.GOOGLE_CALLBACK_URL
      ?? `http://localhost:${cfg.port}/auth/google/callback`;
    cfg.auth.google.allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  }

  return cfg;
}

export function generateDefaultConfig(): AppConfig {
  return {
    port: 4440,
    sessionSecret: randomUUID(),
    cloneHeroSongsDir: '',
    auth: {
      mode: 'none',
      google: {
        clientId: '',
        clientSecret: '',
        callbackUrl: 'http://localhost:4440/auth/google/callback',
        allowedEmails: [],
      },
    },
    tunnel: {
      enabled: false,
      hostname: '',
    },
  };
}

// ── Deep merge helper ────────────────────────────────────────────

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sv = source[key];
    const tv = target[key];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv) &&
        tv !== null && typeof tv === 'object' && !Array.isArray(tv)) {
      (result as any)[key] = deepMerge(tv as any, sv as any);
    } else if (sv !== undefined) {
      (result as any)[key] = sv;
    }
  }
  return result;
}
