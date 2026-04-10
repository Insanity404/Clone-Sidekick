/* ────────────────────────────────────────────────────────────────
 *  Thin wrappers around fetch() for calling our own server API.
 * ──────────────────────────────────────────────────────────────── */

import type {
  SearchRequest,
  AdvancedSearchRequest,
  SearchResponse,
  ChartResult,
  DownloadProgress,
  UserInfo,
  UserPrefs,
} from '../shared/types';

const BASE = '/api';

// Set by App.tsx after /api/config loads so 401 handler knows where to redirect
let authMode: 'none' | 'google' = 'none';
export function setAuthMode(mode: 'none' | 'google') { authMode = mode; }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    if (authMode === 'google') window.location.href = '/auth/google';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Search ──────────────────────────────────────────────────────

export function search(body: SearchRequest): Promise<SearchResponse> {
  return json(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function advancedSearch(body: AdvancedSearchRequest): Promise<SearchResponse> {
  return json(`${BASE}/advancedSearch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Downloads ───────────────────────────────────────────────────

export function startDownload(chart: ChartResult): Promise<{ ok: boolean }> {
  return json(`${BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chart),
  });
}

export function cancelDownload(md5: string): Promise<{ ok: boolean }> {
  return json(`${BASE}/download/${md5}`, { method: 'DELETE' });
}

export function deleteDownload(md5: string): Promise<{ ok: boolean }> {
  return json(`${BASE}/download/${md5}?deleteFiles=true`, { method: 'DELETE' });
}

export function getDownloads(): Promise<DownloadProgress[]> {
  return json(`${BASE}/downloads`);
}

export function enrichDownload(md5: string): Promise<{ ok: boolean; enriched: boolean }> {
  return json(`${BASE}/enrich/${encodeURIComponent(md5)}`, { method: 'POST' });
}

/** Opens an EventSource for real-time download progress. */
export function subscribeDownloads(
  onMessage: (dp: DownloadProgress) => void,
): () => void {
  const es = new EventSource(`${BASE}/downloads/stream`);
  es.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch { /* ignore bad data */ }
  };
  return () => es.close();
}

// ── Auth ────────────────────────────────────────────────────────

export function getMe(): Promise<UserInfo> {
  return json(`${BASE}/me`);
}

export function getConfig(): Promise<{ songsDir: string | null; authMode: 'none' | 'google'; authEnabled: boolean }> {
  return json(`${BASE}/config`);
}

// ── Preferences ─────────────────────────────────────────────────

export function getPrefs(): Promise<UserPrefs> {
  return json(`${BASE}/prefs`);
}

export function savePrefs(prefs: UserPrefs): Promise<UserPrefs> {
  return json(`${BASE}/prefs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
}

export function getSongCount(): Promise<{ count: number }> {
  return json(`${BASE}/song-count`);
}

// ── Helpers ─────────────────────────────────────────────────────

export function albumArtUrl(hash: string | null): string | null {
  if (!hash) return null;
  return `https://files.enchor.us/${hash}.jpg`;
}

export function localArtUrl(md5: string): string {
  return `${BASE}/art/local/${md5}`;
}
