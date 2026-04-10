import type { AppConfig } from '../../shared/types';

export interface SetupStatus {
  needsSetup: boolean;
  platform: string;
  current: SafeConfig;
}

export interface SafeConfig {
  port: number;
  cloneHeroSongsDir: string;
  auth: {
    mode: 'none' | 'google';
    google: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
      allowedEmails: string[];
    };
  };
  tunnel: { enabled: boolean; hostname: string };
}

export interface SetupDefaults {
  songsDirSuggestion: string;
}

export interface ValidateDirResult {
  ok: boolean;
  warning?: string;
  error?: string;
}

export interface SaveResult {
  ok: boolean;
  restartRequired?: boolean;
  externalUrl?: string;
  error?: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch('/setup-api/status');
  return res.json();
}

export async function getSetupDefaults(): Promise<SetupDefaults> {
  const res = await fetch('/setup-api/defaults');
  return res.json();
}

export async function validateDir(dir: string): Promise<ValidateDirResult> {
  return post('/setup-api/validate-dir', { dir });
}

export async function saveSetupConfig(cfg: Partial<AppConfig>): Promise<SaveResult> {
  return post('/setup-api/save', cfg);
}
